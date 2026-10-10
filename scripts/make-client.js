/* ======================================================================
   One-time migration: build public/app.js from the prototype
   ----------------------------------------------------------------------
   Takes the prototype's section 6 (screens) and DOM helpers, then wraps
   them with a Firebase client-side data layer (Firestore + Auth) so the
   app runs as a static site on Firebase Hosting (Spark plan compatible).
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
// 5. onPdf: client-side PDF (already built)
// 6. exportData: direct JSON download
// 7. newTicket: async Firestore create
// 8. move: async Firestore action
// 9. delete ticket: async Firestore delete
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

// 4. onPdf: client-side PDF (already built)
out = out.replace(
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
  }`,
  `  async function onPdf() {
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
  }`
);

// 5. exportData: direct JSON download
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
    const data = JSON.stringify({ exportedAt: Rules.nowISO(), templates: setups, tickets: store.tickets }, null, 2);
    saveFile('quest-estimating-export.json', data, 'application/json');
    toast('Exported quest-estimating-export.json');
  }`
);

// 6. newTicket: async Firestore create
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
    const t = Rules.blankTicket(tpl, 'T-' + store.seq++), only = setups[tpl].jobs;
    t.s.estimator = me.name || '';
    if (only.length === 1) t.s.jobs[only[0].id] = true; // one scope of work: nothing to pick
    store.tickets.unshift(t);
    saveStore();
    openTicket(t.id, 'scope');
  }`
);

// 7. move: async Firestore action
out = out.replace(
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
  }`,
  `  // Status moves. This is the whole approval rulebook.
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
      if (me.role !== 'approver' || t.status !== 'submitted') return;
      const snapshot = Rules.buildModel(t.s, Rules.tplOf(t), Rules.calcOf(t).quote, Rules.pricedLines(t));
      Object.assign(t, { status: 'approved', decidedAt: now, note: Rules.clean(ui.note), snapshot });
      Rules.logIt(t, 'Approved', t.note);
      toast('Approved. The proposal PDF is unlocked.');
    } else if (kind === 'sendback') {
      if (me.role !== 'approver' || t.status !== 'submitted') return;
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
  }`
);

// 8. delete ticket: async Firestore delete
out = out.replace(
  `        twice('p-delete', 'del:' + t.id, 'Delete ticket', 'Tap again to delete it', 'danger', async () => {
          try { await api('/api/tickets/' + t.id + '/delete', 'POST', {}); } catch (e) { toast('The ticket could not be deleted.'); return; }
          store.tickets = store.tickets.filter(x => x !== t); saveStore(); goHome(); toast('Ticket deleted.');
        })`,
  `        twice('p-delete', 'del:' + t.id, 'Delete ticket', 'Tap again to delete it', 'danger', async () => {
          try {
            await ticketsCol.doc(t.id).delete();
            store.tickets = store.tickets.filter(x => x !== t);
            saveStore();
            goHome();
            toast('Ticket deleted.');
          } catch (e) { toast('The ticket could not be deleted.'); }
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

// 11. Append saveFile + client-side boot/data layer (direct Firestore + Auth)
const bootClient = fs.readFileSync(path.join(__dirname, 'boot-client.js'), 'utf8');

out = out + bootClient;

// Write the client app (wrap in IIFE)
const final = `(() => {
'use strict';

${out}
})();`;

fs.writeFileSync(path.join(ROOT, 'public', 'app.js'), final, 'utf8');
console.log('wrote public/app.js (' + final.length + ' bytes)');