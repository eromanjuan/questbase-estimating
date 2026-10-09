/* ======================================================================
   Questbase Estimating: Firebase Cloud Functions backend
   ----------------------------------------------------------------------
   The API the static app calls. Auth (email/password via Firebase Auth
   REST + Firestore sessions), state sync, ticket actions, people, and
   the server-side proposal PDF. All figures are recomputed here with
   the same shared rule engine the browser runs, so a number the client
   sent is never trusted.
   ====================================================================== */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Rules = require('../shared/qb-rules.js');
const Sheet = require('../shared/qb-sheet.js');

admin.initializeApp();
const db = admin.firestore();

const API_KEY = process.env.FIREBASE_API_KEY || '';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;

const cookieOpts = (maxAge) => `HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

/* ---------------- helpers ---------------- */

function json(res, code, body) {
  res.status(code).json(body);
}
function bad(res, code, error) {
  json(res, code, { error });
}
function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function cleanEmail(v) {
  return str(v, 200).trim().toLowerCase();
}
function publicUser(u) {
  return { id: u.id, name: str(u.name, 60), email: str(u.email, 200), role: u.role === 'approver' ? 'approver' : 'estimator' };
}

async function getUserById(id) {
  const doc = await db.collection('users').doc(id).get();
  if (!doc.exists) return null;
  return Object.assign({ id: doc.id }, doc.data());
}
async function getUserByEmail(email) {
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return Object.assign({ id: doc.id }, doc.data());
}

/* Firebase Auth REST: verify email/password, return uid */
async function verifyPassword(email, password) {
  if (!API_KEY) throw new Error('FIREBASE_API_KEY is not set.');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Sign-in failed.');
  return data.localId;
}

/* ---------------- world ---------------- */

async function loadWorld() {
  const [tplSnap, tixSnap] = await Promise.all([
    db.collection('templates').get(),
    db.collection('tickets').get()
  ]);
  const setups = {};
  tplSnap.forEach(doc => { setups[doc.id] = JSON.parse(doc.data().data); });
  const tickets = [];
  tixSnap.forEach(doc => { tickets.push(Object.assign({ id: doc.id }, JSON.parse(doc.data().data))); });
  return { setups, tickets };
}
async function getState() {
  await seed();
  const { setups, tickets } = await loadWorld();
  const seqSnap = await db.collection('kv').doc('seq').get();
  const seq = seqSnap.exists ? parseInt(seqSnap.data().value, 10) : 1007;
  const lastSnap = await db.collection('kv').doc('lastEstimator').get();
  const lastEstimator = lastSnap.exists ? lastSnap.data().value : '';
  return { templates: setups, tickets, seq, lastEstimator };
}
async function putTicket(t) {
  await db.collection('tickets').doc(t.id).set({ data: JSON.stringify(t), updatedAt: t.updatedAt || new Date().toISOString() });
}
async function setKV(key, value) {
  await db.collection('kv').doc(key).set({ value: String(value) });
}

/* Seed the two built-in templates on first run */
let seeded = null;
async function seed() {
  if (seeded) return;
  seeded = (async () => {
    const snap = await db.collection('templates').get();
    if (!snap.empty) return;
    for (const [id, fn, sheet] of [['framing', Rules.defaultFraming, 'crew'], ['roofing', Rules.defaultRoofing, 'roofing']]) {
      const su = Rules.normalizeSetup(fn(), sheet);
      await db.collection('templates').doc(id).set({ sheet, data: JSON.stringify(su), updatedAt: new Date().toISOString() });
    }
    await setKV('seq', '1007');
    await setKV('seeded', '1');
  })();
  return seeded;
}

/* ---------------- auth ---------------- */

async function createUser({ name, email, password, role }) {
  const existing = await getUserByEmail(email);
  if (existing) throw new Error('An account with that email already exists.');
  const uid = 'u_' + crypto.randomBytes(10).toString('hex');
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uid, name: str(name, 60), email, passHash: hash, role: role === 'approver' ? 'approver' : 'estimator', createdAt: new Date().toISOString() };
  await db.collection('users').doc(uid).set(user);
  const { passHash, ...pub } = user;
  return pub;
}

async function makeSession(res, user) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.collection('sessions').doc(token).set({ userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_MS).toISOString() });
  res.setHeader('Set-Cookie', `qb_session=${token}; ${cookieOpts(SESSION_MS / 1000)}`);
  return { user };
}

async function getSessionUser(req) {
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)qb_session=([^;]+)/.exec(cookie);
  if (!m) return null;
  const doc = await db.collection('sessions').doc(m[1]).get();
  if (!doc.exists) return null;
  const s = doc.data();
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    await db.collection('sessions').doc(m[1]).delete();
    return null;
  }
  const user = await getUserById(s.userId);
  return user || null;
}

/* ---------------- API (single function with path routing) ---------------- */

exports.api = functions.https.onRequest(async (req, res) => {
  const path = (req.path || '').replace(/^\/+|\/+$/g, '');
  const seg = path.split('/').filter(Boolean); // ['api', 'auth', 'me'] etc.

  try {
    /* ----- auth ----- */
    if (seg[0] === 'api' && seg[1] === 'auth') {
      const sub = seg[2] || '';
      if (req.method === 'GET' && sub === 'me') {
        const user = await getSessionUser(req);
        if (!user) return json(res, 401, { user: null, users: await userCount() });
        return json(res, 200, { user: publicUser(user) });
      }
      if (req.method === 'POST' && sub === 'logout') {
        const cookie = req.headers.cookie || '';
        const m = /(?:^|;\s*)qb_session=([^;]+)/.exec(cookie);
        if (m) await db.collection('sessions').doc(m[1]).delete();
        res.setHeader('Set-Cookie', `qb_session=; ${cookieOpts(0)}`);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'login') {
        const { email, password } = req.body || {};
        const user = await getUserByEmail(cleanEmail(email));
        if (!user) return bad(res, 401, 'That email and password do not match.');
        const ok = await bcrypt.compare(str(password, 200), user.passHash);
        if (!ok) return bad(res, 401, 'That email and password do not match.');
        // Verify the password against Firebase Auth too (so the account works in the console)
        try { await verifyPassword(cleanEmail(email), str(password, 200)); } catch (e) { /* console sign-in may differ; local hash is authoritative */ }
        const { passHash, ...pub } = user;
        return json(res, 200, await makeSession(res, pub));
      }
      if (req.method === 'POST' && sub === 'setup') {
        const count = await userCount();
        if (count > 0) return bad(res, 403, 'There is already an account.');
        const { name, email, password } = req.body || {};
        if (!str(name, 60)) return bad(res, 422, 'Give the account a name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))) return bad(res, 422, 'That email is not valid.');
        if (str(password, 200).length < 8) return bad(res, 422, 'The password needs at least 8 characters.');
        // Create the Firebase Auth user (best effort — the console may need it too)
        try {
          await admin.auth().createUser({ email: cleanEmail(email), password: str(password, 200), displayName: str(name, 60) });
        } catch (e) { /* may already exist */ }
        const user = await createUser({ name, email: cleanEmail(email), password: str(password, 200), role: 'approver' });
        return json(res, 200, await makeSession(res, user));
      }
      return bad(res, 404, 'Not found.');
    }

    /* ----- everything below needs a session ----- */
    const user = await getSessionUser(req);
    if (!user) return bad(res, 401, 'Sign in first.');
    const pub = publicUser(user);

    /* ----- state ----- */
    if (seg[0] === 'api' && seg[1] === 'state') {
      if (req.method === 'GET') return json(res, 200, await getState());
      if (req.method === 'PUT') return json(res, 200, await saveState(req.body || {}, user));
      return bad(res, 405, 'Method not allowed.');
    }

    /* ----- tickets ----- */
    if (seg[0] === 'api' && seg[1] === 'tickets') {
      const id = seg[2];
      const action = seg[3];

      if (req.method === 'POST' && !id && !action) {
        const { tpl } = req.body || {};
        const world = await loadWorld();
        if (!world.setups[tpl]) return bad(res, 422, 'Pick a template.');
        const seq = await nextSeq();
        const t = Rules.blankTicket(tpl, 'T-' + seq);
        t.s.estimator = user.name || '';
        const su = world.setups[tpl];
        if (su.jobs.length === 1) t.s.jobs[su.jobs[0].id] = true;
        await putTicket(t);
        return json(res, 200, { ticket: t });
      }

      if (id) {
        const t = await getTicket(id);
        if (!t) return bad(res, 404, 'No such ticket.');

        if (action === 'delete' && req.method === 'POST') {
          if (t.status !== 'draft' && t.status !== 'returned') return bad(res, 409, 'Only a draft can be deleted.');
          await db.collection('tickets').doc(id).delete();
          return json(res, 200, { ok: true });
        }
        if (action === 'proposal.pdf' && req.method === 'GET') {
          if (t.status !== 'approved') return bad(res, 403, 'The proposal unlocks after approval.');
          const world = await loadWorld();
          Rules.init(world.setups);
          const m = Rules.modelOf(t, Rules.calcOf(t));
          const doc = Sheet.buildDoc(m);
          const buf = Buffer.from(doc.output('arraybuffer'));
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${Sheet.fileName(m).replace(/"/g, '')}"`);
          return res.status(200).send(buf);
        }

        if (req.method === 'POST' && ['submit', 'approve', 'sendback', 'reopen'].includes(action)) {
          const world = await loadWorld();
          Rules.init(world.setups);
          return json(res, 200, await applyMove(t, action, req.body || {}, user, world));
        }
      }
      return bad(res, 404, 'Not found.');
    }

    /* ----- people (approver only) ----- */
    if (seg[0] === 'api' && seg[1] === 'people') {
      if (user.role !== 'approver') return bad(res, 403, 'Only the approver manages people.');
      if (req.method === 'GET') {
        const snap = await db.collection('users').orderBy('name').get();
        return json(res, 200, { people: snap.docs.map(d => publicUser(Object.assign({ id: d.id }, d.data()))) });
      }
      if (req.method === 'POST') {
        const { name, email, password, role } = req.body || {};
        if (!str(name, 60)) return bad(res, 422, 'Give the person a name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))) return bad(res, 422, 'That email is not valid.');
        if (str(password, 200).length < 8) return bad(res, 422, 'The password needs at least 8 characters.');
        try {
          await admin.auth().createUser({ email: cleanEmail(email), password: str(password, 200), displayName: str(name, 60) });
        } catch (e) { /* may already exist */ }
        const u = await createUser({ name, email: cleanEmail(email), password: str(password, 200), role });
        return json(res, 200, { user: u });
      }
      if (seg[2]) {
        const target = await getUserById(seg[2]);
        if (!target) return bad(res, 404, 'No such person.');
        if (req.method === 'PATCH') {
          const role = (req.body || {}).role === 'approver' ? 'approver' : 'estimator';
          if (target.role === 'approver' && role !== 'approver' && (await approverCount()) <= 1) {
            return bad(res, 409, 'There has to be at least one approver.');
          }
          await db.collection('users').doc(target.id).update({ role });
          return json(res, 200, { user: publicUser(Object.assign({}, target, { role })) });
        }
        if (req.method === 'DELETE') {
          if (target.id === user.id) return bad(res, 409, 'You cannot remove yourself.');
          if (target.role === 'approver' && (await approverCount()) <= 1) {
            return bad(res, 409, 'There has to be at least one approver.');
          }
          await db.collection('users').doc(target.id).delete();
          return json(res, 200, { ok: true });
        }
      }
      return bad(res, 404, 'Not found.');
    }

    /* ----- export ----- */
    if (seg[0] === 'api' && seg[1] === 'export' && req.method === 'GET') {
      const state = await getState();
      return json(res, 200, Object.assign({ exportedAt: new Date().toISOString() }, state));
    }

    return bad(res, 404, 'Not found.');
  } catch (err) {
    console.error('API error:', err);
    return bad(res, 500, err.message || 'Something went wrong.');
  }
});

async function userCount() {
  const snap = await db.collection('users').get();
  return snap.size;
}
async function approverCount() {
  const snap = await db.collection('users').where('role', '==', 'approver').get();
  return snap.size;
}
async function getTicket(id) {
  const doc = await db.collection('tickets').doc(id).get();
  if (!doc.exists) return null;
  return Object.assign({ id: doc.id }, JSON.parse(doc.data().data));
}
async function nextSeq() {
  const ref = db.collection('kv').doc('seq');
  const snap = await ref.get();
  const next = (snap.exists ? parseInt(snap.data().value, 10) : 1006) + 1;
  await ref.set({ value: String(next) });
  return next;
}

/* ---------------- state save ---------------- */

async function saveState(payload, user) {
  await seed();
  const world = await loadWorld();
  Rules.init(world.setups);

  const payloadTpl = payload.templates || {};
  const payloadTix = payload.tickets || {};
  if (Object.keys(payloadTpl).length > 24) return bad({ status: () => ({ json: () => {} }) }, 400, 'Too many templates.');
  if (payloadTix.length > 500) return bad({ status: () => ({ json: () => {} }) }, 400, 'Too many tickets.');

  const seen = new Set();
  for (const [id, raw] of Object.entries(payloadTpl)) {
    const su = Rules.normalizeSetup(raw, raw.sheet === 'roofing' ? 'roofing' : 'crew');
    if (!su || !Rules.clean(su.name)) continue;
    seen.add(id);
    await db.collection('templates').doc(id).set({ sheet: su.sheet, data: JSON.stringify(su), updatedAt: new Date().toISOString() });
  }
  for (const id of Object.keys(world.setups)) {
    if (seen.has(id)) continue;
    if (world.tickets.some(t => t.tpl === id)) continue; // a ticket uses it
    if (payloadTix.some(t => t.tpl === id)) continue;
    await db.collection('templates').doc(id).delete();
  }

  const seenT = new Set();
  for (const raw of payloadTix) {
    const t = Rules.fixTicket(raw);
    if (!t) continue;
    seenT.add(t.id);
    if (t.status !== 'draft' && t.status !== 'returned') continue; // locked: server is authority
    t.updatedAt = new Date().toISOString();
    await putTicket(t);
  }
  for (const t of world.tickets) {
    if (seenT.has(t.id)) continue;
    if (t.status === 'draft' || t.status === 'returned') await db.collection('tickets').doc(t.id).delete();
  }
  if (user && user.name) await setKV('lastEstimator', user.name);
  return getState();
}

/* ---------------- ticket actions (the approval rulebook) ---------------- */

async function applyMove(t, action, body, user, world) {
  const calc = Rules.calcOf(t);
  const now = Rules.nowISO();

  if (action === 'submit') {
    if (t.status !== 'draft' && t.status !== 'returned') return { error: 'That ticket is locked.', status: 409 };
    // Take the live scope/underwriting from the payload, normalized into the draft
    if (body.s && body.uw) {
      const fixed = Rules.fixTicket({
        id: t.id, tpl: t.tpl, status: t.status, s: body.s, uw: body.uw, notes: body.notes || '',
        createdAt: t.createdAt, updatedAt: t.updatedAt, submittedAt: t.submittedAt, decidedAt: t.decidedAt,
        note: t.note, log: t.log, frozen: t.frozen, snapshot: t.snapshot
      });
      if (fixed) { t.s = fixed.s; t.uw = fixed.uw; t.notes = fixed.notes; }
    }
    const todo = Rules.todoOf(t, Rules.calcOf(t));
    if (todo.length) return { error: 'incomplete', status: 409, todos: todo };
    Object.assign(t, { status: 'submitted', submittedAt: now, note: '', frozen: Rules.clone(world.setups[t.tpl] || Rules.tplOf(t)) });
    Rules.logIt(t, 'Submitted for approval');
    await putTicket(t);
    return { ticket: t };
  }

  if (action === 'approve') {
    if (user.role !== 'approver') return { error: 'Only the approver can approve.', status: 403 };
    if (t.status !== 'submitted') return { error: 'It is not waiting for approval.', status: 409 };
    const snapshot = Rules.buildModel(t.s, Rules.tplOf(t), Rules.calcOf(t).quote, Rules.pricedLines(t));
    Object.assign(t, { status: 'approved', decidedAt: now, note: Rules.clean(body.note), snapshot });
    Rules.logIt(t, 'Approved', t.note);
    await putTicket(t);
    return { ticket: t };
  }

  if (action === 'sendback') {
    if (user.role !== 'approver') return { error: 'Only the approver can send a ticket back.', status: 403 };
    if (t.status !== 'submitted') return { error: 'It is not waiting for approval.', status: 409 };
    if (!Rules.clean(body.note)) return { error: 'Add a note so the estimator knows what to fix.', status: 422 };
    Object.assign(t, { status: 'returned', decidedAt: now, note: Rules.clean(body.note), frozen: null });
    Rules.logIt(t, 'Sent back', t.note);
    await putTicket(t);
    return { ticket: t };
  }

  if (action === 'reopen') {
    if (t.status !== 'submitted' && t.status !== 'approved') return { error: 'It is not waiting or approved.', status: 409 };
    Rules.logIt(t, t.status === 'approved' ? 'Reopened, approval cleared' : 'Pulled back to edit');
    Object.assign(t, { status: 'draft', snapshot: null, frozen: null });
    await putTicket(t);
    return { ticket: t };
  }

  return { error: 'Unknown action.', status: 404 };
}
