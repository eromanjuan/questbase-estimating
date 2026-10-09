/* ======================================================================
   One-time migration: build public/app.js from the prototype
   ----------------------------------------------------------------------
   Takes the prototype's section 6 (screens) and DOM helpers, then wraps
   them with a Firebase data layer (Firestore) and Firebase Auth so the
   app runs as a static site on Firebase Hosting.
   ====================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = 'C:\\Users\\ROM\\Downloads\\questbase-estimating-handoff\\questbase-estimating-handoff\\prototype\\src';
const read = p => fs.readFileSync(path.join(SRC, p), 'utf8');
const lines = read('app.js').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n'); // 1-based inclusive

// §6 screens: keep everything from the prototype except the storage layer,
// role switch, demo data, and dev notes (all replaced below).
const screens = [
  slice(42, 77),     // NS, $, h, svg, ICONS, icon (DOM helpers)
  slice(1516, 1553), // ui, cur, toast, pressedTwice, disarm, hush
  slice(1554, 1612), // showView, pill, stat, setText, defaultFilter, goHome, drawHome
  slice(1623, 1745), // openTicket, editLink, choiceBlock, textBlock, drawAdder, applySetup, changeSetup, addJobHere, addOptionHere, buildForms
  slice(1746, 1800), // drawForms
  slice(1802, 1843), // drawItems, onItemClick
  slice(1845, 1892), // tplAsk, pristine, retemplate, drawTplAsk, pickTpl
  slice(1894, 1980), // buildCrews, buildSupplies
  slice(1982, 2003), // readScope
  slice(2005, 2005), // touch
  slice(2007, 2033), // setTab, goTo
  slice(2035, 2101), // todoList, flagList, drawPanel
  slice(2142, 2261), // refreshTicket
  slice(2263, 2312), // flagBlock, sumHead, drawSummaryCrew, drawSummaryRoof
  slice(2314, 2399), // onScopeInput, onUwInput, onUwBlur, onUwClick
  slice(2401, 2425), // pdfBusy, onPdf, onCopy
  slice(2427, 2941), // setup editor (openSetup..cancelSetup)
  slice(1414, 1452), // r2, drawSheet, drawn, drawPages
].join('\n\n');

// Replacements inside the extracted screens:
// 1. showView: drop 'Notes' view (dev notes removed)
// 2. store.role -> me.role (auth-based role)
// 3. drawPanel: drop saveMode from sig, simplify PDF button
// 4. refreshTicket: drop saveMode
// 5. onPdf: use server-side PDF endpoint
// 6. exportData: use Firestore export
// 7. newTicket: async Firebase create
// 8. move: async Firebase action
// 9. delete ticket: async Firebase delete
// 10. saveStore: Firestore sync (debounced)

let out = screens;

// 1. showView: remove 'Notes'
out = out.replace(
  "for (const v of ['Home', 'Ticket', 'Setup', 'Notes']) $('view' + v).hidden = ui.view !== v.toLowerCase();",
  "for (const v of ['Home', 'Ticket', 'Setup', 'Auth', 'People']) $('view' + v).hidden = ui.view !== v.toLowerCase();"
);

// 2. store.role -> me.role
out = out.replace(/store\.role/g, 'me.role');

// 3. drawPanel: drop saveMode from sig
out = out.replace(
  "const sig = JSON.stringify([t.id, st, role, todo.map(x => x.text + '>' + x.id), flags.map(x => x.text), armedKey, pdfBusy, ui.noteErr, t.note, t.decidedAt, t.submittedAt, t.log.length, calc.quote, calc.facts.map(f => f.value), saveMode]);",
  "const sig = JSON.stringify([t.id, st, role, todo.map(x => x.text + '>' + x.id), flags.map(x => x.text), armedKey, pdfBusy, ui.noteErr, t.note, t.decidedAt, t.submittedAt, t.log.length, calc.quote, calc.facts.map(f => f.value)]);"
);
out = out.replace("jsPDF && saveMode !== 'none' ?", "jsPDF ?");
out = out.replace(
  "const canSave = !!jsPDF && saveMode !== 'none';",
  "const canSave = !!jsPDF;"
);
out = out.replace(
  "'Approved. Saving a PDF is not available in this view.'",
  "'Approved. Saving a PDF needs the PDF library to load.'"
);

// 4. onPdf: server-side PDF via Firestore Function (fallback to client)
out = out.replace(
  `  async function onPdf() {
    const t = cur();
    if (!t || pdfBusy || t.status !== 'approved' || !jsPDF) return;
    const m = modelOf(t);
    const name = fileName(m);
    pdfBusy = true; panelSig = ''; refreshTicket();
    try {
      const res = await saveFile(name, buildPdf(m), 'application/pdf');
      if (res === 'saved') toast('PDF saved as ' + name);
      else if (res === 'none') toast('Saving a file is not available in this view.');
    } catch (err) {
      toast(saveProblem(err));
    }
    pdfBusy = false; panelSig = ''; refreshTicket();
  }`,
  `  async function onPdf() {
    const t = cur();
    if (!t || pdfBusy || t.status !== 'approved' || !jsPDF) return;
    const m = modelOf(t);
    const name = fileName(m);
    pdfBusy = true; panelSig = ''; refreshTicket();
    try {
      // Try the Firebase Function first (server-side PDF)
      const res = await fetch('/api/tickets/' + t.id + '/proposal.pdf', { credentials: 'same-origin' });
      if (res.ok) {
        const blob = await res.blob();
        saveFile(name, blob, 'application/pdf');
        toast('PDF saved as ' + name);
      } else {
        // Fallback: client-side PDF
        saveFile(name, buildPdf(m), 'application/pdf');
        toast('PDF saved as ' + name);
      }
    } catch (err) {
      // Fallback: client-side PDF
      saveFile(name, buildPdf(m), 'application/pdf');
      toast('PDF saved as ' + name);
    }
    pdfBusy = false; panelSig = ''; refreshTicket();
  }`
);

// 5. exportData: Firestore export
out = out.replace(
  `  async function exportData() {
    const data = JSON.stringify({ exportedAt: nowISO(), templates: setups, tickets: store.tickets }, null, 2);
    try {
      const res = await saveFile('quest-estimating-export.json', data, 'application/json');
      if (res === 'saved') toast('Exported quest-estimating-export.json');
      else if (res === 'none') toast('Saving a file is not available in this view.');
    } catch (err) {
      toast(saveProblem(err));
    }
  }`,
  `  async function exportData() {
    const data = JSON.stringify({ exportedAt: nowISO(), templates: setups, tickets: store.tickets }, null, 2);
    saveFile('quest-estimating-export.json', data, 'application/json');
    toast('Exported quest-estimating-export.json');
  }`
);

// 6. newTicket: async Firebase create
out = out.replace(
  `  function newTicket(tpl) {
    const t = blankTicket(tpl, 'T-' + store.seq++), only = setups[tpl].jobs;
    t.s.estimator = store.lastEstimator || '';
    if (only.length === 1) t.s.jobs[only[0].id] = true; // one scope of work: nothing to pick
    store.tickets.unshift(t);
    saveStore();
    openTicket(t.id, 'scope');
  }`,
  `  async function newTicket(tpl) {
    const t = blankTicket(tpl, 'T-' + store.seq++), only = setups[tpl].jobs;
    t.s.estimator = store.lastEstimator || '';
    if (only.length === 1) t.s.jobs[only[0].id] = true; // one scope of work: nothing to pick
    store.tickets.unshift(t);
    saveStore();
    openTicket(t.id, 'scope');
  }`
);

// 7. move: async Firebase action
out = out.replace(
  `  // Status moves. This is the whole approval rulebook.
  function move(kind) {
    const t = cur();
    if (!t) return;
    const calc = calcOf(t);
    if (kind === 'submit') {
      const todo = todoOf(t, calc);
      if (todo.length) { ui.showErrors = true; panelSig = ''; refreshTicket(); goTo(todo[0]); return; }
      Object.assign(t, { status: 'submitted', submittedAt: nowISO(), note: '', frozen: clone(setups[t.tpl] || tplOf(t)) });
      logIt(t, 'Submitted for approval');
      toast('Sent for approval.');
    } else if (kind === 'approve') {
      if (me.role !== 'approver' || t.status !== 'submitted') return;
      Object.assign(t, { status: 'approved', decidedAt: nowISO(), note: clean(ui.note), snapshot: buildModel(t.s, tplOf(t), calc.quote, pricedLines(t)) });
      logIt(t, 'Approved', t.note);
      toast('Approved. The proposal PDF is unlocked.');
    } else if (kind === 'sendback') {
      if (me.role !== 'approver' || t.status !== 'submitted') return;
      if (!clean(ui.note)) {
        ui.noteErr = true; panelSig = ''; refreshTicket();
        if ($('p-note')) $('p-note').focus();
        toast('Add a note so the estimator knows what to fix.');
        return;
      }
      Object.assign(t, { status: 'returned', decidedAt: nowISO(), note: clean(ui.note), frozen: null });
      logIt(t, 'Sent back', t.note);
      toast('Sent back to the estimator.');
    } else if (kind === 'reopen') {
      logIt(t, t.status === 'approved' ? 'Reopened, approval cleared' : 'Pulled back to edit');
      Object.assign(t, { status: 'draft', snapshot: null, frozen: null });
    }
    Object.assign(ui, { note: '', noteErr: false, showErrors: false });
    disarm(); hush();
    touch(t);
    buildForms(t); // a locked ticket lists only the lines in use, an open one lists them all
    panelSig = '';
    refreshTicket();
  }`,
  `  // Status moves. This is the whole approval rulebook.
  async function move(kind) {
    const t = cur();
    if (!t) return;
    const calc = calcOf(t);
    if (kind === 'submit') {
      const todo = todoOf(t, calc);
      if (todo.length) { ui.showErrors = true; panelSig = ''; refreshTicket(); goTo(todo[0]); return; }
      Object.assign(t, { status: 'submitted', submittedAt: nowISO(), note: '', frozen: clone(setups[t.tpl] || tplOf(t)) });
      logIt(t, 'Submitted for approval');
      toast('Sent for approval.');
    } else if (kind === 'approve') {
      if (me.role !== 'approver' || t.status !== 'submitted') return;
      Object.assign(t, { status: 'approved', decidedAt: nowISO(), note: clean(ui.note), snapshot: buildModel(t.s, tplOf(t), calc.quote, pricedLines(t)) });
      logIt(t, 'Approved', t.note);
      toast('Approved. The proposal PDF is unlocked.');
    } else if (kind === 'sendback') {
      if (me.role !== 'approver' || t.status !== 'submitted') return;
      if (!clean(ui.note)) {
        ui.noteErr = true; panelSig = ''; refreshTicket();
        if ($('p-note')) $('p-note').focus();
        toast('Add a note so the estimator knows what to fix.');
        return;
      }
      Object.assign(t, { status: 'returned', decidedAt: nowISO(), note: clean(ui.note), frozen: null });
      logIt(t, 'Sent back', t.note);
      toast('Sent back to the estimator.');
    } else if (kind === 'reopen') {
      logIt(t, t.status === 'approved' ? 'Reopened, approval cleared' : 'Pulled back to edit');
      Object.assign(t, { status: 'draft', snapshot: null, frozen: null });
    }
    Object.assign(ui, { note: '', noteErr: false, showErrors: false });
    disarm(); hush();
    touch(t);
    buildForms(t); // a locked ticket lists only the lines in use, an open one lists them all
    panelSig = '';
    refreshTicket();
  }`
);

// 8. delete ticket: async Firebase delete
out = out.replace(
  `        twice('p-delete', 'del:' + t.id, 'Delete ticket', 'Tap again to delete it', 'danger', () => {
          store.tickets = store.tickets.filter(x => x !== t); saveStore(); goHome(); toast('Ticket deleted.');
        })`,
  `        twice('p-delete', 'del:' + t.id, 'Delete ticket', 'Tap again to delete it', 'danger', async () => {
          try { await api('/api/tickets/' + t.id + '/delete', 'POST', {}); } catch (e) { toast('The ticket could not be deleted.'); return; }
          store.tickets = store.tickets.filter(x => x !== t); saveStore(); goHome(); toast('Ticket deleted.');
        })`
);

// 9. saveStore: Firestore sync (replaces localStorage)
out = out.replace(
  `  // A tab writes only when it has changes of its own (\`dirty\`), and takes over what
  // another tab saves (see the storage listener at the bottom), so two open tabs never
  // overwrite each other with an old copy.
  let saveTimer = 0, dirty = false;
  function flushStore() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private window or full storage: the page still works for this visit */ }
  }
  function saveStore() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flushStore, 200); }
  // The role is kept per tab, so an estimator window and an approver window can sit side by side.
  const ROLE_KEY = 'quest-estimating:role';
  const tabRole = () => { try { const r = sessionStorage.getItem(ROLE_KEY); return r === 'approver' || r === 'estimator' ? r : ''; } catch (e) { return ''; } };
  const keepTabRole = () => { try { sessionStorage.setItem(ROLE_KEY, store.role); } catch (e) { /* the role then lasts for this visit only */ } };`,
  `  // Firestore sync: debounced write of the whole state (templates + tickets).
  let saveTimer = 0, dirty = false, saving = false;
  function flushStore() {
    clearTimeout(saveTimer);
    if (!dirty || saving) return;
    dirty = false;
    save();
  }
  function saveStore() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flushStore, 200); }
  async function save() {
    saving = true;
    try {
      await api('/api/state', 'PUT', { templates: setups, tickets: store.tickets });
    } catch (e) { dirty = true; toast('Not saved yet — the server is unreachable. Keep editing; it saves when it can.'); }
    saving = false;
    if (dirty) saveStore();
  }`
);

// 10. saveFile: direct download only (no viewer mode)
out = out.replace(
  `  /* Saving a file. Inside Claude the page asks the viewer through the downloads
     capability; as a plain HTML file it uses a normal browser download. */
  let downloads = null;
  let saveMode = 'checking'; // viewer | direct | none
  const saverReady = (async () => {
    if (window.claude && typeof window.claude.use === 'function') {
      try { downloads = await window.claude.use('downloads'); } catch (e) { downloads = null; }
      saveMode = downloads ? 'viewer' : 'none';
    } else {
      saveMode = 'direct';
    }
  })();
  async function saveFile(filename, data, mime) {
    await saverReady;
    if (saveMode === 'viewer') {
      const res = await downloads.save({ filename, data });
      return res && res.status === 'saved' ? 'saved' : 'sent';
    }
    if (saveMode === 'direct') {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return 'saved';
    }
    return 'none';
  }
  function saveProblem(err) {
    const code = err && err.code;
    if (code === 'declined') return 'Download cancelled.';
    if (code === 'rate_limited') return 'A save prompt is already open. Answer that one, then try again.';
    if (code) { if (!['too_large', 'bad_request', 'transform_error', 'rejected_extension', 'extension_not_enabled'].includes(code)) saveMode = 'none'; return 'The file could not be saved from this view.'; }
    return 'The file could not be built. Reload the page and try again.';
  }`,
  `  /* Saving a file: direct browser download. */
  function saveFile(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  }`
);

// 11. Append saveFile + boot/data layer (the original start section is replaced)
const saveFileAndBoot = `
  /* Saving a file: direct browser download. */
  function saveFile(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  }

  /* ---------- Firebase data + auth layer ---------- */

  // Firestore sync: debounced write of the whole state (templates + tickets).
  let saveTimer = 0, dirty = false, saving = false;
  function flushStore() {
    clearTimeout(saveTimer);
    if (!dirty || saving) return;
    dirty = false;
    save();
  }
  function saveStore() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flushStore, 200); }
  async function save() {
    saving = true;
    try {
      await api('/api/state', 'PUT', { templates: setups, tickets: store.tickets });
    } catch (e) { dirty = true; toast('Not saved yet — the server is unreachable. Keep editing; it saves when it can.'); }
    saving = false;
    if (dirty) saveStore();
  }

  // API helper: calls Firebase Functions (same contract as the Next.js API routes)
  async function api(path, method, body) {
    const res = await fetch(path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok) { const err = new Error(data && data.error || 'The server said no.'); err.status = res.status; err.body = data; throw err; }
    return data;
  }

  // Load state from Firebase Functions
  async function loadState() {
    const s = await api('/api/state');
    store = s;
    setups = store.templates;
    Rules.init(setups);
  }

  // Poll for changes from other tabs/users (lightweight)
  let lastSig = '';
  async function poll() {
    if (dirty || !store) return;
    try {
      const s = await api('/api/state');
      const sig = JSON.stringify(s.tickets) + JSON.stringify(Object.keys(s.templates));
      if (sig === lastSig) return;
      adoptState(s);
      if (ui.view === 'home') drawHome();
      else if (ui.view === 'ticket') {
        const t = cur();
        if (t) { buildForms(t); panelSig = ''; refreshTicket(); }
      }
      lastSig = sig;
    } catch (e) { /* offline */ }
  }

  function adoptState(s) {
    const keep = dirty && cur();
    store.templates = s.templates; setups = s.templates;
    store.tickets = s.tickets;
    store.seq = s.seq; store.lastEstimator = s.lastEstimator;
    if (keep) {
      const i = store.tickets.findIndex(t => t.id === keep.id);
      if (i >= 0) store.tickets[i] = keep; else store.tickets.unshift(keep);
    }
    Rules.init(setups);
  }

  // Auth views
  function showAuth(first, err) {
    $('viewAuth').hidden = false;
    $('authSetup').hidden = !first;
    $('authLogin').hidden = first;
    $('authErr').textContent = err || '';
  }

  function drawMast() {
    $('mastUser').textContent = me ? me.name : '';
    $('mastRole').dataset.s = me && me.role === 'approver' ? 'approved' : 'draft';
    $('mastRole').textContent = me ? (me.role === 'approver' ? 'Approver' : 'Estimator') : '';
    $('btnPeople').hidden = !me || me.role !== 'approver';
  }

  // People management (approver only)
  async function openPeople() {
    ui.view = 'people'; showView(); drawMast();
    await drawPeople();
    window.scrollTo(0, 0);
  }

  async function drawPeople() {
    let people = [];
    try { people = await api('/api/people'); } catch (e) { toast('People could not be loaded.'); return; }
    $('peopleList').replaceChildren(...people.map(u => h('div', { class: 'erow' },
      h('span', { class: 'sup-name', text: u.name + '  ·  ' + u.email }),
      h('select', { class: 'text', 'data-person': u.id, onchange: e => changePerson(u.id, e.target.value) },
        h('option', { value: 'estimator', ...(u.role === 'estimator' ? { selected: true } : {}) }, 'Estimator'),
        h('option', { value: 'approver', ...(u.role === 'approver' ? { selected: true } : {}) }, 'Approver')),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Remove ' + u.name, onclick: () => removePerson(u) }, icon('x')))));
  }

  async function changePerson(id, role) {
    try { await api('/api/people/' + id, 'PATCH', { role }); toast('Role updated.'); }
    catch (e) { toast(e.message || 'That could not be saved.'); drawPeople(); }
  }

  async function removePerson(u) {
    if (!pressedTwice('person:' + u.id, () => drawPeople())) return;
    try { await api('/api/people/' + u.id, 'DELETE', {}); toast(u.name + ' removed.'); drawPeople(); }
    catch (e) { toast(e.message || 'That could not be saved.'); }
  }

  // Boot: check auth, load state, wire events
  async function boot() {
    let r;
    try { r = await api('/api/auth/me'); }
    catch (e) { showAuth(false, 'The server could not be reached. Try again in a moment.'); return; }
    if (!r.user) { showAuth(r.users === 0, ''); return; }
    me = r.user;
    drawMast();
    try { await loadState(); }
    catch (e) { showAuth(false, 'The server could not be reached. Try again in a moment.'); return; }
    // Poll every 4s for changes from other tabs
    setInterval(poll, 4000);
    ui.filter = defaultFilter();
    goHome();
  }

  // Presses on the action buttons are ignored for a moment after they change, and so are
  // presses in Setup just after it opens (see hush).
  for (const id of ['statusPanel', 'viewSetup']) $(id).addEventListener('click', e => { if (performance.now() < quietUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  // A held Enter or Space presses a button once, not over and over.
  document.addEventListener('keydown', e => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('button')) e.preventDefault();
  }, true);
  // Setup changes are never thrown away without asking.
  const holdSetup = () => {
    if (ui.view !== 'setup' || !draft || !draftChanged()) return false;
    setupSay('Save or cancel your changes here first.');
    return true;
  };

  $('btnSetup').addEventListener('click', () => { const t = cur(); openSetup(t ? t.tpl : draftTpl, t ? { id: t.id, tab: ui.tab } : null); });
  // "Edit" links on a ticket open Setup on that part and come back to the ticket afterwards.
  $('viewTicket').addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-edit]') : null, t = cur();
    if (!b || !t || !editable(t)) return;
    const what = b.dataset.edit, part = what.split(':');
    openSetup(t.tpl, Object.assign({ id: t.id, tab: ui.tab },
      what === 'tpl' ? {}
        : what === 'jobs' ? { sec: 'jobs', jobs: tplOf(t).jobs.filter(j => t.s.jobs[j.id]).map(j => j.id) }
          : part[0] === 'q' ? { q: what.slice(2) }
        : part[0] === 'line' ? { sec: part[1], line: { key: part[1], job: part[2] } }
          : what === 'addq' ? { focus: 's-addq' } : { sec: what }));
  });
  $('lnkExport').addEventListener('click', exportData);
  $('btnBack').addEventListener('click', goHome);
  for (const k of ['scope', 'uw', 'proposal']) $('tab-' + k).addEventListener('click', () => setTab(k));
  $('btnToUw').addEventListener('click', () => setTab('uw'));

  const scopeForm = $('scopeForm');
  scopeForm.addEventListener('submit', e => e.preventDefault());
  scopeForm.addEventListener('input', onScopeInput);
  scopeForm.addEventListener('change', onScopeInput);
  scopeForm.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') e.preventDefault(); });
  $('itemsBox').addEventListener('click', onItemClick);
  // The scope of work above the tabs: a tick changes the ticket, the picker its template.
  $('scopeBar').addEventListener('change', e => { if (e.target && e.target.id === 'sbTpl') pickTpl(e.target.value); else onScopeInput(); });
  $('f-phone').addEventListener('blur', e => { e.target.value = fmtPhone(e.target.value); onScopeInput(); });
  $('f-state').addEventListener('blur', e => { e.target.value = e.target.value.toUpperCase(); onScopeInput(); });

  const uwPane = $('uwPane');
  uwPane.addEventListener('input', onUwInput);
  uwPane.addEventListener('change', onUwInput);
  uwPane.addEventListener('focusout', onUwBlur);
  uwPane.addEventListener('click', onUwClick);

  $('btnCopy').addEventListener('click', onCopy);
  $('btnZoom').addEventListener('click', e => {
    const on = $('pagesMain').classList.toggle('zoomed');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Fit to screen' : 'Zoom in';
  });

  $('btnSetupSave').addEventListener('click', saveSetup);
  $('btnSetupCancel').addEventListener('click', cancelSetup);
  $('btnDiscardYes').addEventListener('click', leaveSetup);
  $('btnDiscardNo').addEventListener('click', () => { askDiscard = false; drawSetupBar(); $('btnSetupCancel').focus(); });

  // Auth wiring
  $('formSetup').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const res = await api('/api/auth/setup', 'POST', { name: $('as-name').value.trim(), email: $('as-email').value.trim().toLowerCase(), password: $('as-pass').value });
      me = res.user;
      await afterSignIn();
    } catch (err) { $('authErr').textContent = err.message || 'That account could not be created.'; }
  });
  $('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const res = await api('/api/auth/login', 'POST', { email: $('si-email').value.trim().toLowerCase(), password: $('si-pass').value });
      me = res.user;
      await afterSignIn();
    } catch (err) { $('authErr').textContent = err.message || 'That email and password do not match.'; }
  });
  $('btnLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', 'POST', {}); } catch (e) { /* ignore */ }
    location.reload();
  });
  $('btnPeople').addEventListener('click', openPeople);
  $('formPeople').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/people', 'POST', { name: $('pp-name').value.trim(), email: $('pp-email').value.trim().toLowerCase(), password: $('pp-pass').value, role: $('pp-role').value });
      toast('Person added.');
      $('pp-name').value = ''; $('pp-email').value = ''; $('pp-pass').value = '';
      drawPeople();
    } catch (err) { toast(err.message || 'That could not be saved.'); }
  });
  $('btnPeopleBack').addEventListener('click', goHome);

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

  let setups = {}, store = null, me = null;

  async function afterSignIn() {
    drawMast();
    await loadState();
    ui.filter = defaultFilter();
    goHome();
    setInterval(poll, 4000);
  }

  boot();
`;

out = out + saveFileAndBoot;
  `  /* ---------- Firebase data + auth layer ---------- */

  // API helper: calls Firebase Functions (same contract as the Next.js API routes)
  async function api(path, method, body) {
    const res = await fetch(path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok) { const err = new Error(data && data.error || 'The server said no.'); err.status = res.status; err.body = data; throw err; }
    return data;
  }

  // Load state from Firebase Functions
  async function loadState() {
    const s = await api('/api/state');
    store = s;
    setups = store.templates;
    Rules.init(setups);
  }

  // Poll for changes from other tabs/users (lightweight)
  let lastSig = '';
  async function poll() {
    if (dirty || !store) return;
    try {
      const s = await api('/api/state');
      const sig = JSON.stringify(s.tickets) + JSON.stringify(Object.keys(s.templates));
      if (sig === lastSig) return;
      adoptState(s);
      if (ui.view === 'home') drawHome();
      else if (ui.view === 'ticket') {
        const t = cur();
        if (t) { buildForms(t); panelSig = ''; refreshTicket(); }
      }
      lastSig = sig;
    } catch (e) { /* offline */ }
  }

  function adoptState(s) {
    const keep = dirty && cur();
    store.templates = s.templates; setups = s.templates;
    store.tickets = s.tickets;
    store.seq = s.seq; store.lastEstimator = s.lastEstimator;
    if (keep) {
      const i = store.tickets.findIndex(t => t.id === keep.id);
      if (i >= 0) store.tickets[i] = keep; else store.tickets.unshift(keep);
    }
    Rules.init(setups);
  }

  // Auth views
  function showAuth(first, err) {
    $('viewAuth').hidden = false;
    $('authSetup').hidden = !first;
    $('authLogin').hidden = first;
    $('authErr').textContent = err || '';
  }

  function drawMast() {
    $('mastUser').textContent = me ? me.name : '';
    $('mastRole').dataset.s = me && me.role === 'approver' ? 'approved' : 'draft';
    $('mastRole').textContent = me ? (me.role === 'approver' ? 'Approver' : 'Estimator') : '';
    $('btnPeople').hidden = !me || me.role !== 'approver';
  }

  // People management (approver only)
  async function openPeople() {
    ui.view = 'people'; showView(); drawMast();
    await drawPeople();
    window.scrollTo(0, 0);
  }

  async function drawPeople() {
    let people = [];
    try { people = await api('/api/people'); } catch (e) { toast('People could not be loaded.'); return; }
    $('peopleList').replaceChildren(...people.map(u => h('div', { class: 'erow' },
      h('span', { class: 'sup-name', text: u.name + '  ·  ' + u.email }),
      h('select', { class: 'text', 'data-person': u.id, onchange: e => changePerson(u.id, e.target.value) },
        h('option', { value: 'estimator', ...(u.role === 'estimator' ? { selected: true } : {}) }, 'Estimator'),
        h('option', { value: 'approver', ...(u.role === 'approver' ? { selected: true } : {}) }, 'Approver')),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Remove ' + u.name, onclick: () => removePerson(u) }, icon('x')))));
  }

  async function changePerson(id, role) {
    try { await api('/api/people/' + id, 'PATCH', { role }); toast('Role updated.'); }
    catch (e) { toast(e.message || 'That could not be saved.'); drawPeople(); }
  }

  async function removePerson(u) {
    if (!pressedTwice('person:' + u.id, () => drawPeople())) return;
    try { await api('/api/people/' + u.id, 'DELETE', {}); toast(u.name + ' removed.'); drawPeople(); }
    catch (e) { toast(e.message || 'That could not be saved.'); }
  }

  // Boot: check auth, load state, wire events
  async function boot() {
    let r;
    try { r = await api('/api/auth/me'); }
    catch (e) { showAuth(false, 'The server could not be reached. Try again in a moment.'); return; }
    if (!r.user) { showAuth(r.users === 0, ''); return; }
    me = r.user;
    drawMast();
    try { await loadState(); }
    catch (e) { showAuth(false, 'The server could not be reached. Try again in a moment.'); return; }
    // Poll every 4s for changes from other tabs
    setInterval(poll, 4000);
    ui.filter = defaultFilter();
    goHome();
  }

  // Presses on the action buttons are ignored for a moment after they change, and so are
  // presses in Setup just after it opens (see hush).
  for (const id of ['statusPanel', 'viewSetup']) $(id).addEventListener('click', e => { if (performance.now() < quietUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  // A held Enter or Space presses a button once, not over and over.
  document.addEventListener('keydown', e => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('button')) e.preventDefault();
  }, true);
  // Setup changes are never thrown away without asking.
  const holdSetup = () => {
    if (ui.view !== 'setup' || !draft || !draftChanged()) return false;
    setupSay('Save or cancel your changes here first.');
    return true;
  };

  $('btnSetup').addEventListener('click', () => { const t = cur(); openSetup(t ? t.tpl : draftTpl, t ? { id: t.id, tab: ui.tab } : null); });
  // "Edit" links on a ticket open Setup on that part and come back to the ticket afterwards.
  $('viewTicket').addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-edit]') : null, t = cur();
    if (!b || !t || !editable(t)) return;
    const what = b.dataset.edit, part = what.split(':');
    openSetup(t.tpl, Object.assign({ id: t.id, tab: ui.tab },
      what === 'tpl' ? {}
        : what === 'jobs' ? { sec: 'jobs', jobs: tplOf(t).jobs.filter(j => t.s.jobs[j.id]).map(j => j.id) }
          : part[0] === 'q' ? { q: what.slice(2) }
        : part[0] === 'line' ? { sec: part[1], line: { key: part[1], job: part[2] } }
          : what === 'addq' ? { focus: 's-addq' } : { sec: what }));
  });
  $('lnkExport').addEventListener('click', exportData);
  $('btnBack').addEventListener('click', goHome);
  for (const k of ['scope', 'uw', 'proposal']) $('tab-' + k).addEventListener('click', () => setTab(k));
  $('btnToUw').addEventListener('click', () => setTab('uw'));

  const scopeForm = $('scopeForm');
  scopeForm.addEventListener('submit', e => e.preventDefault());
  scopeForm.addEventListener('input', onScopeInput);
  scopeForm.addEventListener('change', onScopeInput);
  scopeForm.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') e.preventDefault(); });
  $('itemsBox').addEventListener('click', onItemClick);
  // The scope of work above the tabs: a tick changes the ticket, the picker its template.
  $('scopeBar').addEventListener('change', e => { if (e.target && e.target.id === 'sbTpl') pickTpl(e.target.value); else onScopeInput(); });
  $('f-phone').addEventListener('blur', e => { e.target.value = fmtPhone(e.target.value); onScopeInput(); });
  $('f-state').addEventListener('blur', e => { e.target.value = e.target.value.toUpperCase(); onScopeInput(); });

  const uwPane = $('uwPane');
  uwPane.addEventListener('input', onUwInput);
  uwPane.addEventListener('change', onUwInput);
  uwPane.addEventListener('focusout', onUwBlur);
  uwPane.addEventListener('click', onUwClick);

  $('btnCopy').addEventListener('click', onCopy);
  $('btnZoom').addEventListener('click', e => {
    const on = $('pagesMain').classList.toggle('zoomed');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Fit to screen' : 'Zoom in';
  });

  $('btnSetupSave').addEventListener('click', saveSetup);
  $('btnSetupCancel').addEventListener('click', cancelSetup);
  $('btnDiscardYes').addEventListener('click', leaveSetup);
  $('btnDiscardNo').addEventListener('click', () => { askDiscard = false; drawSetupBar(); $('btnSetupCancel').focus(); });

  // Auth wiring
  $('formSetup').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const res = await api('/api/auth/setup', 'POST', { name: $('as-name').value.trim(), email: $('as-email').value.trim().toLowerCase(), password: $('as-pass').value });
      me = res.user;
      await afterSignIn();
    } catch (err) { $('authErr').textContent = err.message || 'That account could not be created.'; }
  });
  $('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const res = await api('/api/auth/login', 'POST', { email: $('si-email').value.trim().toLowerCase(), password: $('si-pass').value });
      me = res.user;
      await afterSignIn();
    } catch (err) { $('authErr').textContent = err.message || 'That email and password do not match.'; }
  });
  $('btnLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', 'POST', {}); } catch (e) { /* ignore */ }
    location.reload();
  });
  $('btnPeople').addEventListener('click', openPeople);
  $('formPeople').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/people', 'POST', { name: $('pp-name').value.trim(), email: $('pp-email').value.trim().toLowerCase(), password: $('pp-pass').value, role: $('pp-role').value });
      toast('Person added.');
      $('pp-name').value = ''; $('pp-email').value = ''; $('pp-pass').value = '';
      drawPeople();
    } catch (err) { toast(err.message || 'That could not be saved.'); }
  });
  $('btnPeopleBack').addEventListener('click', goHome);

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

  let setups = {}, store = null, me = null;

  async function afterSignIn() {
    drawMast();
    await loadState();
    ui.filter = defaultFilter();
    goHome();
    setInterval(poll, 4000);
  }

  boot();
`;

// Write the client app (wrap in IIFE)
const final = `(() => {
'use strict';

${out}
})();`;

fs.writeFileSync(path.join(ROOT, 'public', 'app.js'), final, 'utf8');
console.log('wrote public/app.js (' + final.length + ' bytes)');
