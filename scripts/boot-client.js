/* ======================================================================
   QUEST BASE: Firebase client-side data + auth layer
   ----------------------------------------------------------------------
   Pure client-side: talks directly to Firebase Auth and Firestore.
   Works on the Spark (free) plan. No Functions needed.
   ====================================================================== */
  /* ---------- Firebase data + auth layer ---------- */

  // Firebase SDK globals: firebase.auth(), firebase.firestore()
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Collections
  const templatesCol = db.collection('templates');
  const ticketsCol = db.collection('tickets');
  const usersCol = db.collection('users');
  const kvCol = db.collection('kv');

  // Super admin configuration
  const SUPERADMIN_EMAIL = 'eugenioiromanjuan@gmail.com';

  // Local state
  let setups = {}, store = null, me = null;
  let unsubTickets = null, unsubTemplates = null;

  // Debounced write of the whole state
  let saveTimer = 0, dirty = false;
  function flushStore() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    saveState();
  }
  function saveStore() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flushStore, 200); }

  async function saveState() {
    const payload = { templates: setups, tickets: store.tickets };
    try {
      const batch = db.batch();
      // Templates
      for (const [id, su] of Object.entries(payload.templates)) {
        batch.set(templatesCol.doc(id), { sheet: su.sheet, data: JSON.stringify(su), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      // Tickets (only drafts/returned; locked ones are server-authority but we sync local changes)
      for (const t of payload.tickets) {
        if (t.status === 'draft' || t.status === 'returned') {
          batch.set(ticketsCol.doc(t.id), { data: JSON.stringify(t), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
      }
      await batch.commit();
    } catch (e) {
      dirty = true;
      toast('Not saved yet — the server is unreachable. Keep editing; it saves when it can.');
      saveStore();
    }
  }

  // Real-time listeners
  function startListeners() {
    stopListeners();
    unsubTemplates = templatesCol.onSnapshot(snap => {
      const newSetups = {};
      snap.forEach(doc => { newSetups[doc.id] = JSON.parse(doc.data().data); });
      setups = newSetups;
      Rules.init(setups);
      if (ui.view === 'home') drawHome();
      else if (ui.view === 'ticket') { const t = cur(); if (t) { buildForms(t); panelSig = ''; refreshTicket(); } }
      else if (ui.view === 'setup') { if (!setups[draftTpl]) leaveSetup(); else if (!addingScope) drawScopeBar(); }
    });
    unsubTickets = ticketsCol.orderBy('updatedAt', 'desc').onSnapshot(snap => {
      const newTickets = [];
      snap.forEach(doc => { newTickets.push(Object.assign({ id: doc.id }, JSON.parse(doc.data().data))); });
      if (store) { store.tickets = newTickets; }
      if (ui.view === 'home') drawHome();
      else if (ui.view === 'ticket') { const t = cur(); if (t) { buildForms(t); panelSig = ''; refreshTicket(); } }
    });
  }
  function stopListeners() {
    if (unsubTemplates) { unsubTemplates(); unsubTemplates = null; }
    if (unsubTickets) { unsubTickets(); unsubTickets = null; }
  }

  // Role helpers
  function isSuperAdmin() { return me && me.email === SUPERADMIN_EMAIL; }
  function isApprover() { return me && (me.role === 'approver' || me.role === 'superadmin' || me.roles?.includes('approver')); }
  function isEstimator() { return me && (me.role === 'estimator' || me.role === 'superadmin' || me.roles?.includes('estimator')); }
  function getRoles(u) {
    if (!u) return [];
    if (u.role === 'superadmin') return ['superadmin'];
    const roles = [];
    if (u.role === 'approver' || u.roles?.includes('approver')) roles.push('approver');
    if (u.role === 'estimator' || u.roles?.includes('estimator')) roles.push('estimator');
    return roles;
  }
  function roleLabel(u) {
    const roles = getRoles(u);
    if (roles.includes('superadmin')) return 'Super Admin';
    return roles.length > 1 ? roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(' / ') : (roles[0] ? roles[0].charAt(0).toUpperCase() + roles[0].slice(1) : '—');
  }

  // Auth UI
  function showAuth(first, err) {
    $('viewAuth').hidden = false;
    $('authSetup').hidden = !first;
    $('authLogin').hidden = first;
    $('authErr').textContent = err || '';
  }
  function drawMast() {
    $('mastUser').textContent = me ? me.name : '';
    const r = roleLabel(me);
    $('mastRole').textContent = r;
    $('mastRole').dataset.s = isSuperAdmin() ? 'approved' : (isApprover() ? 'approved' : 'draft');
    $('btnPeople').hidden = !me || (!isApprover() && !isSuperAdmin());
  }

  // People management (approver or superadmin)
  async function openPeople() {
    ui.view = 'people'; showView(); drawMast();
    await drawPeople();
    window.scrollTo(0, 0);
  }
  async function drawPeople() {
    try {
      const snap = await usersCol.orderBy('name').get();
      const people = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      $('peopleList').replaceChildren(...people.map(u => {
        const roles = getRoles(u);
        const canManage = isSuperAdmin() || (isApprover() && u.id !== me.id);
        return h('div', { class: 'erow' },
          h('span', { class: 'sup-name', text: u.name + '  ·  ' + u.email + '  ·  ' + roleLabel(u) }),
          canManage ? h('select', { class: 'text', 'data-person': u.id, onchange: e => changePerson(u.id, e.target.value) },
            h('option', { value: 'estimator', ...(roles.includes('estimator') && !roles.includes('approver') ? { selected: true } : {}) }, 'Estimator'),
            h('option', { value: 'approver', ...(roles.includes('approver') && !roles.includes('estimator') ? { selected: true } : {}) }, 'Approver'),
            h('option', { value: 'both', ...(roles.includes('estimator') && roles.includes('approver') ? { selected: true } : {}) }, 'Both (Estimator + Approver)'),
            h('option', { value: 'superadmin', ...(roles.includes('superadmin') ? { selected: true } : {}) }, 'Super Admin')
          ) : null,
          canManage ? h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Remove ' + u.name, onclick: () => removePerson(u) }, icon('x')) : null
        );
      }));
    } catch (e) { toast('People could not be loaded.'); }
  }
  async function changePerson(id, roleVal) {
    try {
      const update = {};
      if (roleVal === 'superadmin') {
        update.role = 'superadmin';
        update.roles = ['superadmin'];
      } else if (roleVal === 'both') {
        update.role = 'approver'; // primary for backward compat
        update.roles = ['estimator', 'approver'];
      } else {
        update.role = roleVal;
        update.roles = [roleVal];
      }
      await usersCol.doc(id).update(update);
      toast('Role updated.');
    } catch (e) { toast(e.message || 'That could not be saved.'); drawPeople(); }
  }
  async function removePerson(u) {
    if (!pressedTwice('person:' + u.id, () => drawPeople())) return;
    if (u.email === SUPERADMIN_EMAIL) { toast('Cannot remove the super admin.'); return; }
    try { await usersCol.doc(u.id).delete(); toast(u.name + ' removed.'); drawPeople(); }
    catch (e) { toast(e.message || 'That could not be saved.'); }
  }

  // Boot: check auth, start listeners
  async function boot() {
    // Auth state observer
    auth.onAuthStateChanged(async user => {
      if (user) {
        const doc = await usersCol.doc(user.uid).get();
        if (!doc.exists) {
          // First sign-in — create user doc
          const isSA = user.email === SUPERADMIN_EMAIL;
          me = { id: user.uid, name: user.displayName || 'User', email: user.email, role: isSA ? 'superadmin' : 'approver', roles: isSA ? ['superadmin'] : ['approver'], createdAt: firebase.firestore.FieldValue.serverTimestamp() };
          await usersCol.doc(user.uid).set(me);
        } else {
          me = Object.assign({ id: doc.id }, doc.data());
          // Ensure superadmin role is set correctly
          if (me.email === SUPERADMIN_EMAIL && me.role !== 'superadmin') {
            me.role = 'superadmin';
            me.roles = ['superadmin'];
            await usersCol.doc(me.id).update({ role: 'superadmin', roles: ['superadmin'] });
          }
        }
        drawMast();
        await loadInitialState();
        startListeners();
      } else {
        me = null;
        stopListeners();
        const usersSnap = await usersCol.get();
        showAuth(usersSnap.empty, '');
      }
    });
  }

  async function loadInitialState() {
    const [tplSnap, tixSnap] = await Promise.all([
      templatesCol.get(),
      ticketsCol.orderBy('updatedAt', 'desc').get()
    ]);
    setups = {};
    tplSnap.forEach(doc => { setups[doc.id] = JSON.parse(doc.data().data); });
    const tickets = [];
    tixSnap.forEach(doc => { tickets.push(Object.assign({ id: doc.id }, JSON.parse(doc.data().data))); });
    const seqSnap = await kvCol.doc('seq').get();
    const seq = seqSnap.exists ? parseInt(seqSnap.data().value, 10) : 1007;
    const lastSnap = await kvCol.doc('lastEstimator').get();
    const lastEstimator = lastSnap.exists ? lastSnap.data().value : '';
    store = { templates: setups, tickets, seq, lastEstimator };
    Rules.init(setups);
    ui.filter = defaultFilter();
    goHome();
  }

  // Create ticket
  async function newTicket(tpl) {
    const t = Rules.blankTicket(tpl, 'T-' + store.seq++), only = setups[tpl].jobs;
    t.s.estimator = me.name || '';
    if (only.length === 1) t.s.jobs[only[0].id] = true;
    store.tickets.unshift(t);
    saveStore();
    await ticketsCol.doc(t.id).set({ data: JSON.stringify(t), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await kvCol.doc('seq').set({ value: String(store.seq) });
    openTicket(t.id, 'scope');
  }

  // Ticket actions (submit, approve, sendback, reopen, delete)
  async function move(kind) {
    const t = cur();
    if (!t) return;
    const calc = Rules.calcOf(t);
    const now = Rules.nowISO();

    if (kind === 'submit') {
      if (t.status !== 'draft' && t.status !== 'returned') return;
      // Take live scope/underwriting from the form
      if (t.s && t.uw) {
        const fixed = Rules.fixTicket({
          id: t.id, tpl: t.tpl, status: t.status, s: t.s, uw: t.uw, notes: t.notes || '',
          createdAt: t.createdAt, updatedAt: t.updatedAt, submittedAt: t.submittedAt, decidedAt: t.decidedAt,
          note: t.note, log: t.log, frozen: t.frozen, snapshot: t.snapshot
        });
        if (fixed) { t.s = fixed.s; t.uw = fixed.uw; t.notes = fixed.notes; }
      }
      const todo = Rules.todoOf(t, Rules.calcOf(t));
      if (todo.length) { ui.showErrors = true; panelSig = ''; refreshTicket(); goTo(todo[0]); return; }
      Object.assign(t, { status: 'submitted', submittedAt: now, note: '', frozen: Rules.clone(setups[t.tpl] || Rules.tplOf(t)) });
      Rules.logIt(t, 'Submitted for approval');
      toast('Sent for approval.');
    } else if (kind === 'approve') {
      if (!isApprover() || t.status !== 'submitted') return;
      const snapshot = Rules.buildModel(t.s, Rules.tplOf(t), Rules.calcOf(t).quote, Rules.pricedLines(t));
      Object.assign(t, { status: 'approved', decidedAt: now, note: Rules.clean(ui.note), snapshot });
      Rules.logIt(t, 'Approved', t.note);
      toast('Approved. The proposal PDF is unlocked.');
    } else if (kind === 'sendback') {
      if (!isApprover() || t.status !== 'submitted') return;
      if (!Rules.clean(ui.note)) {
        ui.noteErr = true; panelSig = ''; refreshTicket();
        if ($('p-note')) $('p-note').focus();
        toast('Add a note so the estimator knows what to fix.');
        return;
      }
      Object.assign(t, { status: 'returned', decidedAt: now, note: Rules.clean(ui.note), frozen: null });
      Rules.logIt(t, 'Sent back', t.note);
      toast('Sent back to the estimator.');
    } else if (kind === 'reopen') {
      if (t.status !== 'submitted' && t.status !== 'approved') return;
      Rules.logIt(t, t.status === 'approved' ? 'Reopened, approval cleared' : 'Pulled back to edit');
      Object.assign(t, { status: 'draft', snapshot: null, frozen: null });
    }
    Object.assign(ui, { note: '', noteErr: false, showErrors: false });
    disarm(); hush();
    touch(t);
    buildForms(t);
    panelSig = '';
    refreshTicket();
    await ticketsCol.doc(t.id).set({ data: JSON.stringify(t), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }

  // Delete ticket
  async function deleteTicket() {
    const t = cur();
    if (!t) return;
    if (t.status !== 'draft' && t.status !== 'returned') return;
    try {
      await ticketsCol.doc(t.id).delete();
      store.tickets = store.tickets.filter(x => x !== t);
      saveStore();
      goHome();
      toast('Ticket deleted.');
    } catch (e) { toast('The ticket could not be deleted.'); }
  }

  // Client-side PDF (already built)
  async function onPdf() {
    const t = cur();
    if (!t || pdfBusy || t.status !== 'approved' || !jsPDF) return;
    const m = Rules.modelOf(t), name = Sheet.fileName(m);
    pdfBusy = true; panelSig = ''; refreshTicket();
    try {
      saveFile(name, Sheet.buildDoc(m).output('blob'), 'application/pdf');
      toast('PDF saved as ' + name);
    } catch (err) {
      toast('PDF could not be built.');
    }
    pdfBusy = false; panelSig = ''; refreshTicket();
  }

  // Export data
  async function exportData() {
    const data = JSON.stringify({ exportedAt: Rules.nowISO(), templates: setups, tickets: store.tickets }, null, 2);
    saveFile('quest-estimating-export.json', data, 'application/json');
    toast('Exported quest-estimating-export.json');
  }

  // Auth wiring
  $('formSetup').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const name = $('as-name').value.trim();
      const email = $('as-email').value.trim().toLowerCase();
      const pass = $('as-pass').value;
      const res = await auth.createUserWithEmailAndPassword(email, pass);
      await res.user.updateProfile({ displayName: name });
      // user doc created by onAuthStateChanged
    } catch (err) { $('authErr').textContent = err.message || 'That account could not be created.'; }
  });
  $('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const email = $('si-email').value.trim().toLowerCase();
      const pass = $('si-pass').value;
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) { $('authErr').textContent = err.message || 'That email and password do not match.'; }
  });
  $('btnLogout').addEventListener('click', async () => {
    try { await auth.signOut(); } catch (e) { /* ignore */ }
  });
  $('btnPeople').addEventListener('click', openPeople);
  $('formPeople').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const name = $('pp-name').value.trim();
      const email = $('pp-email').value.trim().toLowerCase();
      const pass = $('pp-pass').value;
      const roleVal = $('pp-role').value;
      const res = await auth.createUserWithEmailAndPassword(email, pass);
      await res.user.updateProfile({ displayName: name });
      let roles = [], primaryRole = 'estimator';
      if (roleVal === 'superadmin') { roles = ['superadmin']; primaryRole = 'superadmin'; }
      else if (roleVal === 'both') { roles = ['estimator', 'approver']; primaryRole = 'approver'; }
      else { roles = [roleVal]; primaryRole = roleVal; }
      await usersCol.doc(res.user.uid).set({ id: res.user.uid, name, email, role: primaryRole, roles, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('Person added. They can now sign in.');
      $('pp-name').value = ''; $('pp-email').value = ''; $('pp-pass').value = '';
      drawPeople();
    } catch (err) { toast(err.message || 'That could not be saved.'); }
  });
  $('btnPeopleBack').addEventListener('click', goHome);

  // Attach delete handler
  window.deleteTicket = deleteTicket;

  window.addEventListener('pagehide', flushStore);

  // Shared rule engine (loaded as a script before this file)
  const Rules = window.QB.rules;
  const Sheet = window.QB.sheet;
  const {
    clean, safe, upperLatin, linesOf, capFirst, lowFirst, joinNames,
    num, numIn, round2, fmtNum, fmtQty, fmtRate, money, moneyText, pct, pct2, DASH,
    pad2, todayISO, nowISO, when, dayOf, fmtPhone, uid, okId, clone, str, brief,
    preset, defaultFraming, defaultRoofing, BUILTIN, isBuiltin, MAX_SCOPES,
    starterScope, isSq, MAX_PRESET, MAX_ITEMS, setupLines, normalizeSetup, fresh,
    STATUS, editable, SCOPE_TEXT, FORM_TEXT, tplOf, sameName, scopeName, subLine,
    blankAns, blankScope, reconcileScope, reconcileItems, reconcileUw, foldExtras, itemsShown,
    blankCrew, blankPitch, blankUw, typedPrice, offBook, fixUw,
    blankTicket, fixSnap, fixTicket,
    applies, buildModel, pricedLines,
    crewCalc, roofCalc, lineAmount, pitchFactor, pitchOf, measCalc, calcOf,
    uwGroups, uwLines, lineHas, scopeSays, clashOf, lineJob, fitsJob, jobsBare, roofShown,
    flagsOf, todoOf, logIt, modelOf, summaryText,
  } = Rules;
  const { LOGO, compose, measure, buildDoc, fileName } = Sheet;
  const buildPdf = m => buildDoc(m).output('blob');
  const jsPDF = window.jspdf && window.jspdf.jsPDF;

  // The delete handler on the panel calls this
  function setupDeleteHandler() {
    // The panel's delete button calls this via pressedTwice
  }

  // Initial auth state check
  boot();