(() => {
'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  const $ = id => document.getElementById(id);

  // Tiny DOM builder. Text always goes in through textContent, never innerHTML.
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = true;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c);
    return e;
  }
  function svg(tag, attrs, ...kids) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    for (const c of kids) e.append(c);
    return e;
  }
  const ICONS = {
    up: 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
    down: 'M8 3v10M3.5 8.5 8 13l4.5-4.5',
    x: 'M4 4l8 8M12 4l-8 8',
    chev: 'M6 3l5 5-5 5',
    plus: 'M8 3v10M3 8h10'
  };
  const icon = name => svg('svg', {
    viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  }, svg('path', { d: ICONS[name] }));

  /* ---------- 6. Screens ---------- */

  const ui = { view: 'home', id: null, tab: 'scope', filter: 'all', showErrors: false, note: '', noteErr: false };
  const cur = () => store.tickets.find(t => t.id === ui.id) || null;

  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    clearTimeout(toastTimer);
    el.textContent = text || '';
    el.hidden = !text;
    // In Setup the save bar sits where the toast would land, so the toast goes above it.
    const bar = text && ui.view === 'setup' ? document.querySelector('.setup-bar') : null;
    const top = bar ? bar.getBoundingClientRect().top : 0;
    el.style.bottom = top > 0 && top < window.innerHeight ? `${Math.round(window.innerHeight - top + 10)}px` : '';
    if (text) toastTimer = setTimeout(() => { el.hidden = true; }, 5200);
  }

  // Two-press confirm for the few destructive buttons (the viewer has no confirm dialog).
  // The second press counts only after a beat, so a double-click is one press, not two.
  let armedKey = '', armedTimer = 0, armedAt = 0;
  const disarm = () => { armedKey = ''; clearTimeout(armedTimer); };
  function pressedTwice(key, redraw) {
    if (armedKey === key && performance.now() - armedAt < 600) return false;
    clearTimeout(armedTimer);
    if (armedKey === key) { armedKey = ''; return true; }
    armedKey = key; armedAt = performance.now();
    armedTimer = setTimeout(() => { armedKey = ''; redraw(false); }, 5000);
    redraw(true);
    return false;
  }
  // When the action buttons change under the pointer (a ticket opens, its status moves),
  // presses on them are ignored for a moment. Without this the second half of a
  // double-click lands on a button that was not there when the click began, and a ticket
  // gets approved or pulled back by accident.
  let quietUntil = 0;
  const hush = () => { quietUntil = performance.now() + 400; };


  function showView() {
    for (const v of ['Home', 'Ticket', 'Setup', 'Auth', 'People']) $('view' + v).hidden = ui.view !== v.toLowerCase();
    $('btnSetup').hidden = ui.view === 'setup';
  }
  const pill = st => h('span', { class: 'pill', 'data-s': st, text: STATUS[st] });
  const stat = (label, value) => h('span', null, h('small', { text: label }), value);
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

  /* ----- ticket queue ----- */

  const defaultFilter = () => (me.role === 'approver' && store.tickets.some(t => t.status === 'submitted') ? 'submitted' : 'all');

  function goHome() {
    ui.view = 'home'; ui.id = null; disarm();
    showView(); drawHome();
    window.scrollTo(0, 0);
  }

  function drawHome() {
    const ids = Object.keys(setups);
    $('newBtns').replaceChildren(...[
      ...(ids.length <= 3
        ? ids.map(id => h('button', { type: 'button', class: 'btn primary', id: 'btnNew-' + id, onclick: () => newTicket(id), text: `New ${setups[id].name.toLowerCase()} ticket` }))
        : [h('label', { class: 'vh', for: 'selNew', text: 'New ticket' }),
          h('select', { class: 'newsel', id: 'selNew', onchange: e => { const id = e.target.value; e.target.value = ''; if (setups[id]) newTicket(id); } },
            h('option', { value: '', text: 'New ticket\u2026' }), ids.map(id => h('option', { value: id, text: setups[id].name })))]),
      // A template for another kind of work starts here. It opens in Setup.
      ids.length < MAX_SCOPES ? h('button', { type: 'button', class: 'btn add dash', id: 'btnAddScope', onclick: () => openSetup(draftTpl, { add: true }), text: 'New template' }) : null
    ].filter(Boolean));

    const order = { submitted: 0, returned: 1, draft: 2, approved: 3 };
    const all = store.tickets.slice().sort((a, b) =>
      (me.role === 'approver' ? order[a.status] - order[b.status] : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const count = st => all.filter(t => t.status === st).length;
    const filters = [['all', 'All', all.length], ['draft', 'Drafts', count('draft')], ['submitted', 'Waiting for approval', count('submitted')], ['returned', 'Sent back', count('returned')], ['approved', 'Approved', count('approved')]];
    $('filters').replaceChildren(...filters.map(([key, label, n]) =>
      h('button', { type: 'button', class: 'fchip', 'data-s': key, 'aria-pressed': String(ui.filter === key), onclick: () => { ui.filter = key; drawHome(); } }, label, h('b', { text: String(n) }))));

    const shown = all.filter(t => ui.filter === 'all' || t.status === ui.filter);
    const fact = (f, cls) => h('span', { class: 'c-num ' + cls, 'data-label': f.label, 'data-k': f.kind === 'warn' || f.kind === 'bad' ? f.kind : null },
      f.margin == null ? DASH : [money(f.value), h('small', { text: f.text })]);

    const rows = shown.map(t => {
      const calc = calcOf(t), m = modelOf(t, calc), flags = flagsOf(t, calc);
      const worst = flags.some(f => f.level === 'bad') ? 'bad' : 'warn';
      return h('button', { type: 'button', class: 'trow', 'data-s': t.status, onclick: () => openTicket(t.id) },
        h('span', { class: 'c-status' }, pill(t.status),
          flags.length ? h('span', { class: 'flagn', 'data-l': worst, title: flags.map(f => f.text).join(' ') }, `${flags.length} ${flags.length === 1 ? 'flag' : 'flags'}`) : null),
        h('span', { class: 'c-who' },
          h('strong', { text: m.client.name || 'No client yet' }),
          h('span', { class: 'sub', text: subLine(t, m.heading) })),
        h('span', { class: 'c-num c-quote', 'data-label': 'Quote', text: calc.quote > 0 ? money(calc.quote) : DASH }),
        fact(calc.facts[0], 'c-pa'),
        fact(calc.facts[1], 'c-pb'),
        h('span', { class: 'c-meta', text: [clean(t.s.estimator) || 'No estimator', dayOf(t.updatedAt)].filter(Boolean).join(' · ') }));
    });
    if (!rows.length) rows.push(h('p', { class: 'empty' }, all.length ? 'No tickets with this status.' : 'No tickets yet. Start one with the buttons above.'));
    $('tlist').replaceChildren(...rows);
  }

  /* ----- one ticket ----- */

  let panelSig = '';

  function openTicket(id, tab) {
    const t = store.tickets.find(x => x.id === id);
    if (!t) { goHome(); return; }
    Object.assign(ui, { view: 'ticket', id, showErrors: false, note: '', noteErr: false });
    disarm(); panelSig = ''; hush();
    $('statusPanel').replaceChildren(); // never leave another ticket's buttons on screen
    buildForms(t);
    showView();
    $('copyBox').hidden = true;
    $('pagesMain').classList.remove('zoomed');
    $('btnZoom').setAttribute('aria-pressed', 'false'); $('btnZoom').textContent = 'Zoom in';
    setTab(tab || (me.role === 'approver' && t.status === 'submitted' ? 'uw' : t.status === 'approved' ? 'proposal' : 'scope'), true);
    refreshTicket();
    window.scrollTo(0, 0);
  }

  // The scope questions are drawn from the template, so new questions and options show
  // up here without touching this code.
  // `t` is passed when the viewer may change the setup from this ticket (approver, open ticket).
  const editLink = (what, label) => h('button', { type: 'button', class: 'linkbtn', 'data-edit': what, text: label || 'Edit' });
  function choiceBlock(q, t) {
    const p = 'q-' + q.id, nm = lowFirst(q.short || '');
    const radio = (v, label) => [h('input', { type: 'radio', name: p, id: `${p}-${v}`, value: v }), h('label', { for: `${p}-${v}`, text: label })];
    const kids = [
      h('div', { class: 'q-top' }, h('p', { class: 'q-label', id: p + '-l', text: q.label }), t ? editLink('q:' + q.id) : null),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': p + '-l' }, radio('yes', 'Yes'), radio('no', 'No, by others'), q.na ? radio('na', 'Not needed') : null)
    ];
    if (q.options.length || q.other) {
      const f = [];
      if (q.options.length) {
        f.push(h('p', { class: 'q-sub', id: p + '-s' }, nm ? `Which ${nm}?` : 'Which ones?', q.need ? null : h('span', { class: 'opt', text: ' optional' })));
        f.push(h('div', { class: 'chips', role: 'group', 'aria-labelledby': p + '-s' },
          q.options.map(o => [h('input', { type: 'checkbox', id: `${p}-opt-${o.id}` }), h('label', { for: `${p}-opt-${o.id}`, text: o.label })])));
      }
      if (t) { const host = h('div', { class: 'adder' }); drawAdder(host, 'Add option', 'Option name', name => addOptionHere(t, q.id, name)); f.push(host); }
      if (q.other) {
        f.push(h('div', { class: 'field' },
          h('label', { for: p + '-other' }, nm ? `Other ${nm}` : 'Something else', h('span', { class: 'opt', text: q.need && !q.options.length ? '' : ' optional' })),
          h('input', { class: 'text', type: 'text', id: p + '-other', maxlength: 80 })));
      }
      kids.push(h('div', { class: 'follow', id: p + '-f', hidden: true }, f));
    }
    return h('div', { class: 'q', id: p + '-b' }, kids);
  }
  const textBlock = (q, t) => h('div', { class: 'field', id: `q-${q.id}-b` },
    h('div', { class: 'q-top' }, h('label', { class: 'q-label', for: `q-${q.id}-text`, text: q.label }), t ? editLink('q:' + q.id) : null),
    h('input', { class: 'text', type: 'text', id: `q-${q.id}-text`, maxlength: 80, placeholder: q.def || null }));

  // "+ Add" that opens into a small box: type a name, press Enter. It lets the approver add
  // a scope of work or an option to the template without leaving the ticket.
  function drawAdder(host, text, placeholder, onAdd) {
    const closed = focus => { host.replaceChildren(h('button', { type: 'button', class: 'btn add', onclick: open, text })); if (focus) host.firstChild.focus(); };
    const open = () => {
      const box = h('input', { class: 'text', type: 'text', maxlength: 40, placeholder, 'aria-label': text });
      const go = () => { const v = clean(box.value); if (v) onAdd(v); else box.focus(); };
      // This box is not one of the ticket's answers, so the form must not hear it.
      for (const type of ['input', 'change']) box.addEventListener(type, e => e.stopPropagation());
      box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') closed(true); });
      host.replaceChildren(box, h('button', { type: 'button', class: 'btn primary', onclick: go, text: 'Add' }), h('button', { type: 'button', class: 'btn quiet', onclick: () => closed(true), text: 'Cancel' }));
      box.focus();
    };
    closed(false);
  }
  // A change to a template: saved at once, and every open draft on that template
  // follows it. Setup's Save button and the Add boxes on a ticket both end up here.
  function applySetup(tplId, next) {
    const old = setups[tplId];
    setups[tplId] = next;
    store.templates[tplId] = next;
    for (const x of store.tickets) {
      if (x.tpl !== tplId || !editable(x)) continue;
      if (x.s.footer === old.footer) x.s.footer = next.footer;
      reconcileScope(x.s, next);
      reconcileUw(x.uw, next);
    }
    saveStore();
  }
  function changeSetup(tplId, mutate) {
    const copy = clone(setups[tplId]);
    mutate(copy);
    const next = normalizeSetup(copy, copy.sheet);
    if (next) applySetup(tplId, next);
    return !!next;
  }
  function addJobHere(t, name) {
    const su = setups[t.tpl], same = su.jobs.find(j => sameName(j.label, name));
    let id = same ? same.id : uid('j');
    if (!same) {
      if (su.jobs.length >= 24) { toast('That is the most one template can hold.'); return; }
      while (su.jobs.some(j => j.id === id)) id = uid('j');
      if (!changeSetup(t.tpl, x => { x.jobs.push({ id, label: name, heading: '', items: [] }); })) return;
    }
    t.s.jobs[id] = true;
    touch(t); buildForms(t); refreshTicket();
    if ($('job-' + id)) $('job-' + id).focus();
    toast(same ? `${same.label} is already on the list.` : `${name} added to the ${setups[t.tpl].name} template.`);
  }
  function addOptionHere(t, qid, name) {
    const q = setups[t.tpl].questions.find(x => x.id === qid);
    if (!q || q.kind !== 'choice') return;
    const same = q.options.find(o => sameName(o.label, name));
    let id = same ? same.id : uid('o');
    if (!same) {
      if (q.options.length >= 40) { toast('That is the most options one question can hold.'); return; }
      while (q.options.some(o => o.id === id)) id = uid('o');
      if (!changeSetup(t.tpl, x => { x.questions.find(y => y.id === qid).options.push({ id, label: name }); })) return;
    }
    const a = t.s.ans[qid];
    if (a) { a.a = 'yes'; a.opts[id] = true; }
    touch(t); buildForms(t); refreshTicket();
    if ($(`q-${qid}-opt-${id}`)) $(`q-${qid}-opt-${id}`).focus();
    toast(same ? `${same.label} is already on the list.` : `${name} added to the ${setups[t.tpl].name} template.`);
  }

  // Taking a box off the page makes Chrome send one last "change" from it if it had the
  // cursor. Reading the form at that moment would copy a half-built page over the ticket's
  // answers, so the listeners stand down until the rebuild is done.
  let building = false;
  function buildForms(t) { building = true; try { drawForms(t); } finally { building = false; } }

  function drawForms(t) {
    const su = tplOf(t), s = t.s, roof = su.sheet === 'roofing';
    if (editable(t)) { foldExtras(s); reconcileScope(s, su); reconcileUw(t.uw, su); }

    // The scope of work, above the tabs: the questions, the sheet and the proposal heading
    // all follow from it. On an open ticket the list can be added to on the spot, and the
    // template behind it can be changed or swapped for another.
    const canEdit = editable(t), me = canEdit ? t : null;
    const adder = canEdit ? h('div', { class: 'adder', id: 'jobAdder' }) : null;
    $('jobChips').replaceChildren(...[
      ...su.jobs.flatMap(j => [h('input', { type: 'checkbox', id: 'job-' + j.id }), h('label', { for: 'job-' + j.id, text: j.label })]),
      adder
    ].filter(Boolean));
    if (adder) drawAdder(adder, 'Add scope of work', 'Name of the scope of work', name => addJobHere(t, name));
    const ids = Object.keys(setups);
    $('sbTpl').replaceChildren(...[
      ...ids.map(id => h('option', { value: id, text: setups[id].name })),
      setups[t.tpl] ? null : h('option', { value: t.tpl, text: su.name }),
      canEdit && ids.length < MAX_SCOPES ? h('option', { value: '+', text: '+ New template\u2026' }) : null
    ].filter(Boolean));
    $('sbTpl').value = t.tpl;
    tplAsk = ''; drawTplAsk(t);
    $('scopeDyn').replaceChildren(...su.questions.map(q => (q.kind === 'text' ? textBlock(q, me) : choiceBlock(q, me))));
    for (const k of FORM_TEXT) $('f-' + k).value = s[k] == null ? '' : s[k];
    $('f-showEx').checked = !!s.showEx;
    for (const j of su.jobs) $('job-' + j.id).checked = !!s.jobs[j.id];
    drawItems(t);
    for (const q of su.questions) {
      const a = s.ans[q.id] || blankAns(q), p = 'q-' + q.id;
      if (q.kind === 'text') { $(p + '-text').value = a.text || ''; continue; }
      for (const v of ['yes', 'no', 'na']) { const el = $(`${p}-${v}`); if (el) el.checked = a.a === v; }
      for (const o of q.options) $(`${p}-opt-${o.id}`).checked = !!(a.opts && a.opts[o.id]);
      const oe = $(p + '-other'); if (oe) oe.value = a.other || '';
    }

    // underwriting: one block per sheet type
    $('uwCrew').hidden = roof;
    $('uwRoof').hidden = !roof;
    $('u-notes').value = t.notes || '';
    if (roof) {
      const isRoofing = t.tpl === 'roofing';
      $('g-meas').hidden = !su.measure;
      $('hint-rlabor').textContent = isRoofing ? 'Piece rate. The crew is paid a set amount per square for the kind of roof, plus the extras on this job.' : 'Piece rate. Put a quantity on each line this job pays for.';
      $('hint-mats').textContent = `Prices come from the price book in Setup. Put a quantity on what this ${isRoofing ? 'roof' : 'job'} needs.`;
      for (const k of ['perimeter', 'ridge', 'valley']) $('u-' + k).value = t.uw.meas[k] || '';
      buildMeas(t);
      for (const key of ROOF_LISTS) buildRoofLines(t, key);
    } else {
      $('u-mode-sqft').checked = t.uw.mode !== 'lump';
      $('u-mode-lump').checked = t.uw.mode === 'lump';
      for (const k of ['sqft', 'rate', 'lump']) $('u-' + k).value = t.uw[k] || '';
      buildCrews(t);
      buildSupplies(t);
    }
  }

  // "Work included" on the Scope tab: one box per line. The wording is free, a line can
  // be removed, and lines can be added. Presets live on the scope of work, in Setup.
  function drawItems(t) {
    const s = t.s, su = tplOf(t), open = editable(t), shown = itemsShown(s);
    // A locked ticket from before there were lines still carries its extras in the old box.
    const legacy = open ? [] : String(s.extraIn || '').split(/\n+/).map(clean).filter(Boolean);
    $('itemRows').replaceChildren(
      ...shown.map((it, i) => h('div', { class: 'item' },
        h('input', { class: 'text', type: 'text', id: 'it-' + it.id, value: it.text, maxlength: 120, placeholder: 'What is included', 'aria-label': `Included line ${i + 1}` }),
        h('button', { type: 'button', class: 'ibtn', 'aria-label': `Remove line ${i + 1}`, 'data-rmitem': it.id }, icon('x')))),
      ...legacy.map(text => h('div', { class: 'item' }, h('input', { class: 'text', type: 'text', value: text, readonly: true, 'aria-label': 'Included line' }), h('span'))));
    const picked = su.jobs.filter(j => s.jobs[j.id]), anyPreset = su.jobs.some(j => (j.items || []).length);
    const gone = s.items.filter(it => it.off && s.jobs[it.job]).length;
    $('itemsHint').textContent = !open ? (shown.length || legacy.length ? 'These lines print on the proposal.' : 'No lines.')
      : shown.length ? 'Preset for the scope of work picked. Reword a line, remove it, or add your own. They print on the proposal.'
        : !picked.length && anyPreset ? 'Pick a scope of work above and its preset lines show up here.'
          : 'No preset lines for this scope of work yet. Add them here for this job, or set them once with Edit presets.';
    const back = $('btnItemsBack');
    back.hidden = !open || !gone;
    back.textContent = `Put back ${gone} removed ${gone === 1 ? 'line' : 'lines'}`;
  }
  function onItemClick(e) {
    const t = cur(), b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t || !b || !editable(t)) return;
    const s = t.s, done = id => { touch(t); drawItems(t); refreshTicket(); const f = $(id); if (f) f.focus(); };
    if (b.id === 'btnAddItem') {
      if (itemsShown(s).length >= MAX_ITEMS) { toast('That is the most lines one ticket can hold.'); return; }
      const it = { id: uid('i'), text: '' };
      s.items.push(it);
      done('it-' + it.id);
    } else if (b.id === 'btnItemsBack') {
      for (const it of s.items) if (it.off && s.jobs[it.job]) delete it.off;
      done('btnAddItem');
    } else if (b.dataset.rmitem) {
      const shown = itemsShown(s), i = shown.findIndex(it => it.id === b.dataset.rmitem), it = shown[i];
      if (!it) return;
      // A preset line is marked, so it stays away when the template is reconciled. A typed line just goes.
      if (it.pid) it.off = true; else s.items.splice(s.items.indexOf(it), 1);
      const next = shown[i + 1] || shown[i - 1];
      done(next ? 'it-' + next.id : 'btnAddItem');
    }
  }

  // The template picker on a ticket. Another template brings its own questions and its own
  // sheet, so the answers and numbers typed so far cannot come along. A ticket that has
  // none yet just moves; otherwise it asks first.
  let tplAsk = '';
  function pristine(t) {
    const su = tplOf(t), s = t.s;
    if (clean(s.extraIn) || clean(s.extraEx) || clean(s.heading)) return false;
    if ((s.items || []).some(it => it.off || (it.pid ? it.text !== it.was : clean(it.text)))) return false;
    for (const q of su.questions) {
      const a = s.ans[q.id];
      if (!a) continue;
      if (q.kind === 'text' ? clean(a.text) && clean(a.text) !== clean(q.def) : a.a || clean(a.other) || Object.keys(a.opts || {}).length) return false;
    }
    const u = t.uw, any = list => (list || []).some(l => num(l.qty) > 0 || num(l.cost) > 0 || l.custom);
    if (su.sheet === 'roofing') return !(any(u.sell) || any(u.labor) || any(u.mats) || u.meas.rows.some(r => num(r.sqft) > 0));
    return !(num(u.sqft) > 0 || num(u.rate) > 0 || num(u.lump) > 0 || any(u.supplies) || u.crews.some(c => num(c.count) > 0 || num(c.rate) > 0 || num(c.dA) > 0 || num(c.dB) > 0));
  }
  function retemplate(t, id) {
    const su = setups[id];
    if (!su || !editable(t) || id === t.tpl) return;
    const s = blankScope(su);
    for (const k of ['estimator', 'issued', 'proposalNo', 'name', 'phone', 'email', 'street', 'city', 'state', 'zip']) s[k] = t.s[k];
    s.showEx = t.s.showEx;
    if (su.jobs.length === 1) s.jobs[su.jobs[0].id] = true;
    Object.assign(t, { tpl: id, s, uw: blankUw(su) });
    ui.showErrors = false;
    touch(t); buildForms(t); panelSig = ''; refreshTicket();
    toast(`This ticket now uses the ${su.name} template.`);
  }
  function drawTplAsk(t) {
    const box = $('sbConfirm'), to = setups[tplAsk];
    box.hidden = !to;
    if (!to) { box.replaceChildren(); return; }
    const back = () => { tplAsk = ''; $('sbTpl').value = t.tpl; drawTplAsk(t); $('sbTpl').focus(); };
    box.replaceChildren(
      h('span', { text: `Move this ticket to ${to.name}? The answers and numbers on it now will be cleared.` }),
      h('button', { type: 'button', class: 'btn', id: 'sb-yes', onclick: () => retemplate(t, tplAsk), text: 'Move it' }),
      h('button', { type: 'button', class: 'btn', id: 'sb-no', onclick: back, text: `Keep ${tplOf(t).name}` }));
  }
  function pickTpl(id) {
    const t = cur(), sel = $('sbTpl');
    if (!t) return;
    if (id === '+') { sel.value = t.tpl; openSetup(t.tpl, { id: t.id, tab: ui.tab, add: true }); return; }
    if (!setups[id] || id === t.tpl || !editable(t)) { tplAsk = ''; sel.value = t.tpl; drawTplAsk(t); return; }
    if (pristine(t)) { retemplate(t, id); return; }
    tplAsk = id; drawTplAsk(t);
    $('sb-no').focus();
  }

  function buildCrews(t) {
    $('crewRows').replaceChildren(...t.uw.crews.map((c, i) => {
      const p = 'u-crew-' + c.id;
      const box = (k, label) => h('input', { class: 'text num', type: 'text', inputmode: 'decimal', id: `${p}-${k}`, value: c[k] || '', 'aria-label': `${label}, crew line ${i + 1}`, 'data-crew': c.id, 'data-k': k, 'data-fmt': 'qty' });
      const cell = (k, label) => h('div', { class: 'cell a-' + k }, h('label', { class: 'cl', for: `${p}-${k}`, text: label }), box(k, label));
      const out = (k, label) => h('div', { class: 'cell a-' + k }, h('span', { class: 'cl', text: label }), h('span', { class: 'out', id: `${p}-${k}` }));
      return h('div', { class: 'crew' },
        cell('count', 'Laborers'),
        h('div', { class: 'cell a-rate' }, h('label', { class: 'cl', for: p + '-rate', text: 'Price per laborer' }),
          h('div', { class: 'money sm' }, h('span', { 'aria-hidden': 'true', text: '$' }),
            h('input', { type: 'text', inputmode: 'decimal', id: p + '-rate', value: c.rate || '', 'aria-label': `Price per laborer per day, crew line ${i + 1}`, 'data-crew': c.id, 'data-k': 'rate', 'data-fmt': 'money' }))),
        out('perday', 'Total per day'),
        cell('dA', 'Planned days'),
        out('costA', 'Planned cost'),
        cell('dB', 'Overrun days'),
        out('costB', 'Overrun cost'),
        h('button', { type: 'button', class: 'ibtn x', 'aria-label': `Remove crew line ${i + 1}`, 'data-rmcrew': c.id }, icon('x')));
    }));
  }

  function buildSupplies(t) {
    $('supRows').replaceChildren(...t.uw.supplies.map(l => {
      const id = 'u-sup-' + l.id;
      return h('div', { class: 'sup' },
        h('div', { class: 'sup-id' },
          l.custom
            ? h('input', { class: 'text', type: 'text', id: 'u-supname-' + l.id, value: l.label, maxlength: 40, placeholder: 'What is it', 'aria-label': 'Supply line name', 'data-supname': l.id })
            : h('label', { class: 'sup-name', for: id, text: l.label }),
          h('span', { class: 'tag', id: 'ln-tag-' + l.id, hidden: true })),
        h('div', { class: 'money sm' }, h('span', { 'aria-hidden': 'true', text: '$' }),
          h('input', { type: 'text', inputmode: 'decimal', id, value: l.cost || '', 'aria-label': l.custom ? 'Cost' : null, 'data-sup': l.id, 'data-fmt': 'money' })),
        l.custom ? h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Remove this line', 'data-rmsup': l.id }, icon('x')) : h('span'));
    }));
  }

  // Roofing: the three line lists share one row shape, quantity x unit price = total.
  // Which lines a list shows is decided by roofShown().
  const ROOF_LISTS = ['sell', 'labor', 'mats'];
  const ROOF_HOST = { sell: 'sellRows', labor: 'laborRows', mats: 'matRows' };
  function buildRoofLines(t, key) {
    const host = $(ROOF_HOST[key]), open = editable(t), shown = roofShown(t, key);
    const left = t.uw[key].length - shown.length, s1 = left === 1;
    const bare = open && key !== 'mats' ? jobsBare(t, key) : [];
    host.classList.toggle('has-x', open && shown.some(l => l.custom));
    host.replaceChildren(...[
      shown.length ? h('div', { class: 'ln ln-head', 'aria-hidden': 'true' },
        h('span', { class: 'ln-name' }), h('span', { class: 'cl ln-qty', text: 'Qty' }), h('span', { class: 'cl ln-price', text: 'Unit price' }), h('span', { class: 'cl ln-total', text: 'Total' })) : null,
      ...shown.map(l => {
        const p = 'u-ln-' + l.id, data = { 'data-ln': key, 'data-id': l.id };
        const own = open && l.custom; // a line added on this ticket: it can be renamed and removed
        return h('div', { class: own ? 'ln own' : 'ln' },
          h('div', { class: 'ln-name' },
            l.custom
              ? h('input', Object.assign({ class: 'text', type: 'text', id: p + '-label', value: l.label, maxlength: 80, placeholder: 'What is it', 'aria-label': 'Line name', 'data-k': 'label' }, data))
              : h('label', { for: p + '-qty' }, l.label, l.unit ? h('span', { class: 'opt', text: ' per ' + l.unit }) : null),
            h('span', { class: 'tag', id: 'ln-tag-' + l.id, hidden: true }),
            h('span', { class: 'tag', id: 'ln-book-' + l.id, 'data-k': 'muted', hidden: true })),
          h('input', Object.assign({ class: 'text num ln-qty', type: 'text', inputmode: 'decimal', id: p + '-qty', value: l.qty || '', placeholder: 'Qty', 'aria-label': l.custom ? 'Quantity' : null, 'data-k': 'qty', 'data-fmt': 'qty' }, data)),
          h('div', { class: 'money sm ln-price' }, h('span', { 'aria-hidden': 'true', text: '$' }),
            h('input', Object.assign({ type: 'text', inputmode: 'decimal', id: p + '-price', value: l.price || '', 'aria-label': l.custom ? 'Unit price' : `Unit price, ${l.label}`, 'data-k': 'price', 'data-fmt': 'money' }, data))),
          h('span', { class: 'out ln-total', id: p + '-total' }),
          own ? h('button', { type: 'button', class: 'ibtn ln-x', 'aria-label': 'Remove this line', 'data-rmln': key, 'data-id': l.id }, icon('x')) : null);
      }),
      left ? h('p', {
        class: 'ln-note', text: !shown.length ? (open ? 'No lines for this scope of work. Add one below.' : 'Nothing has a quantity here.')
          : `${left} ${s1 ? 'line' : 'lines'} ${open ? 'for other scopes of work' : 'with no quantity'} ${s1 ? 'is' : 'are'} not shown.`
      }) : null,
      bare.length ? h('p', { class: 'ln-note', 'data-bare': key },
        `${bare.map(j => j.label).join(', ')} ${bare.length === 1 ? 'has' : 'have'} no ${key === 'sell' ? 'client price' : 'labor rate'} set up yet. `,
        h('button', { type: 'button', class: 'linkbtn', 'data-edit': `line:${key}:${bare[0].id}`, text: 'Set one up' }), ', or add a line below for this job only.') : null
    ].filter(Boolean));
  }
  function buildMeas(t) {
    $('measRows').replaceChildren(...t.uw.meas.rows.map((r, i) => {
      const p = 'u-pitch-' + r.id, n = i + 1;
      return h('div', { class: 'mrow' },
        h('div', { class: 'cell m-pitch' }, h('label', { class: 'cl', for: p + '-pitch', text: 'Pitch' }),
          h('div', { class: 'money sm' },
            h('input', { type: 'text', inputmode: 'decimal', id: p + '-pitch', value: r.pitch || '', 'aria-label': `Pitch, rise in 12, row ${n}`, 'data-pitch': r.id, 'data-k': 'pitch', 'data-fmt': 'qty' }),
            h('span', { 'aria-hidden': 'true', text: '/12' }))),
        h('div', { class: 'cell m-sqft' }, h('label', { class: 'cl', for: p + '-sqft', text: 'Flat SQFT' }),
          h('input', { class: 'text num', type: 'text', inputmode: 'decimal', id: p + '-sqft', value: r.sqft || '', 'aria-label': `Flat square feet, row ${n}`, 'data-pitch': r.id, 'data-k': 'sqft', 'data-fmt': 'qty' })),
        h('div', { class: 'cell m-true' }, h('span', { class: 'cl', text: 'True SQFT' }), h('span', { class: 'out', id: p + '-true' })),
        h('div', { class: 'cell m-sq' }, h('span', { class: 'cl', text: 'Squares' }), h('span', { class: 'out', id: p + '-sq' })),
        h('button', { type: 'button', class: 'ibtn m-x', 'aria-label': `Remove pitch row ${n}`, 'data-rmpitch': r.id }, icon('x')));
    }));
  }

  function readScope(t) {
    const s = t.s, su = tplOf(t);
    for (const k of FORM_TEXT) s[k] = $('f-' + k).value;
    s.showEx = $('f-showEx').checked;
    for (const it of s.items) { const el = $('it-' + it.id); if (el) it.text = el.value; }
    for (const j of su.jobs) { const el = $('job-' + j.id); if (el) s.jobs[j.id] = el.checked; }
    for (const q of su.questions) {
      const p = 'q-' + q.id, a = blankAns(q);
      if (q.kind === 'text') {
        const el = $(p + '-text'); if (!el) continue;
        a.text = el.value;
      } else {
        if (!$(p + '-yes')) continue;
        const r = $('scopeForm').querySelector(`input[name="${p}"]:checked`);
        a.a = r ? r.value : '';
        for (const o of q.options) { const el = $(`${p}-opt-${o.id}`); if (el && el.checked) a.opts[o.id] = true; }
        const oe = $(p + '-other'); a.other = oe ? oe.value : '';
      }
      s.ans[q.id] = a;
    }
    store.lastEstimator = clean(s.estimator) || store.lastEstimator;
  }

  function touch(t) { t.updatedAt = nowISO(); saveStore(); }

  function setTab(tab, stay) {
    ui.tab = tab;
    const bench = $('bench');
    bench.dataset.tab = tab;
    $('scopeForm').hidden = tab !== 'scope';
    $('uwPane').hidden = tab !== 'uw';
    $('propPane').hidden = tab !== 'proposal';
    $('railPreview').hidden = tab !== 'scope';
    $('railSummary').hidden = tab !== 'uw';
    for (const k of ['scope', 'uw', 'proposal']) $('tab-' + k).setAttribute('aria-selected', String(k === tab));
    // Swapping panes changes the page height, so bring the new pane up under the tabs.
    if (!stay && bench.getBoundingClientRect().top < 72) {
      try { bench.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (e) { bench.scrollIntoView(); }
    }
  }

  function goTo(item) {
    if (item.tab && item.tab !== ui.tab) setTab(item.tab, true);
    const el = $(item.id);
    if (!el) return;
    const holder = el.closest('.q, .field, .cell, .sup, .ln, .scopebar') || el;
    try { holder.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { holder.scrollIntoView(); }
    holder.classList.remove('nudge');
    void holder.offsetWidth;
    holder.classList.add('nudge');
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  const todoList = todo => h('ul', null, todo.map(it => h('li', null, h('button', { type: 'button', onclick: () => goTo(it), text: it.text }))));
  const flagList = flags => h('ul', { class: 'checks' }, flags.map(f => h('li', { 'data-l': f.level, text: f.text })));

  // The strip under the title: where the ticket stands and the one thing to do next.
  function drawPanel(t, calc, todo, flags) {
    const role = me.role, st = t.status;
    const sig = JSON.stringify([t.id, st, role, todo.map(x => x.text + '>' + x.id), flags.map(x => x.text), armedKey, pdfBusy, ui.noteErr, t.note, t.decidedAt, t.submittedAt, t.log.length, calc.quote, calc.facts.map(f => f.value)]);
    if (sig === panelSig) return;
    panelSig = sig;

    const redraw = id => focus => { panelSig = ''; refreshTicket(); if (focus && $(id)) $(id).focus(); };
    const twice = (id, key, label, armedLabel, cls, act) => h('button', {
      type: 'button', class: 'btn ' + cls, id, text: armedKey === key ? armedLabel : label,
      onclick: () => { if (pressedTwice(key, redraw(id))) act(); }
    });
    const kids = [];

    if (st === 'draft' || st === 'returned') {
      if (st === 'returned' && t.note) {
        kids.push(h('div', { class: 'noteback' }, h('strong', { text: 'Sent back' + (t.decidedAt ? ' ' + when(t.decidedAt) : '') }), h('p', { text: t.note })));
      }
      if (todo.length) {
        kids.push(h('p', { class: 'ptitle', text: `${todo.length} ${todo.length === 1 ? 'thing' : 'things'} to finish before approval` }));
        kids.push(h('div', { class: 'todo' }, todoList(todo)));
      } else {
        kids.push(h('p', { class: 'ptitle', text: 'Ready for approval' }));
        kids.push(h('p', { class: 'psub', text: 'Scope and underwriting are filled in.' + (flags.length ? ` The approver will see ${flags.length} ${flags.length === 1 ? 'flag' : 'flags'}.` : '') }));
      }
      kids.push(h('div', { class: 'pactions' },
        h('button', { type: 'button', class: 'btn primary', id: 'p-submit', onclick: () => move('submit'), text: st === 'returned' ? 'Resubmit for approval' : 'Submit for approval' }),
        twice('p-delete', 'del:' + t.id, 'Delete ticket', 'Tap again to delete it', 'danger', () => {
          store.tickets = store.tickets.filter(x => x !== t); saveStore(); goHome(); toast('Ticket deleted.');
        })));
    } else if (st === 'submitted' && role === 'approver') {
      const fact = f => h('span', { 'data-k': f.kind === 'warn' || f.kind === 'bad' ? f.kind : null }, h('small', { text: f.label }),
        f.margin == null ? DASH : `${money(f.value)} (${f.text})`);
      kids.push(h('p', { class: 'ptitle', text: 'Needs your approval' }));
      kids.push(h('p', { class: 'psub', text: `Submitted ${when(t.submittedAt)}${clean(t.s.estimator) ? ' by ' + clean(t.s.estimator) : ''}.` }));
      kids.push(h('div', { class: 'pfacts' }, h('span', null, h('small', { text: 'Client quote' }), money(calc.quote)), calc.facts.map(fact)));
      if (flags.length) kids.push(flagList(flags));
      if (clean(t.notes)) kids.push(h('p', { class: 'psub', text: 'Estimator: ' + String(t.notes).trim() }));
      kids.push(h('div', { class: 'field' + (ui.noteErr ? ' invalid' : '') },
        h('label', { for: 'p-note' }, 'Note to the estimator', h('span', { class: 'opt', text: ' needed to send it back' })),
        h('textarea', { class: 'text', id: 'p-note', rows: 2, maxlength: 400, value: ui.note, oninput: e => { ui.note = e.target.value; } })));
      kids.push(h('div', { class: 'pactions' },
        h('button', { type: 'button', class: 'btn primary', id: 'p-approve', onclick: () => move('approve'), text: 'Approve' }),
        h('button', { type: 'button', class: 'btn', id: 'p-sendback', onclick: () => move('sendback'), text: 'Send back' }),
        h('button', { type: 'button', class: 'btn quiet', id: 'p-reopen', onclick: () => move('reopen'), text: 'Edit it myself' })));
    } else if (st === 'submitted') {
      kids.push(h('p', { class: 'ptitle', text: 'Waiting for approval' }));
      kids.push(h('p', { class: 'psub', text: `Submitted ${when(t.submittedAt)}. It is locked while it is being reviewed.` }));
      kids.push(h('div', { class: 'pactions' }, h('button', { type: 'button', class: 'btn', id: 'p-pull', onclick: () => move('reopen'), text: 'Pull it back to edit' })));
    } else {
      kids.push(h('p', { class: 'ptitle', text: 'Approved' }));
      kids.push(h('p', { class: 'psub', text: `Approved ${when(t.decidedAt)}.` + (t.note ? ` Note: ${t.note}` : '') }));
      kids.push(h('div', { class: 'pactions' },
        jsPDF ? h('button', { type: 'button', class: 'btn primary', id: 'p-pdf', disabled: pdfBusy, onclick: onPdf, text: pdfBusy ? 'Building PDF…' : 'Download proposal PDF' }) : null,
        twice('p-reopen', 'reopen:' + t.id, 'Reopen to edit', 'Tap again. It will need approval again.', '', () => move('reopen'))));
    }
    if (t.log.length) {
      kids.push(h('details', { class: 'history' }, h('summary', { text: `History (${t.log.length})` }),
        h('ol', null, t.log.slice().reverse().map(e => h('li', { text: `${when(e.at)}: ${e.what}${e.note ? '. "' + e.note + '"' : ''}` })))));
    }
    const panel = $('statusPanel');
    panel.dataset.state = st;
    panel.replaceChildren(...kids);
  }

  // Recompute everything that depends on the ticket and repaint the outputs.
  // Inputs are never rebuilt here, so typing keeps its focus and caret.
  function refreshTicket() {
    const t = cur();
    if (!t) return;
    const su = tplOf(t), roof = su.sheet === 'roofing', calc = calcOf(t), locked = !editable(t);
    const m = modelOf(t, calc), todo = locked ? [] : todoOf(t, calc), flags = flagsOf(t, calc);

    $('tTitle').textContent = m.client.name || 'New ticket';
    $('tSub').textContent = subLine(t, m.heading);
    $('tPill').dataset.s = t.status;
    $('tPill').textContent = STATUS[t.status];
    $('scopeLock').disabled = locked;
    $('uwLock').disabled = locked;
    // Edit links show for the approver on an open ticket. An estimator is told where they are.
    for (const b of document.querySelectorAll('#viewTicket .apr')) b.hidden = locked;
    // The scope of work above the tabs. A locked ticket says why nothing on it can change.
    $('jobLock').disabled = locked;
    $('sbTpl').disabled = locked;
    $('sbNote').hidden = !locked;
    if (locked) {
      $('sbNote').textContent = t.status === 'approved'
        ? 'Approved and locked. To change anything on it, use "Reopen to edit" above.'
        : `Locked while it waits for approval. To change anything on it, use "${me.role === 'approver' ? 'Edit it myself' : 'Pull it back to edit'}" above.`;
    }

    // scope: questions that apply, follow-ups under a Yes
    for (const q of su.questions) {
      const blk = $(`q-${q.id}-b`);
      if (blk) blk.hidden = !applies(q, t.s);
      const fol = $(`q-${q.id}-f`);
      if (fol) fol.hidden = (t.s.ans[q.id] || {}).a !== 'yes';
    }
    $('follow-ex').hidden = !t.s.showEx;
    $('f-heading').placeholder = buildModel(t.s, su, 0, []).autoHeading;
    $('s-quote').textContent = money(calc.quote);

    // underwriting: computed cells
    if (roof) {
      for (const l of uwLines(t)) {
        const a = lineAmount(l), bk = $('ln-book-' + l.id);
        setText(`u-ln-${l.id}-total`, a > 0 ? money(a) : DASH);
        if (!bk) continue;
        // a price that is not the Setup price says so, for whoever reviews the ticket
        const off = offBook(l) && num(l.book) > 0;
        bk.hidden = !off;
        bk.textContent = off ? `Book price ${money(num(l.book))}` : '';
      }
      setText('r-quote', money(calc.quote));
      setText('r-labor', money(calc.labor));
      setText('r-matsub', money(calc.matSub));
      setText('r-taxlabel', `Sales tax ${fmtRate(calc.taxPct)}%`);
      setText('r-mattax', money(calc.matTax));
      setText('r-mattotal', money(calc.matTotal));
      const mc = measCalc(t.uw.meas);
      for (const r of mc.rows) {
        setText(`u-pitch-${r.id}-true`, r.area > 0 ? fmtNum(r.area) : DASH);
        setText(`u-pitch-${r.id}-sq`, r.area > 0 ? fmtNum(r.squares) : DASH);
      }
      $('measTotal').hidden = mc.rows.length < 2; // one pitch: the row already says it all
      $('measTotal').replaceChildren(
        stat('Flat SQFT', mc.flat > 0 ? fmtQty(mc.flat) : DASH),
        stat('True SQFT', mc.area > 0 ? fmtNum(mc.area) : DASH),
        stat('Squares', mc.area > 0 ? fmtNum(mc.squares) : DASH));
      drawSummaryRoof(calc, flags, su.measure ? mc : null);
    } else {
      $('u-bySqft').hidden = t.uw.mode === 'lump';
      $('u-byLump').hidden = t.uw.mode !== 'lump';
      $('u-quote').textContent = money(calc.quote);
      for (const c of calc.crews) {
        setText(`u-crew-${c.id}-perday`, c.perDay > 0 ? money(c.perDay) : DASH);
        setText(`u-crew-${c.id}-costA`, c.costA > 0 ? money(c.costA) : DASH);
        setText(`u-crew-${c.id}-costB`, c.costB > 0 ? money(c.costB) : DASH);
      }
      $('crewTotal').replaceChildren(
        stat('Total of laborers', fmtQty(calc.laborers)), stat('Per day', money(calc.perDay)),
        stat('Labor, planned', money(calc.laborA)), stat('Labor, overrun', money(calc.laborB)));
      $('supTotal').textContent = money(calc.supplies);
      drawSummaryCrew(calc, flags);
    }
    // each cost line says what the scope expects of it
    const need = roof ? 'needs a quantity' : 'needs a cost', got = roof ? 'has a quantity' : 'has a cost';
    for (const l of uwLines(t)) {
      const tag = $('ln-tag-' + l.id);
      if (!tag) continue;
      const { said, word, must } = scopeSays(t, l.id), clash = clashOf(t, l), has = lineHas(t, l);
      const stray = has && !fitsJob(t, l.id); // a quantity on a line for another scope of work
      // A client price line the scope includes may stay empty, so it gets no tag until it is used.
      tag.hidden = !stray && (!said || (said === 'in' && !must && !has));
      tag.textContent = stray ? 'Other scope' : clash ? (said === 'in' ? `In scope, ${need}` : `${word}, ${got}`) : word;
      tag.dataset.k = stray || clash ? 'warn' : said === 'in' ? 'ok' : 'muted';
    }

    // proposal
    const approved = t.status === 'approved';
    try {
      drawPages($('pagesRail'), m, !approved);
      drawPages($('pagesMain'), m, !approved);
    } catch (err) {
      // A proposal that cannot be drawn must not take the rest of the ticket down with it.
      for (const id of ['pagesRail', 'pagesMain']) { drawn.delete($(id)); $(id).replaceChildren(h('p', { class: 'empty', text: 'This proposal could not be drawn.' })); }
    }
    const canSave = !!jsPDF;
    $('lockNote').textContent = approved ? (canSave ? 'Approved. Ready to send.' : 'Approved. Saving a PDF needs the PDF library to load.') : 'Not approved yet. The PDF unlocks after approval.';
    $('lockNote').dataset.k = approved ? 'ok' : '';

    // tabs carry the count of things left on them
    const left = { scope: todo.filter(x => x.tab === 'scope').length, uw: todo.filter(x => x.tab === 'uw').length };
    $('tab-scope').replaceChildren('Scope', left.scope ? h('span', { class: 'cnt', text: String(left.scope) }) : '');
    $('tab-uw').replaceChildren('Underwriting', left.uw ? h('span', { class: 'cnt', text: String(left.uw) }) : '');

    for (const el of document.querySelectorAll('#scopeForm .invalid, #uwPane .invalid')) el.classList.remove('invalid');
    if (ui.showErrors) {
      for (const it of todo) {
        const el = $(it.id), holder = el && el.closest('.q, .field, .cell, .ln');
        if (holder) holder.classList.add('invalid');
      }
    }
    drawPanel(t, calc, todo, flags);
  }

  const flagBlock = (flags, started) => (flags.length ? flagList(flags)
    : started ? h('ul', { class: 'checks' }, h('li', { 'data-l': 'ok', text: 'No flags. The costs line up with the scope.' }))
      : h('p', { class: 'ehint', text: 'Flags show up here once the quote and the costs are in.' }));
  const sumHead = (a, b) => h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'vh', text: 'Line' })), h('th', { scope: 'col', text: a }), h('th', { scope: 'col', text: b })));

  // Framing: quote, cost and profit for both projections.
  function drawSummaryCrew(calc, flags) {
    const td = (v, k) => h('td', { 'data-k': k || null, text: money(v) });
    const tr = (cls, label, a, b, ka, kb) => h('tr', { class: cls || null }, h('th', { scope: 'row', text: label }), td(a, ka), td(b, kb));
    $('railSummary').replaceChildren(
      h('h3', { text: 'Underwriting' }),
      h('p', { class: 'sum-quote' }, h('span', { text: 'Client quote' }), h('strong', { text: money(calc.quote) })),
      h('table', { class: 'sum-table' }, sumHead('Planned', 'Overrun'),
        h('tbody', null,
          tr('', 'Labor', calc.laborA, calc.laborB),
          tr('', 'Supplies', calc.supplies, calc.supplies),
          tr('total', 'Our total cost', calc.costA, calc.costB),
          tr('profit', 'Projected net profit', calc.profitA, calc.profitB, calc.facts[0].kind, calc.facts[1].kind),
          h('tr', { class: 'margin' }, h('th', { scope: 'row', text: 'Margin' }),
            h('td', { text: calc.marginA == null ? DASH : pct(calc.marginA) }),
            h('td', { text: calc.marginB == null ? DASH : pct(calc.marginB) })))),
      flagBlock(flags, calc.started));
  }

  // Roofing: hard cost, gross profit, commission and what is left.
  function drawSummaryRoof(calc, flags, mc) {
    const of = v => (calc.quote > 0 ? pct2(v / calc.quote) : DASH);
    const tr = (cls, label, v, k) => h('tr', { class: cls || null }, h('th', { scope: 'row', text: label }),
      h('td', { 'data-k': k || null, text: money(v) }), h('td', { class: 'pc', 'data-k': k || null, text: of(v) }));
    $('railSummary').replaceChildren(
      h('h3', { text: 'Underwriting' }),
      h('p', { class: 'sum-quote' }, h('span', { text: 'Client quote' }), h('strong', { text: money(calc.quote) })),
      h('table', { class: 'sum-table' }, sumHead('Amount', 'Of quote'),
        h('tbody', null,
          tr('', 'Labor', calc.labor),
          tr('', 'Materials with tax', calc.matTotal),
          tr('total', 'Total hard cost', calc.hard),
          tr('', 'Gross profit', calc.gross),
          tr('', `Commission ${fmtRate(calc.commissionPct)}%`, calc.commission),
          tr('profit', 'Net profit', calc.net, calc.facts[1].kind))),
      calc.hasSq || (mc && mc.area > 0) ? h('div', { class: 'stats' },
        calc.hasSq ? [
          stat('SQ qty', calc.squares > 0 ? fmtQty(calc.squares) : DASH),
          stat('Cost per SQ', calc.costPerSq == null ? DASH : money(calc.costPerSq)),
          stat('Quote per SQ', calc.quotePerSq == null ? DASH : money(calc.quotePerSq))] : null,
        mc && mc.area > 0 ? stat('Measured SQ', fmtNum(mc.squares)) : null) : null,
      h('p', { class: 'rail-label', text: 'Payment schedule' }),
      h('div', { class: 'stats' }, calc.schedule.map(x => stat(`${fmtRate(x.pct)}%`, money(x.amount)))),
      flagBlock(flags, calc.started));
  }

  /* ticket events */

  function onScopeInput() {
    const t = cur();
    if (building || !t || !editable(t)) return;
    const jobsWere = Object.assign({}, t.s.jobs), linesWere = itemsShown(t.s).length;
    readScope(t);
    if (JSON.stringify(t.s.jobs) !== JSON.stringify(jobsWere)) {
      const su = tplOf(t);
      // A scope of work that is ticked brings its included lines onto the ticket.
      reconcileItems(t.s, su);
      drawItems(t);
      const on = su.jobs.filter(j => t.s.jobs[j.id] && !jobsWere[j.id]), n = itemsShown(t.s).length - linesWere;
      if (on.length && n > 0 && ui.tab !== 'scope') toast(`${on.map(j => j.label).join(', ')}: ${n} included ${n === 1 ? 'line is' : 'lines are'} on the Scope tab, to edit, add to or remove.`);
      // The piece-rate lists show the lines of the scope of work picked, so a new pick redraws them.
      if (su.sheet === 'roofing') for (const key of ROOF_LISTS) buildRoofLines(t, key);
    }
    touch(t);
    refreshTicket();
  }

  function onUwInput(e) {
    const t = cur(), el = e.target;
    if (building || !t || !editable(t) || !el || !el.dataset) return;
    const d = el.dataset, u = t.uw, find = (list, id) => (Array.isArray(list) ? list.find(x => x.id === id) : null);
    if (el.id === 'u-notes') t.notes = el.value;
    else if (el.name === 'uw-mode') { if (el.checked) u.mode = el.value === 'lump' ? 'lump' : 'sqft'; }
    else if (d.uw) u[d.uw] = el.value;
    else if (d.crew) { const c = find(u.crews, d.crew); if (c) c[d.k] = el.value; }
    else if (d.sup) { const l = find(u.supplies, d.sup); if (l) l.cost = el.value; }
    else if (d.supname) { const l = find(u.supplies, d.supname); if (l) l.label = el.value.slice(0, 40); }
    else if (d.ln && ROOF_LISTS.includes(d.ln)) { const l = find(u[d.ln], d.id); if (l && ['qty', 'price', 'label'].includes(d.k)) l[d.k] = el.value.slice(0, 80); }
    else if (d.pitch && u.meas) { const r = find(u.meas.rows, d.pitch); if (r && (d.k === 'pitch' || d.k === 'sqft')) r[d.k] = el.value; }
    else if (d.meas && u.meas && ['perimeter', 'ridge', 'valley'].includes(d.meas)) u.meas[d.meas] = el.value;
    else return;
    touch(t);
    refreshTicket();
  }
  // Tidy a number when the estimator leaves the box: 12507 -> 12,507.00
  function onUwBlur(e) {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.fmt || el.disabled) return;
    const d = el.dataset, t = cur();
    if (NEGATIVE.test(el.value)) toast('That box takes a number above zero. For a discount, lower a unit price.');
    const n = d.pitch && d.k === 'pitch' ? pitchOf(el.value) : num(el.value);
    let next = n > 0 ? (d.fmt === 'money' ? fmtNum(n) : fmtQty(n)) : '';
    // An emptied price goes back to the Setup price, so a line is not left unpriced by accident.
    if (!next && t && d.ln && d.k === 'price' && Array.isArray(t.uw[d.ln])) {
      const l = t.uw[d.ln].find(x => x.id === d.id);
      if (l && !l.custom && num(l.book) > 0) next = fmtNum(num(l.book));
    }
    if (next !== el.value) { el.value = next; onUwInput(e); }
  }
  function onUwClick(e) {
    const t = cur(), b = e.target.closest ? e.target.closest('button') : null;
    if (!t || !b || !editable(t)) return;
    const u = t.uw, d = b.dataset, done = focusId => { touch(t); refreshTicket(); const f = $(focusId); if (f) f.focus(); };
    if (b.id === 'btnAddCrew') {
      const c = blankCrew(u.crews[u.crews.length - 1]);
      u.crews.push(c); buildCrews(t); done(`u-crew-${c.id}-count`);
    } else if (d.rmcrew) {
      u.crews = u.crews.filter(c => c.id !== d.rmcrew);
      if (!u.crews.length) u.crews.push(blankCrew());
      buildCrews(t); done('btnAddCrew');
    } else if (b.id === 'btnAddSup') {
      const l = { id: uid('x'), label: '', cost: '', custom: true };
      u.supplies.push(l); buildSupplies(t); done('u-supname-' + l.id);
    } else if (d.rmsup) {
      u.supplies = u.supplies.filter(l => l.id !== d.rmsup);
      buildSupplies(t); done('btnAddSup');
    } else if (d.addln && ROOF_LISTS.includes(d.addln)) {
      const l = Object.assign({ id: uid('x'), label: '', price: '', qty: '', custom: true }, d.addln === 'mats' ? {} : { unit: '' });
      u[d.addln].push(l); buildRoofLines(t, d.addln); done(`u-ln-${l.id}-label`);
    } else if (d.rmln && ROOF_LISTS.includes(d.rmln)) {
      const addId = b.closest('.group').querySelector('[data-addln]').id;
      u[d.rmln] = u[d.rmln].filter(l => l.id !== d.id);
      buildRoofLines(t, d.rmln); done(addId);
    } else if (b.id === 'btnAddPitch') {
      const r = blankPitch();
      u.meas.rows.push(r); buildMeas(t); done(`u-pitch-${r.id}-pitch`);
    } else if (d.rmpitch) {
      u.meas.rows = u.meas.rows.filter(r => r.id !== d.rmpitch);
      if (!u.meas.rows.length) u.meas.rows.push(blankPitch());
      buildMeas(t); done('btnAddPitch');
    }
  }

  let pdfBusy = false;
  async function onPdf() {
    const t = cur();
    if (!t || pdfBusy || t.status !== 'approved' || !jsPDF) return;
    const m = modelOf(t), name = fileName(m);
    pdfBusy = true; panelSig = ''; refreshTicket();
    try {
      const res = await saveFile(name, buildPdf(m), 'application/pdf');
      if (res === 'saved') toast('PDF saved as ' + name);
      else if (res === 'none') toast('Saving a file is not available in this view.');
    } catch (err) {
      toast(saveProblem(err));
    }
    pdfBusy = false; panelSig = ''; refreshTicket();
  }

  function onCopy() {
    const t = cur();
    if (!t) return;
    const txt = summaryText(t, modelOf(t));
    const fallback = () => { $('copyText').value = txt; $('copyBox').hidden = false; $('copyText').focus(); $('copyText').select(); };
    $('copyBox').hidden = true;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast('Ticket summary copied.'), fallback);
    else fallback();
  }

  /* ----- setup editor: the templates -----
     Works on a copy (`draft`) of one template. Nothing changes for tickets until Save. */

  let draft = null, draftTpl = 'framing', openQ = {}, askDiscard = false;
  let openJ = {};         // scopes of work whose included lines are showing
  let setupBack = null;   // the ticket Setup was opened from, to return to
  let addingScope = false; // the "New template" box is open
  const setupSay = text => { $('setupMsg').textContent = text || ''; };
  const draftChanged = () => JSON.stringify(normalizeSetup(draft, draft.sheet)) !== JSON.stringify(setups[draftTpl]);

  // `back` says where Setup was opened from: { id, tab } of a ticket to return to, and
  // optionally where to land: a section (`sec`), a question (`q`), a button (`focus`), the
  // box that adds a scope of work (`add`), or a new price or labor line for one roof
  // system (`line`: { key, job }), which is added to the draft with the cursor on its price.
  function openSetup(tpl, back) {
    toast(''); // a message from the screen before would sit on the save bar
    // Arriving from another screen: the second half of a double-click must not land on a
    // Remove or a reorder button here and change the setup unseen.
    if (ui.view !== 'setup') hush();
    draftTpl = setups[tpl] ? tpl : setups[draftTpl] ? draftTpl : 'framing';
    draft = clone(setups[draftTpl]); openQ = {}; askDiscard = false; disarm();
    openJ = {};
    for (const id of (back && back.jobs) || []) openJ[id] = true;
    addingScope = !!(back && back.add) && Object.keys(setups).length < MAX_SCOPES;
    // `y` is how far down the ticket was scrolled, so leaving Setup lands on the same spot.
    setupBack = back && back.id ? { id: back.id, tab: back.tab, y: back.y != null ? back.y : window.scrollY } : null;
    if (back && back.q) openQ[back.q] = true;
    let made = '', say = '';
    const ln = back && back.line;
    if (ln && draft.sheet === 'roofing' && (ln.key === 'sell' || ln.key === 'labor')) {
      const j = draft.jobs.find(x => x.id === ln.job), list = draft[ln.key];
      if (j && list.length < 60 && !list.some(l => l.job === j.id)) {
        // Charged the way the other systems are, and listed with them.
        const like = list.find(l => l.job), at = list.reduce((n, l, i) => (l.job ? i : n), -1);
        const x = { id: uidIn('l'), label: ln.key === 'labor' ? `${j.label} labor` : j.label, unit: (like && like.unit) || '', price: '', job: j.id };
        list.splice(at + 1, 0, x);
        made = `s-${ln.key}-${x.id}-price`;
        say = `A ${ln.key === 'sell' ? 'client price' : 'labor'} line for ${j.label} is ready. Give it a price, then save.`;
      }
    }
    ui.view = 'setup';
    showView(); drawEditor(); setupSay(say);
    if (addingScope) { window.scrollTo(0, 0); $('ns-name').focus(); return; }
    const spot = back && (made ? $(made) : back.q ? $('s-qt-' + back.q) : back.sec ? $('sec-' + back.sec) : back.focus ? $(back.focus) : null);
    if (!spot) { window.scrollTo(0, 0); return; }
    const exact = !!made || !!back.focus; // a box or a button: centre it and put the cursor there
    try { spot.scrollIntoView({ block: exact ? 'center' : 'start' }); } catch (e) { spot.scrollIntoView(); }
    if (back.q || exact) { try { spot.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ } }
  }
  // Leave Setup for wherever it was opened from.
  function leaveSetup() {
    const back = setupBack;
    draft = null; setupBack = null;
    if (back && store.tickets.some(t => t.id === back.id)) { openTicket(back.id, back.tab); if (back.y > 0) window.scrollTo(0, back.y); } else goHome();
  }
  function drawSetupBar() {
    $('confirmDiscard').hidden = !askDiscard;
    $('btnSetupCancel').hidden = askDiscard;
  }
  const edited = () => { if (askDiscard) { askDiscard = false; drawSetupBar(); } setupSay(''); };
  const draftLines = () => (draft.sheet === 'roofing' ? [...draft.sell, ...draft.labor, ...draft.mats] : draft.supplies);
  const uidIn = p => {
    const used = new Set([...draft.jobs, ...draftLines(), ...draft.questions, ...draft.questions.flatMap(q => q.options || [])].map(x => x.id));
    let id = uid(p);
    while (used.has(id)) id = uid(p);
    return id;
  };

  const eText = (label, id, value, max, on, hint, ph) => h('div', { class: 'field' },
    h('label', { for: id, text: label }),
    h('input', { class: 'text', type: 'text', id, value: value || '', maxlength: max, placeholder: ph || null, oninput: e => { on(e.target.value); edited(); } }),
    hint ? h('p', { class: 'ehint', text: hint }) : null);
  const eCheck = (id, label, on, change) => h('div', { class: 'chips' },
    h('input', { type: 'checkbox', id, checked: !!on, onchange: e => { change(e.target.checked); edited(); } }),
    h('label', { for: id, text: label }));
  const ePct = (id, label, value, max, on, hint) => h('div', { class: 'field' },
    h('label', { for: id, text: label }),
    h('div', { class: 'pctbox' },
      h('input', {
        class: 'text num', type: 'text', inputmode: 'decimal', id, maxlength: 6, value: value ? String(value) : '',
        oninput: e => { on(numIn(num(e.target.value), 0, max, 0)); edited(); },
        // on leaving the box it shows the number that will be saved: capped, three places at most
        onblur: e => { const n = numIn(num(e.target.value), 0, max, 0); on(n); e.target.value = n ? String(n) : ''; }
      }),
      h('span', { text: '%' })),
    hint ? h('p', { class: 'ehint', text: hint }) : null);
  function tools(arr, i, name, key, onRemove) {
    const moveBy = d => { const j = i + d; [arr[i], arr[j]] = [arr[j], arr[i]]; edited(); drawEditor(`${key}-${d < 0 ? 'up' : 'down'}`); };
    return h('div', { class: 'tools' },
      h('button', { type: 'button', class: 'ibtn', id: key + '-up', 'aria-label': `Move ${name} up`, disabled: i === 0, onclick: () => moveBy(-1) }, icon('up')),
      h('button', { type: 'button', class: 'ibtn', id: key + '-down', 'aria-label': `Move ${name} down`, disabled: i === arr.length - 1, onclick: () => moveBy(1) }, icon('down')),
      onRemove ? h('button', { type: 'button', class: 'ibtn', id: key + '-rm', 'aria-label': `Remove ${name}`, onclick: () => { edited(); onRemove(); } }, icon('x')) : null);
  }
  const addBtn = (id, label, act) => h('button', { type: 'button', class: 'btn add', id, onclick: () => { edited(); act(); } }, icon('plus'), label);

  const jobWord = () => 'scope of work';
  const jobNames = q => (q.jobs.length ? q.jobs.map(id => (draft.jobs.find(j => j.id === id) || {}).label || 'Unnamed ' + jobWord()).join(', ') : 'Every ticket');
  const qMeta = q => `${q.kind === 'text' ? 'Fill-in' : q.na ? 'Yes / No / Not needed' : 'Yes / No'} · ${jobNames(q)}`;
  const refreshMetas = () => { for (const q of draft.questions) setText('s-qm-' + q.id, qMeta(q)); };

  function drawEditor(focusId) {
    if (!draft) return;
    const roof = draft.sheet === 'roofing', jw = jobWord();
    drawScopeBar();
    $('setupSub').textContent = roof
      ? 'Build this template out: its scopes of work, questions, client prices, labor rates, the materials price book and the rates. Open drafts and new tickets use it as soon as you save.'
      : 'Build this template out: its scopes of work, questions, options, supply lines and wording. Open drafts and new tickets use it as soon as you save.';
    $('setupBody').replaceChildren(...(roof
      ? [sectionScope(), sectionJobs(), sectionQuestions(),
        sectionLines('sell', 'Client price lines', `What the client is charged for. A line with the unit SQ counts as squares. Leave a price blank to have the estimator type it on each job. A line set to one ${jw} shows only on tickets for it.`, { unit: true, price: true, job: true, noun: 'price line', add: 'Add client price line' }),
        sectionLines('labor', 'Labor rates', draftTpl === 'roofing'
          ? 'Piece rates. One line per scope of work at its rate per square, then the extras. A line set to one scope of work shows only on tickets for it, so a tile job is costed at the tile rate.'
          : `Piece rates: what the crew is paid per unit. A line set to one ${jw} shows only on tickets for it.`, { unit: true, price: true, job: true, noun: 'labor line', add: 'Add labor line' }),
        sectionLines('mats', 'Materials price book', 'Every ticket lists these with their price. The estimator fills in quantities. A price changed on a ticket is marked "Book price" for whoever reviews it.', { price: true, noun: 'material', add: 'Add material' }),
        sectionRates(), sectionWording(), isBuiltin(draftTpl) ? sectionReset() : null]
      : [sectionScope(), sectionJobs(), sectionQuestions(),
        sectionLines('supplies', 'Supply lines', 'The cost lines on the underwriting sheet, in this order. An estimator can still add a one-off line on a ticket.', { noun: 'supply line', add: 'Add supply line' }),
        sectionMargin(), sectionWording(), isBuiltin(draftTpl) ? sectionReset() : null]).filter(Boolean));
    drawSetupBar();
    if (focusId && $(focusId)) { try { $(focusId).focus(); } catch (e) { /* focus is a nicety */ } }
  }
  function switchTpl(id) {
    if (id === draftTpl) return;
    if (draftChanged()) { setupSay('Save or cancel your changes here before switching.'); return; }
    openSetup(id, setupBack);
    $('tpl-' + id).focus();
  }
  // The row of templates at the top of Setup, with the box that adds a new one.
  function drawScopeBar() {
    const ids = Object.keys(setups);
    $('tplSwitch').replaceChildren(...[
      ...ids.map(id => h('button', {
        type: 'button', class: 'fchip plain', id: 'tpl-' + id, 'aria-pressed': String(id === draftTpl), onclick: () => switchTpl(id),
        text: id === draftTpl ? clean(draft.name) || setups[id].name : setups[id].name
      })),
      ids.length < MAX_SCOPES ? h('button', {
        type: 'button', class: 'fchip plain addchip', id: 'tpl-add', 'aria-expanded': String(addingScope),
        onclick: () => {
          if (draftChanged()) { setupSay('Save or cancel your changes here before adding a template.'); return; }
          addingScope = !addingScope; setupSay(''); drawScopeBar();
          if (addingScope) $('ns-name').focus();
        }
      }, icon('plus'), 'New template') : null
    ].filter(Boolean));
    $('tplNew').hidden = !addingScope;
    $('tplNew').replaceChildren(...(addingScope ? [newScopeForm()] : []));
  }
  function newScopeForm() {
    let sheet = 'crew';
    const name = h('input', { class: 'text', type: 'text', id: 'ns-name', maxlength: 40, placeholder: 'Stucco, drywall, concrete' });
    const pick = (v, label) => [h('input', { type: 'radio', name: 'ns-sheet', id: 'ns-' + v, value: v, checked: v === sheet, onchange: () => { sheet = v; } }), h('label', { for: 'ns-' + v, text: label })];
    const add = () => {
      const n = clean(name.value);
      if (!n) { setupSay('Give the template a name.'); name.focus(); return; }
      if (Object.values(setups).some(x => sameName(x.name, n))) { setupSay('There is already a template with that name.'); name.focus(); return; }
      let id = uid('s');
      while (setups[id]) id = uid('s');
      const su = normalizeSetup(starterScope(n, sheet), sheet);
      setups[id] = su; store.templates[id] = su;
      saveStore();
      openSetup(id, setupBack);
      toast(`${n} template added. Build it out here, then save.`);
    };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'newscope' },
      h('div', { class: 'field' }, h('label', { for: 'ns-name', text: 'Name of the new template' }), name),
      h('div', { class: 'field' },
        h('span', { class: 'elabel', id: 'ns-how', text: 'How is it costed?' }),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'ns-how' }, pick('crew', 'By the day, with a crew'), pick('roofing', 'By the piece, with materials')),
        h('p', { class: 'ehint', text: 'By the day is the framing sheet: laborers, day rates, days and supplies. By the piece is the roofing sheet: a price per unit for the client and for labor, and a materials price book.' })),
      h('div', { class: 'pactions' },
        h('button', { type: 'button', class: 'btn primary', id: 'ns-add', onclick: add, text: 'Add template' }),
        h('button', { type: 'button', class: 'btn quiet', id: 'ns-cancel', onclick: () => { addingScope = false; setupSay(''); drawScopeBar(); $('tpl-add').focus(); }, text: 'Cancel' })));
  }
  // Name of the template, how it is costed, and (for one you added) removing it.
  function sectionScope() {
    const used = store.tickets.filter(t => t.tpl === draftTpl).length;
    const id = 's-rmscope', key = 'rmscope:' + draftTpl;
    const label = armed => { const b = $(id); if (b) b.textContent = armed ? 'Tap again to remove it for good' : 'Remove this template'; };
    return h('div', { class: 'egroup', id: 'sec-scope' },
      h('h3', { text: 'This template' }),
      eText('Name', 's-name', draft.name, 40, v => { draft.name = v; setText('tpl-' + draftTpl, clean(v) || setups[draftTpl].name); }, 'Shows on the ticket list and on the New ticket button.'),
      h('p', { class: 'ehint', text: draft.sheet === 'roofing'
        ? 'Costed by the piece: quantity \u00d7 price for the client and for labor, plus materials off a price book.'
        : 'Costed by the day: laborers \u00d7 day rate \u00d7 days, plus supplies.' }),
      isBuiltin(draftTpl) ? null
        : used ? h('p', { class: 'ehint', text: `${used} ${used === 1 ? 'ticket uses' : 'tickets use'} this template, so it cannot be removed.` })
          : h('button', {
            type: 'button', class: 'btn danger start', id, text: armedKey === key ? 'Tap again to remove it for good' : 'Remove this template',
            onclick: () => {
              if (store.tickets.some(t => t.tpl === draftTpl)) { disarm(); drawEditor(); setupSay('A ticket uses this template now, so it cannot be removed.'); return; }
              if (!pressedTwice(key, label)) return;
              const gone = setups[draftTpl].name;
              delete setups[draftTpl]; delete store.templates[draftTpl];
              saveStore();
              draft = null;
              openSetup('framing', setupBack);
              toast(`${gone} removed.`);
            }
          }));
  }

  function sectionJobs() {
    return h('div', { class: 'egroup', id: 'sec-jobs' },
      h('h3', { text: 'Scopes of work' }),
      h('p', { class: 'ehint', text: 'The jobs this template covers. The first box is what the estimator ticks on a ticket. The second is how it reads in the proposal heading. If you remove one, ' + (draft.sheet === 'roofing' ? 'its own price and labor lines go with it, and questions that were only for it are asked on every ticket.' : 'questions that were only for it are asked on every ticket.') }),
      draft.jobs.length ? h('div', { class: 'ecols', 'aria-hidden': 'true' }, h('span', { text: 'On the ticket' }), h('span', { text: 'Proposal heading' }), h('span')) : null,
      h('div', { class: 'erows' }, draft.jobs.map((j, i) => h('div', { class: 'jobcard' }, h('div', { class: 'erow two' },
        h('input', {
          class: 'text', type: 'text', id: `s-job-${j.id}-label`, value: j.label, maxlength: 40, 'aria-label': 'Name on the ticket',
          oninput: e => {
            j.label = e.target.value; edited();
            for (const el of document.querySelectorAll(`[data-jobname="${j.id}"]`)) el.textContent = j.label || 'Unnamed ' + jobWord();
            refreshMetas();
          }
        }),
        h('input', { class: 'text', type: 'text', id: `s-job-${j.id}-heading`, value: j.heading, maxlength: 60, placeholder: 'Same as the name', 'aria-label': 'Heading on the proposal', oninput: e => { j.heading = e.target.value; edited(); } }),
        tools(draft.jobs, i, 'scope of work', 's-job-' + j.id, () => {
          draft.jobs.splice(i, 1);
          for (const q of draft.questions) q.jobs = q.jobs.filter(x => x !== j.id);
          // Its own price and labor lines go with it. A line every scope uses stays.
          for (const key of ['sell', 'labor']) {
            if (!draft[key]) continue;
            const gone = new Set(draft[key].filter(l => l.job === j.id).map(l => l.id));
            draft[key] = draft[key].filter(l => !gone.has(l.id));
            for (const q of draft.questions) { if (gone.has(q.cost)) q.cost = ''; if (gone.has(q.priced)) q.priced = ''; }
          }
          drawEditor('s-addjob');
        })), jobItems(j)))),
      addBtn('s-addjob', 'Add scope of work', () => { const j = { id: uidIn('j'), label: '', heading: '', items: [] }; draft.jobs.push(j); openJ[j.id] = true; drawEditor(`s-job-${j.id}-label`); }));
  }
  // What one scope of work includes: the preset lines a ticket starts with when it is ticked.
  function jobItems(j) {
    const list = j.items || (j.items = []), open = !!openJ[j.id], tid = `s-job-${j.id}-items`;
    const toggle = h('button', {
      type: 'button', class: 'linkbtn', id: tid, 'aria-expanded': String(open),
      onclick: () => { openJ[j.id] = !open; drawEditor(tid); },
      text: `${open ? 'Hide' : 'Show'} what it includes (${list.length} ${list.length === 1 ? 'line' : 'lines'})`
    });
    if (!open) return h('div', { class: 'jitems' }, toggle);
    return h('div', { class: 'jitems' }, toggle,
      h('p', { class: 'ehint', text: 'These lines come onto a ticket when this scope of work is ticked, and print on the proposal. On the ticket they can still be reworded, removed or added to.' }),
      list.length ? h('div', { class: 'erows' }, list.map((it, k) => h('div', { class: 'erow' },
        h('input', { class: 'text', type: 'text', id: `s-ji-${j.id}-${it.id}`, value: it.text, maxlength: 120, placeholder: 'What is included', 'aria-label': `Included line ${k + 1}`, oninput: e => { it.text = e.target.value; edited(); } }),
        tools(list, k, 'line', `s-ji-${j.id}-${it.id}`, () => { list.splice(k, 1); drawEditor(`s-jiadd-${j.id}`); })))) : null,
      list.length < MAX_PRESET ? addBtn(`s-jiadd-${j.id}`, 'Add a line', () => {
        let id = uid('i');
        while (list.some(x => x.id === id)) id = uid('i');
        list.push({ id, text: '' });
        drawEditor(`s-ji-${j.id}-${id}`);
      }) : null);
  }

  // One editor for every kind of cost line: a name and, where the template has them, a
  // unit, a price and the scope of work the line belongs to.
  function sectionLines(key, title, hint, o) {
    const list = draft[key], cls = o.job ? 'l4' : o.unit ? 'l3' : o.price ? 'l2' : '';
    const jobPick = x => {
      const sel = h('select', { class: 'text', id: `s-${key}-${x.id}-job`, 'aria-label': 'Scope of work this line shows on', onchange: e => { x.job = e.target.value; edited(); } },
        h('option', { value: '', text: 'Every scope' }),
        draft.jobs.map(j => h('option', { value: j.id, 'data-jobname': j.id, text: j.label || 'Unnamed ' + jobWord() })));
      sel.value = x.job || '';
      return sel;
    };
    return h('div', { class: 'egroup', id: 'sec-' + key },
      h('h3', { text: title }),
      h('p', { class: 'ehint', text: hint }),
      list.length && o.price ? h('div', { class: 'ecols ' + cls, 'aria-hidden': 'true' }, h('span', { text: 'Name' }), o.unit ? h('span', { text: 'Unit' }) : null, h('span', { text: 'Price' }), o.job ? h('span', { text: 'Shows on' }) : null, h('span')) : null,
      h('div', { class: 'erows' }, list.map((x, i) => h('div', { class: 'erow ' + cls },
        h('input', {
          class: 'text', type: 'text', id: `s-${key}-${x.id}-label`, value: x.label, maxlength: o.price ? 80 : 40, placeholder: 'Name', 'aria-label': `Name of this ${o.noun}`,
          oninput: e => {
            x.label = e.target.value; edited();
            for (const el of document.querySelectorAll(`[data-linelabel="${x.id}"]`)) el.textContent = x.label || 'Unnamed line';
          }
        }),
        o.unit ? h('input', { class: 'text', type: 'text', id: `s-${key}-${x.id}-unit`, value: x.unit || '', maxlength: 10, placeholder: 'Unit', 'aria-label': 'Unit', oninput: e => { x.unit = e.target.value; edited(); } }) : null,
        o.price ? h('div', { class: 'money sm' }, h('span', { 'aria-hidden': 'true', text: '$' }),
          h('input', {
            type: 'text', inputmode: 'decimal', id: `s-${key}-${x.id}-price`, value: x.price || '', 'aria-label': 'Price',
            oninput: e => { x.price = e.target.value; edited(); },
            onblur: e => { e.target.value = x.price = moneyText(e.target.value); }
          })) : null,
        o.job ? jobPick(x) : null,
        tools(list, i, o.noun, `s-${key}-${x.id}`, () => {
          list.splice(i, 1);
          for (const q of draft.questions) { if (q.cost === x.id) q.cost = ''; if (q.priced === x.id) q.priced = ''; }
          drawEditor('s-add-' + key);
        })))),
      addBtn('s-add-' + key, o.add, () => {
        const x = Object.assign({ id: uidIn('l'), label: '' }, o.unit ? { unit: '' } : {}, o.price ? { price: '' } : {}, o.job ? { job: '' } : {});
        list.push(x);
        drawEditor(`s-${key}-${x.id}-label`);
      }));
  }

  function sectionMargin() {
    return h('div', { class: 'egroup', id: 'sec-rates' },
      h('h3', { text: 'Margin line' }),
      ePct('s-watch', 'Flag a ticket when the overrun margin is under', draft.watch, 90, v => { draft.watch = v; }, 'Leave it blank to turn this flag off. A ticket that loses money is always flagged.'));
  }
  function sectionRates() {
    const noteText = () => { const total = round2(draft.schedule.reduce((a, x) => a + x, 0)); return total === 100 ? 'Adds up to 100%.' : `Adds up to ${fmtRate(total)}%. It should come to 100%, and a ticket is flagged until it does.`; };
    return h('div', { class: 'egroup', id: 'sec-rates' },
      h('h3', { text: 'Rates' }),
      ePct('s-tax', 'Sales tax on materials', draft.tax, 30, v => { draft.tax = v; }),
      ePct('s-commission', 'Commission, on the client quote', draft.commission, 60, v => { draft.commission = v; }),
      h('div', { class: 'field' },
        h('span', { class: 'elabel', text: 'Payment schedule' }),
        h('div', { class: 'sched' }, draft.schedule.map((p, i) => h('div', { class: 'pctbox' },
          h('input', {
            class: 'text num', type: 'text', inputmode: 'decimal', id: 's-sched-' + i, maxlength: 6, value: p ? String(p) : '', 'aria-label': `Payment ${i + 1}, percent`,
            oninput: e => { draft.schedule[i] = numIn(num(e.target.value), 0, 100, 0); setText('s-sched-note', noteText()); edited(); },
            onblur: e => { const n = draft.schedule[i]; e.target.value = n ? String(n) : ''; }
          }),
          h('span', { text: '%' })))),
        h('p', { class: 'ehint', id: 's-sched-note', text: noteText() })),
      ePct('s-watch', 'Flag a ticket when the net margin is under', draft.watch, 90, v => { draft.watch = v; }, 'Net margin is what is left after hard cost and commission. Leave it blank to turn this flag off.'),
      eCheck('s-measure', 'Show the roof measurement helper (pitch to squares) on the ticket', draft.measure, v => { draft.measure = v; }));
  }

  function sectionWording() {
    const roof = draft.sheet === 'roofing';
    return h('div', { class: 'egroup', id: 'sec-wording' },
      h('h3', { text: 'Proposal wording' }),
      eText('What the grey Includes row says', 's-includes', draft.includes, 60, v => { draft.includes = v; },
        'Prints after "Includes- ". Leave it blank to build it from the answers, as in Labor and Materials or Labor Only.', 'Built from the answers'),
      roof ? eCheck('s-showUnit', 'Print quantity and unit price beside each client price line', draft.showUnit, v => { draft.showUnit = v; }) : null,
      eText('Line under the table', 's-footer', draft.footer, 160, v => { draft.footer = v; }, 'Starts every new ticket. The estimator can still change it for one job.'),
      eText('Heading of the Excludes row', 's-exclTitle', draft.exclTitle, 80, v => { draft.exclTitle = v; }));
  }

  function sectionReset() {
    return h('div', { class: 'egroup' },
      h('button', {
        type: 'button', class: 'btn quiet add', id: 's-reset', text: `Put back the original ${setups[draftTpl].name.toLowerCase()} setup`,
        onclick: () => { draft = fresh(draftTpl); openQ = {}; drawEditor('s-reset'); setupSay('The original setup is loaded. Save to apply it, or cancel to keep what you had.'); }
      }));
  }

  function sectionQuestions() {
    const add = kind => {
      const q = kind === 'text'
        ? { id: uidIn('q'), kind: 'text', label: '', short: '', jobs: [], prefix: '', def: '', star: false }
        : { id: uidIn('q'), kind: 'choice', label: '', short: '', jobs: [], na: false, line: '', optMode: 'lines', options: [], other: false, need: false, headline: '', exclOn: true, excl: '', cost: '', star: false };
      draft.questions.push(q);
      openQ[q.id] = true;
      drawEditor(`s-q-${q.id}-label`);
    };
    return h('div', { class: 'egroup', id: 'sec-questions' },
      h('h3', { text: 'Questions' }),
      h('p', { class: 'ehint', text: 'Asked in this order, and printed on the proposal in this order.' }),
      draft.questions.length ? h('div', { class: 'erows' }, draft.questions.map(qCard)) : null,
      h('div', { class: 'addrow' },
        addBtn('s-addq', 'Add a yes / no question', () => add('choice')),
        addBtn('s-addt', 'Add a fill-in question', () => add('text'))));
  }

  function qCard(q, i) {
    const open = !!openQ[q.id];
    const title = h('span', { class: 'qc-title', text: q.label || q.short || 'New question' });
    const head = h('div', { class: 'qc-head' },
      h('button', {
        type: 'button', class: 'qc-toggle', id: 's-qt-' + q.id, 'aria-expanded': String(open),
        onclick: () => { openQ[q.id] = !open; drawEditor('s-qt-' + q.id); }
      }, icon('chev'), h('span', { class: 'qc-txt' }, title, h('span', { class: 'qc-meta', id: 's-qm-' + q.id, text: qMeta(q) }))),
      tools(draft.questions, i, 'question', 's-q-' + q.id, null));
    return h('div', { class: 'qcard' + (open ? ' open' : '') }, head,
      open ? h('div', { class: 'qc-body' }, q.kind === 'text' ? textFields(q, title) : choiceFields(q, title)) : null);
  }

  function askOn(q) {
    const chips = draft.jobs.map(j => {
      const id = `s-q-${q.id}-job-${j.id}`;
      return [
        h('input', {
          type: 'checkbox', id, checked: q.jobs.includes(j.id),
          onchange: e => { q.jobs = q.jobs.filter(x => x !== j.id); if (e.target.checked) q.jobs.push(j.id); refreshMetas(); edited(); }
        }),
        h('label', { for: id, 'data-jobname': j.id, text: j.label || 'Unnamed ' + jobWord() })
      ];
    });
    return h('div', { class: 'field' },
      h('span', { class: 'elabel', text: 'Ask it on' }),
      draft.jobs.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'The scopes of work this question is asked on' }, chips) : null,
      h('p', { class: 'ehint', text: draft.jobs.length ? 'Leave them all off to ask it on every ticket.' : 'There are no scopes of work, so it is asked on every ticket.' }));
  }

  function removeBtn(q) {
    const id = `s-q-${q.id}-remove`, key = 'rmq:' + q.id;
    // only the label changes while it is armed, so typing elsewhere is never interrupted
    const label = armed => { const b = $(id); if (b) b.textContent = armed ? 'Tap again to remove it' : 'Remove this question'; };
    return h('button', {
      type: 'button', class: 'btn danger add', id, text: armedKey === key ? 'Tap again to remove it' : 'Remove this question',
      onclick: () => {
        if (!pressedTwice(key, label)) return;
        draft.questions = draft.questions.filter(x => x !== q);
        delete openQ[q.id];
        edited();
        drawEditor('s-addq');
      }
    });
  }

  // The cost line a question should agree with. Roofing has three kinds of line to pick from.
  // `key` is the link being set: "cost" or "priced". `lists` are [group label, lines] pairs.
  function lineSelect(q, key, id, lists) {
    const opt = x => h('option', { value: x.id, 'data-linelabel': x.id, text: x.label || 'Unnamed line' });
    const body = lists.length === 1
      ? lists[0][1].map(opt)
      : lists.filter(g => g[1].length).map(([label, list]) => h('optgroup', { label }, list.map(opt)));
    const sel = h('select', { class: 'text', id, onchange: e => { q[key] = e.target.value; edited(); } }, h('option', { value: '', text: 'None' }), body);
    sel.value = q[key] || '';
    return sel;
  }

  function choiceFields(q, title) {
    const p = 's-q-' + q.id, hasOpts = q.options.length > 0 || q.other, roof = draft.sheet === 'roofing';
    const redraw = id => () => drawEditor(id);
    return [
      eText('Question', p + '-label', q.label, 90, v => { q.label = v; title.textContent = v || q.short || 'New question'; }),
      eText('Short name', p + '-short', q.short, 30, v => { q.short = v; }, 'A word or two, like Materials. It names this item in the checklist, and on the proposal when a line below is left blank.'),
      askOn(q),
      eCheck(p + '-na', 'Also offer "Not needed"', q.na, v => { q.na = v; refreshMetas(); }),
      h('div', { class: 'esub' },
        h('h4', { text: 'When the answer is Yes' }),
        eText('Line on the proposal', p + '-line', q.line, 120, v => { q.line = v; },
          q.options.length && q.optMode === 'lines' ? 'Optional here, because the ticked options already print as their own lines.' : 'Leave it blank to print the short name.'),
        roof ? h('div', { class: 'field' },
          h('label', { for: p + '-priced' }, 'Client price line that charges for it', h('span', { class: 'opt', text: ' optional' })),
          lineSelect(q, 'priced', p + '-priced', [['', draft.sell]]),
          h('p', { class: 'ehint', text: 'When that line has a quantity on the ticket, it prints with its price and the line above is left off, so the item is not listed twice.' })) : null,
        h('div', { class: 'field' },
          h('span', { class: 'elabel', text: 'Options the estimator can tick' }),
          q.options.length ? h('div', { class: 'erows' }, q.options.map((o, i) => h('div', { class: 'erow' },
            h('input', { class: 'text', type: 'text', id: `${p}-opt-${o.id}`, value: o.label, maxlength: 60, placeholder: 'Option name', 'aria-label': 'Option name', oninput: e => { o.label = e.target.value; edited(); } }),
            tools(q.options, i, 'option', `${p}-opt-${o.id}`, () => { q.options.splice(i, 1); drawEditor(p + '-addopt'); })))) : null,
          addBtn(p + '-addopt', 'Add option', () => { const o = { id: uidIn('o'), label: '' }; q.options.push(o); drawEditor(`${p}-opt-${o.id}`); })),
        eCheck(p + '-other', 'Let the estimator type one that is not listed', q.other, v => { q.other = v; redraw(p + '-other')(); }),
        hasOpts ? h('div', { class: 'field' },
          h('span', { class: 'elabel', id: p + '-mode-l', text: 'Where the ticked options print' }),
          h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': p + '-mode-l' },
            h('input', { type: 'radio', name: p + '-mode', id: p + '-mode-lines', checked: q.optMode !== 'desc', onchange: () => { q.optMode = 'lines'; edited(); drawEditor(p + '-mode-lines'); } }),
            h('label', { for: p + '-mode-lines', text: 'Each on its own line' }),
            h('input', { type: 'radio', name: p + '-mode', id: p + '-mode-desc', checked: q.optMode === 'desc', onchange: () => { q.optMode = 'desc'; edited(); drawEditor(p + '-mode-desc'); } }),
            h('label', { for: p + '-mode-desc', text: 'Beside the line, under Description' }))) : null,
        hasOpts ? eCheck(p + '-need', 'At least one is required', q.need, v => { q.need = v; }) : null,
        eText('Word for the grey Includes row', p + '-headline', q.headline, 30, v => { q.headline = v; }, 'Prints as "Includes- Labor and ___" when that row is built from the answers. When several questions have a word, the first Yes wins.'),
        eCheck(p + '-star', `Mark its lines with ** when the ticket has more than one ${jobWord()}`, q.star, v => { q.star = v; })),
      h('div', { class: 'esub' },
        h('h4', { text: 'When the answer is No, by others' }),
        eCheck(p + '-exclOn', 'List it under Excludes', q.exclOn, v => { q.exclOn = v; redraw(p + '-exclOn')(); }),
        q.exclOn ? eText('Line under Excludes', p + '-excl', q.excl, 120, v => { q.excl = v; }, 'Leave it blank to use the line from Yes.') : null),
      h('div', { class: 'esub' },
        h('h4', { text: 'In underwriting' }),
        h('div', { class: 'field' },
          h('label', { for: p + '-cost', text: 'Cost line this answer should agree with' }),
          lineSelect(q, 'cost', p + '-cost', roof ? [['Labor', draft.labor], ['Client price', draft.sell], ['Materials', draft.mats]] : [['', draft.supplies]]),
          h('p', { class: 'ehint', text: roof
            ? 'A Yes with no quantity on that line, or a quantity on a line the scope says is by others, puts a flag on the ticket.'
            : 'A Yes with no cost on that line, or a cost on a line the scope says is by others, puts a flag on the ticket.' }))),
      removeBtn(q)
    ];
  }

  function textFields(q, title) {
    const p = 's-q-' + q.id;
    return [
      eText('Question', p + '-label', q.label, 90, v => { q.label = v; title.textContent = v || q.short || 'New question'; }),
      eText('Short name', p + '-short', q.short, 30, v => { q.short = v; }),
      askOn(q),
      eText('Line on the proposal starts with', p + '-prefix', q.prefix, 60, v => { q.prefix = v; }, 'The answer is added after it. "Demo" plus "existing structure" prints "Demo existing structure".'),
      eText('Answer filled in to start', p + '-def', q.def, 80, v => { q.def = v; }, 'Also used when the estimator clears the box.'),
      eCheck(p + '-star', `Mark its line with ** when the ticket has more than one ${jobWord()}`, q.star, v => { q.star = v; }),
      removeBtn(q)
    ];
  }

  function saveSetup() {
    const bad = draft.questions.find(q => !clean(q.label) && !clean(q.short));
    if (bad) {
      openQ[bad.id] = true;
      drawEditor(`s-q-${bad.id}-label`);
      setupSay('Give that question its wording, or remove it.');
      return;
    }
    if (!clean(draft.name)) { drawEditor('s-name'); setupSay('Give this template a name.'); return; }
    if (Object.keys(setups).some(id => id !== draftTpl && sameName(setups[id].name, draft.name))) { drawEditor('s-name'); setupSay('Another template already has that name.'); return; }
    // Nothing is dropped silently: an unnamed scope of work, line or option stops the save.
    const noJob = draft.jobs.find(j => !clean(j.label));
    if (noJob) { drawEditor(`s-job-${noJob.id}-label`); setupSay(`Give that ${jobWord()} a name, or remove it.`); return; }
    for (const j of draft.jobs) {
      const blank = (j.items || []).find(it => !clean(it.text));
      if (blank) { openJ[j.id] = true; drawEditor(`s-ji-${j.id}-${blank.id}`); setupSay('That included line is blank. Type it, or remove it.'); return; }
    }
    const twin = draft.jobs.find((j, i) => draft.jobs.some((x, k) => k < i && sameName(x.label, j.label)));
    if (twin) { drawEditor(`s-job-${twin.id}-label`); setupSay('Two scopes of work have the same name. Rename one, or remove it.'); return; }
    for (const key of (draft.sheet === 'roofing' ? ['sell', 'labor', 'mats'] : ['supplies'])) {
      const blank = draft[key].find(x => !clean(x.label));
      if (blank) { drawEditor(`s-${key}-${blank.id}-label`); setupSay('Give that line a name, or remove it.'); return; }
    }
    for (const q of draft.questions) {
      const o = (q.options || []).find(x => !clean(x.label));
      if (o) { openQ[q.id] = true; drawEditor(`s-q-${q.id}-opt-${o.id}`); setupSay('Give that option a name, or remove it.'); return; }
    }
    const next = normalizeSetup(draft, draft.sheet);
    if (!next) { setupSay('This setup could not be read. Cancel and try again.'); return; }
    applySetup(draftTpl, next);
    leaveSetup();
    toast(`${next.name} template saved. Open drafts and new tickets use it now.`);
  }
  function cancelSetup() {
    if (draftChanged() && !askDiscard) { askDiscard = true; drawSetupBar(); $('btnDiscardNo').focus(); return; }
    leaveSetup();
  }

  const r2 = n => Math.round(n * 100) / 100;
  function drawSheet(doc, ops, watermark) {
    const el = svg('svg', { viewBox: `0 0 ${doc.w} ${doc.h}`, class: 'paper' });
    el.append(svg('rect', { x: 0, y: 0, width: doc.w, height: doc.h, fill: WHITE }));
    for (const op of ops) {
      if (op.k === 'rect') {
        el.append(svg('rect', { x: r2(op.x), y: r2(op.y), width: r2(op.w), height: r2(op.h), fill: op.fill, 'shape-rendering': 'crispEdges' }));
      } else if (op.k === 'text') {
        const t = svg('text', {
          x: r2(op.x), y: r2(op.y), 'font-size': r2(op.size), 'font-weight': op.bold ? 700 : 400,
          'text-anchor': op.align === 'right' ? 'end' : op.align === 'center' ? 'middle' : 'start', fill: op.fill
        });
        t.textContent = op.str;
        el.append(t);
      } else if (op.k === 'image') {
        const im = svg('image', { x: r2(op.x), y: r2(op.y), width: r2(op.w), height: r2(op.h), preserveAspectRatio: 'none', href: LOGO });
        im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', LOGO);
        el.append(im);
      }
    }
    if (watermark) {
      const cy = doc.h / 2;
      const w = svg('text', {
        x: doc.w / 2, y: cy + 16, 'text-anchor': 'middle', 'font-size': 50, 'font-weight': 700,
        fill: '#000000', 'fill-opacity': 0.08, transform: `rotate(-22 ${doc.w / 2} ${cy})`, 'aria-hidden': 'true'
      });
      w.textContent = 'NOT APPROVED';
      el.append(w);
    }
    return el;
  }
  const drawn = new WeakMap();
  function drawPages(host, m, watermark) {
    const doc = compose(m);
    const sig = JSON.stringify(doc) + (watermark ? '|w' : '');
    if (drawn.get(host) === sig) return;
    drawn.set(host, sig);
    host.replaceChildren(...doc.pages.map(ops => drawSheet(doc, ops, watermark)));
  }/* ======================================================================
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
})();