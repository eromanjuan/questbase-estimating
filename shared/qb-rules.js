/* ======================================================================
   QUEST BASE, ESTIMATING & PROPOSALS: shared rule engine
   ----------------------------------------------------------------------
   Runs in two places with the same code:
     - the browser (app.js), for live editing and on-screen totals
     - the server (API routes), to store and decide anything that matters
   The server re-computes every figure here and never trusts a number the
   browser sent. See docs/HANDOFF.md for the words and the rules.

   Attached to window.QB.rules in a browser, or required as a Node module
   on the server. One module instance holds the current templates; call
   init(setups) with the live templates object before use.

   Sections:
     1. Helpers     number parsing, rounding, formatting, text folding
     2. Templates   one per kind of work: scopes of work, questions, cost lines, prices, rates
     3. Tickets     ticket shape, how a draft follows its template, storage shape
     4. Rules       proposal content, underwriting math, flags, what is left to finish
   ====================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.QB = root.QB || {}; root.QB.rules = factory(); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  let setups = {};
  const init = s => { setups = s; };

  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  // The PDF uses the built-in Helvetica face, which only draws Latin-1. Proposal text is
  // folded into that range: curly quotes and long dashes become plain ones, a letter whose
  // accent the face lacks keeps the letter and loses the accent, and the rest is dropped.
  const FOLD = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'Œ': 'OE', 'œ': 'oe', 'Ħ': 'H', 'ħ': 'h', 'ẞ': 'SS', '€': 'EUR' };
  const safe = v => clean(v)
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, ch => FOLD[ch] || ch.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, '');
  // Capitals without leaving Latin-1 (plain toUpperCase turns the micro sign Greek).
  const upperLatin = v => String(v).replace(/[a-z\xDF-\xF6\xF8-\xFE]/g, c => c.toUpperCase());
  const linesOf = v => String(v == null ? '' : v).split(/\n+/).map(safe).filter(Boolean);
  const capFirst = v => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);
  const lowFirst = v => (v && /^[A-Z][a-z]/.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : v);
  const joinNames = a => (a.length < 3 ? a.join(' & ') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1]);

  // Numbers are typed as text. Anything that is not a plain positive number reads as zero.
  // That includes a minus amount: it is never quietly turned into a plus.
  const NEGATIVE = /^[^0-9]*[-−(]/;
  const num = v => {
    const t = String(v == null ? '' : v);
    if (NEGATIVE.test(t)) return 0;
    const n = parseFloat(t.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const numIn = (v, lo, hi, fallback) => {
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000)) : fallback;
  };
  // Cents, rounded half up the way a person reads the figure: 531.675 is 531.68 even though
  // the machine holds it as 531.67499... (toFixed(6) trims that noise before rounding).
  const round2 = n => {
    if (!Number.isFinite(n)) return 0;
    const a = Math.abs(n);
    if (a >= 1e12) return Math.round(n * 100) / 100;
    const r = Number(Math.round(Number(a.toFixed(6) + 'e2')) + 'e-2');
    return n < 0 ? -r : r;
  };
  const fmtNum = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = n => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const fmtRate = n => n.toLocaleString('en-US', { maximumFractionDigits: 3 }); // a percent rate, as typed in Setup
  const money = n => (n < 0 ? '-$' : '$') + fmtNum(Math.abs(n));
  const moneyText = v => { const n = num(v); return n > 0 ? fmtNum(n) : ''; };
  const pct = x => (x * 100).toFixed(1) + '%';
  const pct2 = x => (x * 100).toFixed(2) + '%'; // the roofing sheet reads to two places: 70.01%, 19.99%
  const DASH = '—';

  const pad2 = n => (n < 10 ? '0' : '') + n;
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const nowISO = () => new Date().toISOString();
  const when = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const dayOf = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const fmtPhone = v => {
    let d = String(v).replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : clean(v);
  };

  const uid = p => p + (Math.random().toString(36) + '000000').slice(2, 8);
  const okId = v => typeof v === 'string' && /^[A-Za-z0-9]{1,24}$/.test(v);
  const clone = o => JSON.parse(JSON.stringify(o));
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : '');
  const brief = v => { const c = clean(v); return c.length > 30 ? c.slice(0, 28).trimEnd() + '\u2026' : c; };

  /* ---------- 2. Templates: the editable part of each kind of work ----------
     Shared by every template
       jobs       its scopes of work, ticked on the ticket; `heading` is how one reads on the proposal.
                  `items` is the preset list of what that scope includes: [{ id, text }]. Ticking
                  the scope on a ticket brings the lines in, and they print on the proposal
       questions  see below
       includes   fixed wording for the grey "Includes- ..." row; blank builds it from the answers
       watch      flag a ticket when its margin is under this percent; 0 turns it off
       footer, exclTitle   proposal wording
     Sheet "crew" (Framing)
       supplies   cost lines on the underwriting sheet
     Sheet "roofing"
       sell       client price lines: label, unit, default unit price, job
       labor      piece-rate labor lines: label, unit, default unit price, job
                  `job` ties a line to one scope of work: the tile rate shows on tile tickets
                  only. Blank means every ticket on this template.
       mats       the materials price book: label, price
       tax, commission, schedule   rates, in percent
       showUnit   print "26 x $580.00 per SQ" beside each client price line on the proposal
       measure    show the pitch-to-squares measurement helper on the ticket
       A sell or labor line whose unit is SQ counts as roof squares.

     question, kind "choice": answered Yes / No, by others / (optionally) Not needed
       line      what prints on the proposal when Yes (falls back to `short`)
       options   things the estimator can tick under a Yes
       optMode   "lines": each ticked option prints as its own line
                 "desc":  ticked options print beside `line`, in the Description column
       other     estimator may type an option that is not listed
       need      at least one option is required under a Yes
       headline  word for the grey "Includes- Labor and ___" row
       exclOn    a "No, by others" prints under Excludes, as `excl` (falls back to the Yes line)
       cost      id of the cost line this answer should agree with in underwriting
       priced    (roofing) id of the client price line that charges for it. When that line is
                 on the ticket it prints with its price and this question's own line is left
                 off, so the item is not listed twice
       star      prefix its lines with ** when the ticket covers more than one scope of work
     question, kind "text": a fill-in; prints `prefix` + the answer (or `def`)
     `jobs` on a question lists the scopes of work it is asked on; empty means every ticket. */

  // Preset "what's included" lines for a scope of work, with stable ids.
  const preset = (...texts) => texts.map((text, i) => ({ id: 'i' + (i + 1), text }));

  function defaultFraming() {
    return {
      name: 'Framing',
      jobs: [
        { id: 'carpentry', label: 'Rough carpentry', heading: 'Rough Carpentry', items: preset('Rough framing per plans') },
        { id: 'demo', label: 'Demo', heading: 'Demo', items: [] }
      ],
      questions: [
        {
          id: 'materials', kind: 'choice', label: 'Are we supplying materials?', short: 'Materials', jobs: ['carpentry'], na: false,
          line: '', optMode: 'lines',
          options: [{ id: 'lumber', label: 'Lumber package' }, { id: 'truss', label: 'Truss package' }],
          other: true, need: true, headline: 'Materials', exclOn: true, excl: 'Materials (lumber, trusses)', cost: 'lumber', star: false
        },
        {
          id: 'crane', kind: 'choice', label: 'Is a crane included?', short: 'Crane', jobs: ['carpentry'], na: true,
          line: 'Crane', optMode: 'lines', options: [],
          other: false, need: false, headline: '', exclOn: true, excl: 'Crane', cost: 'crane', star: false
        },
        {
          id: 'hardware', kind: 'choice', label: 'Are we supplying hardware?', short: 'Hardware', jobs: ['carpentry'], na: false,
          line: 'Hardware', optMode: 'desc',
          options: [
            { id: 'fasteners', label: 'Fasteners' }, { id: 'bases', label: 'Column bases & caps' },
            { id: 'hangers', label: 'Hangers & straps' }, { id: 'anchors', label: 'Anchor bolts & hold-downs' }
          ],
          other: true, need: false, headline: 'Hardware', exclOn: true, excl: 'Hardware (fasteners, connectors)', cost: 'hardware', star: false
        },
        { id: 'demoWhat', kind: 'text', label: 'What are we demoing?', short: 'Demo', jobs: ['demo'], prefix: 'Demo', def: 'existing structure', star: true },
        {
          id: 'haul', kind: 'choice', label: 'Are we hauling off the debris?', short: 'Haul off', jobs: [], na: false,
          line: 'Haul off Debris', optMode: 'lines', options: [],
          other: false, need: false, headline: '', exclOn: true, excl: 'Haul off of debris', cost: 'dump', star: true
        }
      ],
      supplies: [
        { id: 'crane', label: 'Crane' }, { id: 'lift', label: 'Lift' }, { id: 'hardware', label: 'Hardware' },
        { id: 'lumber', label: 'Lumber' }, { id: 'dump', label: 'Dump' }, { id: 'gas', label: 'Gas' },
        { id: 'insurance', label: 'Insurance' }, { id: 'misc', label: 'Misc.' }
      ],
      watch: 15,
      includes: '',
      footer: '2 Year Craftsmanship Warranty, Thank you for your business!',
      exclTitle: 'Excludes- By Owner / Others'
    };
  }

  // Lines, prices and rates below are the ones on the roofing underwriting sheet.
  // The scope questions are a starting set; Setup is where they get shaped.
  function defaultRoofing() {
    const ask = (id, label, short, line, excl, cost, priced, na) => ({
      id, kind: 'choice', label, short, jobs: [], na, line, optMode: 'lines', options: [],
      other: false, need: false, headline: '', exclOn: true, excl, cost, priced, star: false
    });
    return {
      name: 'Roofing',
      jobs: [
        // Starter wording for what each roof includes. It is there to be edited in Setup.
        { id: 'shingle', label: 'Shingle roof', heading: 'Shingle Roof', items: preset('Install new underlayment', 'Install new drip edge', 'Install starter strip', 'Install GAF Timberline HDZ shingles', 'Install hip and ridge cap', 'Replace pipe jacks and flashings', 'Job site clean up') },
        { id: 'tile', label: 'Tile roof', heading: 'Tile Roof', items: preset('Remove and stack existing tile', 'Install new underlayment', 'Install new drip edge and flashings', 'Re-lay existing tile', 'Job site clean up') },
        { id: 'foam', label: 'Foam roof', heading: 'Foam Roof', items: preset('Prepare and clean the roof surface', 'Apply spray polyurethane foam', 'Apply elastomeric coating', 'Job site clean up') },
        { id: 'metal', label: 'Metal roof', heading: 'Metal Roof', items: preset('Install metal underlayment', 'Install metal roof panels', 'Install trim, ridge cap and flashings', 'Job site clean up') },
        { id: 'seam', label: 'Standing seam roof', heading: 'Standing Seam Roof', items: preset('Install metal underlayment', 'Install standing seam panels', 'Install trim, ridge cap and flashings', 'Job site clean up') }
      ],
      questions: [
        ask('tearoff', 'Are we tearing off the existing roof?', 'Tear off', 'Tear off existing roof', 'Tear off of the existing roof', '', '', true),
        ask('plywood', 'Are we replacing plywood?', 'Plywood', 'Plywood replacement', 'Plywood replacement', 'lPlywood', 'pPlywood', true),
        ask('fascia', 'Are we repairing fascia?', 'Fascia', 'Fascia repair', 'Fascia repair', 'lFascia', '', true),
        ask('solar', 'Are we taking solar panels off and putting them back?', 'Solar panels', 'Solar panels un-install & re-install', 'Solar panel un-install and re-install', 'lSolar', 'pSolar', true),
        ask('haul', 'Are we hauling off the debris?', 'Haul off', 'Haul off Debris', 'Haul off of debris', 'lDump', '', false)
      ],
      sell: [
        { id: 'pShingle', label: 'Whole Roof Shingle Replacement (underlayment, drip edge)', unit: 'SQ', price: '580.00', job: 'shingle' },
        { id: 'pTile', label: 'Whole Roof Tile Replacement (underlayment)', unit: 'SQ', price: '', job: 'tile' },
        { id: 'pFoam', label: 'Whole Roof Foam Replacement', unit: 'SQ', price: '', job: 'foam' },
        { id: 'pMetal', label: 'Whole Roof Metal Replacement', unit: 'SQ', price: '', job: 'metal' },
        { id: 'pSeam', label: 'Whole Roof Standing Seam Replacement', unit: 'SQ', price: '', job: 'seam' },
        { id: 'pPlywood', label: 'Whole Roof Plywood Replacement', unit: 'sheet', price: '60.00', job: '' },
        { id: 'pSolar', label: 'Solar Panels un-install & re-install', unit: '', price: '200.00', job: '' }
      ],
      labor: [
        { id: 'lShingle', label: 'Shingle install labor', unit: 'SQ', price: '90.00', job: 'shingle' },
        { id: 'lTile', label: 'Tile install labor', unit: 'SQ', price: '110.00', job: 'tile' },
        { id: 'lFoam', label: 'Foam install labor', unit: 'SQ', price: '', job: 'foam' },
        { id: 'lMetal', label: 'Metal install labor', unit: 'SQ', price: '', job: 'metal' },
        { id: 'lSeam', label: 'Standing seam install labor', unit: 'SQ', price: '', job: 'seam' },
        { id: 'lFascia', label: 'Fascia', unit: '', price: '100.00', job: '' },
        { id: 'lPlywood', label: 'Plywood labor', unit: 'sheet', price: '50.00', job: '' },
        { id: 'lSolar', label: 'Solar panels un-install & re-install', unit: '', price: '200.00', job: '' },
        { id: 'lDump', label: 'Dump & gas', unit: '', price: '500.00', job: '' }
      ],
      mats: [
        { id: 'mShingles', label: 'GAF Timberline HDZ shingles, per SQ (3 bundles)', price: '139.00' },
        { id: 'mRidge', label: 'GAF ridge cap, per 33 ft', price: '86.25' },
        { id: 'mStarter', label: 'GAF starter strip (120 LF), per bundle', price: '84.85' },
        { id: 'mValley', label: 'Valley metal', price: '40.00' },
        { id: 'mUnderlay', label: 'SecureGrip 30 underlayment', price: '90.00' },
        { id: 'mSeam', label: 'Standing seam', price: '400.00' },
        { id: 'mMetalUnder', label: 'Metal underlayment', price: '125.00' },
        { id: 'mUnderNails', label: 'Underlayment nails', price: '24.60' },
        { id: 'mCoilNails', label: 'Shingle coil nails 1-1/4', price: '55.80' },
        { id: 'mStaples', label: 'Staples for overhang, 1 in crown, 1 in long', price: '41.50' },
        { id: 'mBaseBlack', label: 'Base sheet (2 SQ), black', price: '130.00' },
        { id: 'mCapA', label: 'Cap sheet, 1 SQ', price: '130.00' },
        { id: 'mFlashing', label: 'Flashings', price: '30.00' },
        { id: 'mDrip', label: 'Drip edge, 10 ft', price: '8.00' },
        { id: 'mCement', label: 'Plastic black roof cement, 5 gal', price: '74.00' },
        { id: 'mPipe', label: 'Pipe jacks', price: '20.00' },
        { id: 'mBase', label: 'Base sheet (2 SQ)', price: '140.00' },
        { id: 'mCapB', label: 'Cap sheet, 1 SQ', price: '140.00' },
        { id: 'mCdx', label: 'CDX', price: '60.00' },
        { id: 'mMisc', label: 'Misc', price: '500.00' }
      ],
      tax: 8.5,
      commission: 10,
      schedule: [50, 30, 20],
      showUnit: true,
      watch: 15,
      includes: 'Labor and Materials',
      footer: '5 Year Workmanship Warranty, Thank you for your business!',
      exclTitle: 'Excludes- By Owner / Others'
    };
  }

  /* Templates. Two come built in. More are added in Setup: a new one gets a name and
     one of the two costing sheets, then its own scopes of work, questions and lines. */
  const BUILTIN = { framing: [defaultFraming, 'crew'], roofing: [defaultRoofing, 'roofing'] };
  const isBuiltin = id => Object.prototype.hasOwnProperty.call(BUILTIN, id);
  const MAX_SCOPES = 24;
  // What a new template starts from. Everything in it can be renamed or removed.
  function starterScope(name, sheet) {
    const base = BUILTIN[sheet === 'roofing' ? 'roofing' : 'framing'][0]();
    const haul = base.questions.find(q => q.id === 'haul');
    const common = { name, jobs: [{ id: 'main', label: name, heading: '', items: [] }], watch: base.watch, footer: 'Thank you for your business!', exclTitle: base.exclTitle };
    if (sheet === 'roofing') {
      return Object.assign(common, {
        questions: [Object.assign({}, haul, { cost: '', priced: '' })],
        sell: [{ id: 'p1', label: name, unit: '', price: '', job: '' }],
        labor: [{ id: 'l1', label: name + ' labor', unit: '', price: '', job: '' }],
        mats: [{ id: 'm1', label: 'Misc', price: '' }],
        tax: base.tax, commission: base.commission, schedule: base.schedule.slice(), showUnit: true, measure: false, includes: 'Labor and Materials'
      });
    }
    return Object.assign(common, {
      questions: [
        Object.assign({}, base.questions.find(q => q.id === 'materials'), { jobs: [], options: [], other: true, need: false, excl: 'Materials', cost: 'materials' }),
        Object.assign({}, haul, { cost: 'dump', star: false })
      ],
      supplies: [{ id: 'materials', label: 'Materials' }, { id: 'equipment', label: 'Equipment' }, { id: 'dump', label: 'Dump' }, { id: 'gas', label: 'Gas' }, { id: 'insurance', label: 'Insurance' }, { id: 'misc', label: 'Misc.' }],
      includes: ''
    });
  }
  const isSq = line => /^sq$/i.test(clean(line.unit));
  const MAX_PRESET = 30, MAX_ITEMS = 60; // preset lines per scope of work, included lines on one ticket
  const setupLines = su => (su.sheet === 'roofing' ? [...su.sell, ...su.labor, ...su.mats] : su.supplies);

  // Everything read back from storage goes through here, so a damaged or hand-edited
  // template can never break the page. Returns null when it is not a template at all.
  function normalizeSetup(raw, sheet) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.jobs) || !Array.isArray(raw.questions)) return null;
    const txt = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const seen = new Set();
    const take = (v, p) => { if (!okId(v) || seen.has(p + v)) return ''; seen.add(p + v); return v; };
    const lineList = (list, max, withUnit, withPrice, jobIds) => {
      const out = [];
      for (const x of (Array.isArray(list) ? list : []).slice(0, max)) {
        if (!x) continue;
        const id = take(x.id, 'l:'), label = txt(x.label, withPrice ? 80 : 40);
        if (!id || !label) continue;
        const line = { id, label };
        if (withUnit) line.unit = txt(x.unit, 10);
        if (withPrice) line.price = moneyText(x.price);
        if (jobIds) line.job = jobIds.has(x.job) ? x.job : '';
        out.push(line);
      }
      return out;
    };

    const su = { v: 2, name: txt(raw.name, 40) || 'Template', sheet };
    su.jobs = [];
    for (const j of raw.jobs.slice(0, 24)) {
      if (!j) continue;
      const id = take(j.id, 'j:'), label = txt(j.label, 40);
      if (!id || !label) continue;
      const iseen = new Set(), items = [];
      for (const it of (Array.isArray(j.items) ? j.items : []).slice(0, MAX_PRESET)) {
        const text = it ? txt(it.text, 120) : '';
        if (text && okId(it.id) && !iseen.has(it.id)) { iseen.add(it.id); items.push({ id: it.id, text }); }
      }
      su.jobs.push({ id, label, heading: txt(j.heading, 60), items });
    }
    const jobIds = new Set(su.jobs.map(j => j.id));
    if (sheet === 'roofing') {
      su.sell = lineList(raw.sell, 60, true, true, jobIds);
      su.labor = lineList(raw.labor, 60, true, true, jobIds);
      su.mats = lineList(raw.mats, 300, false, true);
    } else {
      su.supplies = lineList(raw.supplies, 60, false, false);
    }
    const lineIds = new Set(setupLines(su).map(x => x.id));
    const sellIds = new Set((su.sell || []).map(x => x.id));

    su.questions = [];
    for (const q of raw.questions.slice(0, 60)) {
      if (!q) continue;
      const id = take(q.id, 'q:'), label = txt(q.label, 90), short = txt(q.short, 30);
      if (!id || (!label && !short)) continue;
      const base = {
        id, kind: q.kind === 'text' ? 'text' : 'choice', label: label || short, short,
        jobs: [...new Set((Array.isArray(q.jobs) ? q.jobs : []).filter(x => jobIds.has(x)))]
      };
      if (base.kind === 'text') {
        Object.assign(base, { prefix: txt(q.prefix, 60), def: txt(q.def, 80), star: !!q.star });
      } else {
        const oseen = new Set(), options = [];
        for (const o of (Array.isArray(q.options) ? q.options : []).slice(0, 40)) {
          if (!o) continue;
          const ol = txt(o.label, 60);
          if (okId(o.id) && !oseen.has(o.id) && ol) { oseen.add(o.id); options.push({ id: o.id, label: ol }); }
        }
        Object.assign(base, {
          na: !!q.na, line: txt(q.line, 120), optMode: q.optMode === 'desc' ? 'desc' : 'lines', options,
          other: !!q.other, need: !!q.need, headline: txt(q.headline, 30),
          exclOn: q.exclOn !== false, excl: txt(q.excl, 120), cost: lineIds.has(q.cost) ? q.cost : '', star: !!q.star
        });
        if (sheet === 'roofing') base.priced = sellIds.has(q.priced) ? q.priced : '';
      }
      su.questions.push(base);
    }
    if (sheet === 'roofing') {
      const sch = Array.isArray(raw.schedule) ? raw.schedule : [];
      su.tax = numIn(raw.tax, 0, 30, 0);
      su.commission = numIn(raw.commission, 0, 60, 0);
      su.schedule = [0, 1, 2].map(i => numIn(sch[i], 0, 100, 0));
      su.showUnit = raw.showUnit !== false;
      su.measure = raw.measure !== false; // show the roof measurement helper on the ticket
    }
    su.watch = numIn(raw.watch, 0, 90, 0);
    su.includes = txt(raw.includes, 60);
    su.footer = txt(raw.footer, 160);
    su.exclTitle = txt(raw.exclTitle, 80);
    return su;
  }
  const fresh = id => normalizeSetup(BUILTIN[id][0](), BUILTIN[id][1]);

  /* ---------- 3. Tickets ----------
     ticket = {
       id, tpl: the id of its template (framing, roofing, or one added in Setup), example,
       status: draft | submitted | returned | approved,
       createdAt, updatedAt, submittedAt, decidedAt,
       note      the approver's note from the last decision
       notes     the estimator's notes for the approver
       log       [{ at, what, note }]
       s         scope: client, scopes of work ticked (`jobs`), answers, proposal wording, and
                 `items`, the lines of what is included:
                   { id, text, job?, pid?, was?, off? }
                   job, pid  the scope of work and the preset line it was copied from
                   was       the preset wording it was copied with (text === was: untouched)
                   off       removed on this ticket; kept as a marker so it does not come back
                 A line with no `job` was typed on the ticket. A line shows and prints when
                 it is not `off` and its scope of work is ticked
       uw        underwriting, shaped by the sheet type:
                   crew     { mode: sqft | lump, sqft, rate, lump,
                              crews: [{ id, count, rate, dA, dB }],
                              supplies: [{ id, label, cost, custom? }] }
                   roofing  { sell:  [{ id, label, unit, price, book, qty, custom? }],
                              labor: [{ id, label, unit, price, book, qty, custom? }],
                              mats:  [{ id, label, price, book, qty, custom? }],
                              meas:  { rows: [{ id, pitch, sqft }], perimeter, ridge, valley },
                              tax, commission, schedule }
                            `price` is what this job is costed at. `book` is the Setup price it
                            was copied from, so a price typed on the ticket can be told apart.
       frozen    the template as it stood when the ticket was submitted, or null while it is
                 a draft. A locked ticket reads this copy, so nothing in Setup can change
                 what is waiting for approval or already approved.
       snapshot  proposal content frozen at approval, or null
     }
     Numbers are kept as the text the estimator typed and parsed when needed.
     Cost lines, prices and rates are copied onto the ticket, so a later change in
     Setup never moves the numbers of a ticket that has been submitted. */

  const STATUS = { draft: 'Draft', submitted: 'Waiting for approval', returned: 'Sent back', approved: 'Approved' };
  const editable = t => t.status === 'draft' || t.status === 'returned';
  const SCOPE_TEXT = ['estimator', 'issued', 'proposalNo', 'name', 'phone', 'email', 'street', 'city', 'state', 'zip', 'heading', 'extraIn', 'extraEx', 'footer'];
  const FORM_TEXT = SCOPE_TEXT.filter(k => k !== 'extraIn'); // the ones with a box on the Scope tab

  const tplOf = t => (!editable(t) && t.frozen) || setups[t.tpl] || setups.framing;
  const sameName = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
  // The line under a ticket's name. The template goes by its current name even on a
  // locked ticket (a rename is a label, not proposal content), and a heading that only
  // repeats it is left off.
  const scopeName = t => (setups[t.tpl] || tplOf(t)).name;
  const subLine = (t, heading) => [t.id, scopeName(t), sameName(heading, scopeName(t)) ? '' : heading, t.example ? 'Example' : ''].filter(Boolean).join(' \u00b7 ');

  const blankAns = q => (q.kind === 'text' ? { text: q.def || '' } : { a: '', opts: {}, other: '' });
  function blankScope(su) {
    const s = {
      estimator: '', issued: todayISO(), proposalNo: '',
      name: '', phone: '', email: '', street: '', city: '', state: 'AZ', zip: '',
      jobs: {}, ans: {}, items: [], heading: '', extraIn: '', showEx: true, extraEx: '', footer: su.footer
    };
    for (const q of su.questions) s.ans[q.id] = blankAns(q);
    return s;
  }
  // Fit a ticket's answers to the current template: keep what still exists, drop the rest.
  function reconcileScope(s, su) {
    const jobs = {}, ans = {};
    for (const j of su.jobs) jobs[j.id] = !!(s.jobs && s.jobs[j.id]);
    for (const q of su.questions) {
      const a = s.ans && s.ans[q.id], b = blankAns(q);
      if (a && typeof a === 'object') {
        if (q.kind === 'text') { if (typeof a.text === 'string') b.text = a.text.slice(0, 80); }
        else {
          if (a.a === 'yes' || a.a === 'no' || (a.a === 'na' && q.na)) b.a = a.a;
          for (const o of q.options) if (a.opts && a.opts[o.id]) b.opts[o.id] = true;
          if (q.other && typeof a.other === 'string') b.other = a.other.slice(0, 80);
        }
      }
      ans[q.id] = b;
    }
    s.jobs = jobs; s.ans = ans;
    reconcileItems(s, su);
    return s;
  }
  /* The included lines of a ticket, brought in step with its template.
       - a scope of work that is ticked gets every preset line it does not have yet
       - a line still worded as its preset follows the preset when Setup rewords it
       - a line reworded on the ticket keeps its wording
       - a preset line taken out of Setup goes, unless it was reworded on the ticket
       - a line removed on the ticket stays removed
     Lines of a scope that is not ticked are kept but not shown, so ticking it again brings
     back the wording typed before. */
  const itemsShown = s => (s.items || []).filter(it => !it.off && (!it.job || s.jobs[it.job]));
  function reconcileItems(s, su) {
    const have = (Array.isArray(s.items) ? s.items : []).filter(it => it && typeof it === 'object');
    const out = [];
    for (const j of su.jobs) {
      const preset = j.items || [], ids = new Set(preset.map(p => p.id));
      const mine = have.filter(it => it.job === j.id);
      for (const p of preset) {
        const cur = mine.find(it => it.pid === p.id);
        if (cur) out.push(Object.assign({ id: cur.id, text: cur.text === cur.was ? p.text : cur.text, job: j.id, pid: p.id, was: p.text }, cur.off ? { off: true } : {}));
        else if (s.jobs[j.id]) out.push({ id: uid('i'), text: p.text, job: j.id, pid: p.id, was: p.text });
      }
      // its preset is gone: it stays only if somebody reworded it, as a line of that scope
      for (const it of mine) if ((!it.pid || !ids.has(it.pid)) && !it.off && clean(it.text) && (!it.pid || it.text !== it.was)) out.push({ id: it.id, text: it.text, job: j.id });
    }
    for (const it of have) if (!it.job) out.push({ id: it.id, text: it.text });
    s.items = out;
  }
  // Before there were lines, extra inclusions were typed into one box ("Anything else
  // included?"). On a ticket that can still be edited they become lines of their own.
  function foldExtras(s) {
    const extra = String(s.extraIn || '').split(/\n+/).map(clean).filter(Boolean);
    if (!extra.length) return;
    if (!Array.isArray(s.items)) s.items = [];
    for (const text of extra.slice(0, MAX_ITEMS)) s.items.push({ id: uid('i'), text: text.slice(0, 120) });
    s.extraIn = '';
  }

  const blankCrew = from => ({ id: uid('c'), count: '', rate: '', dA: from ? from.dA : '', dB: from ? from.dB : '' });
  const blankPitch = () => ({ id: uid('p'), pitch: '', sqft: '' });
  function blankUw(su) {
    if (su.sheet === 'roofing') {
      const copy = (l, unit) => Object.assign({ id: l.id, label: l.label, price: l.price || '', book: l.price || '', qty: '' }, unit ? { unit: l.unit || '' } : {});
      return {
        sell: su.sell.map(l => copy(l, true)), labor: su.labor.map(l => copy(l, true)), mats: su.mats.map(l => copy(l, false)),
        meas: { rows: [blankPitch()], perimeter: '', ridge: '', valley: '' },
        tax: su.tax, commission: su.commission, schedule: su.schedule.slice()
      };
    }
    return {
      mode: 'sqft', sqft: '', rate: '', lump: '',
      crews: [blankCrew()],
      supplies: su.supplies.map(x => ({ id: x.id, label: x.label, cost: '' }))
    };
  }
  // Bring an editable ticket's cost lines in step with the template: new lines appear,
  // a removed line stays only while it still carries a number. A price the estimator
  // typed on the ticket is kept; one still at the book price it was copied from follows
  // the book. Rates always follow the template.
  const typedPrice = l => num(l.price) > 0 && num(l.price) !== num(l.book);
  const offBook = l => !l.custom && typedPrice(l);
  function reconcileUw(uw, su) {
    if (su.sheet === 'roofing') {
      const merge = (key, unit) => {
        const have = new Map(uw[key].map(l => [l.id, l])), ids = new Set(su[key].map(l => l.id));
        const out = su[key].map(n => {
          const cur = have.get(n.id), book = n.price || '';
          return Object.assign({ id: n.id, label: n.label, price: cur && typedPrice(cur) ? cur.price : book, book, qty: cur ? cur.qty : '' }, unit ? { unit: n.unit || '' } : {});
        });
        for (const l of uw[key]) if (!ids.has(l.id) && (l.custom || num(l.qty) > 0)) out.push(Object.assign({}, l, { custom: true }));
        uw[key] = out;
      };
      merge('sell', true); merge('labor', true); merge('mats', false);
      if (!uw.meas.rows.length) uw.meas.rows.push(blankPitch());
      Object.assign(uw, { tax: su.tax, commission: su.commission, schedule: su.schedule.slice() });
      return uw;
    }
    const have = new Map(uw.supplies.map(l => [l.id, l])), ids = new Set(su.supplies.map(x => x.id));
    const lines = su.supplies.map(x => ({ id: x.id, label: x.label, cost: have.has(x.id) ? have.get(x.id).cost : '' }));
    for (const l of uw.supplies) if (!ids.has(l.id) && (l.custom || num(l.cost) > 0)) lines.push({ id: l.id, label: l.label, cost: l.cost, custom: true });
    uw.supplies = lines;
    if (!uw.crews.length) uw.crews.push(blankCrew());
    return uw;
  }
  // Rebuild underwriting data read from storage into a known-good shape.
  function fixUw(raw, su) {
    const u = raw && typeof raw === 'object' ? raw : {};
    const uw = blankUw(su);
    if (su.sheet === 'roofing') {
      const fixLines = (list, unit) => list.filter(l => l && okId(l.id)).slice(0, 400).map(l => Object.assign(
        { id: l.id, label: str(l.label, 80), price: str(l.price, 20), book: str(l.book, 20), qty: str(l.qty, 16) }, unit ? { unit: str(l.unit, 10) } : {}, l.custom ? { custom: true } : {}));
      if (Array.isArray(u.sell)) uw.sell = fixLines(u.sell, true);
      if (Array.isArray(u.labor)) uw.labor = fixLines(u.labor, true);
      if (Array.isArray(u.mats)) uw.mats = fixLines(u.mats, false);
      const m = u.meas && typeof u.meas === 'object' ? u.meas : {};
      if (Array.isArray(m.rows) && m.rows.length) {
        uw.meas.rows = m.rows.filter(r => r && typeof r === 'object').slice(0, 12).map(r => ({ id: okId(r.id) ? r.id : uid('p'), pitch: str(r.pitch, 6), sqft: str(r.sqft, 12) }));
      }
      for (const k of ['perimeter', 'ridge', 'valley']) uw.meas[k] = str(m[k], 12);
      uw.tax = numIn(u.tax, 0, 30, su.tax);
      uw.commission = numIn(u.commission, 0, 60, su.commission);
      if (Array.isArray(u.schedule) && u.schedule.length === 3) uw.schedule = u.schedule.map(x => numIn(x, 0, 100, 0));
      if (!uw.meas.rows.length) uw.meas.rows.push(blankPitch());
      return uw;
    }
    uw.mode = u.mode === 'lump' ? 'lump' : 'sqft';
    for (const k of ['sqft', 'rate', 'lump']) uw[k] = str(u[k], 20);
    if (Array.isArray(u.crews)) {
      uw.crews = u.crews.filter(c => c && typeof c === 'object').slice(0, 20)
        .map(c => ({ id: okId(c.id) ? c.id : uid('c'), count: str(c.count, 12), rate: str(c.rate, 12), dA: str(c.dA, 12), dB: str(c.dB, 12) }));
    }
    if (Array.isArray(u.supplies)) {
      uw.supplies = u.supplies.filter(l => l && okId(l.id)).slice(0, 60)
        .map(l => Object.assign({ id: l.id, label: str(l.label, 40), cost: str(l.cost, 20) }, l.custom ? { custom: true } : {}));
    }
    if (!uw.crews.length) uw.crews.push(blankCrew());
    return uw;
  }

  function blankTicket(tpl, id) {
    const su = setups[tpl], at = nowISO();
    return {
      id, tpl, example: false, status: 'draft', createdAt: at, updatedAt: at, submittedAt: '', decidedAt: '',
      note: '', notes: '', log: [], s: blankScope(su), uw: blankUw(su), frozen: null, snapshot: null
    };
  }
  // An approved proposal read back from storage, forced into the shape the sheet draws.
  // One that is missing its basics is dropped: the ticket then rebuilds the same proposal
  // from its frozen template, scope and numbers.
  function fixSnap(x) {
    if (!x || typeof x !== 'object' || !x.client || typeof x.client !== 'object' || !Array.isArray(x.included) || !Array.isArray(x.excluded)) return null;
    if (typeof x.client.name !== 'string' || typeof x.heading !== 'string' || typeof x.includes !== 'string') return null;
    const item = i => ({ service: str(i && i.service, 240), desc: str(i && i.desc, 240), amount: str(i && i.amount, 40) });
    const items = a => (Array.isArray(a) ? a : []).slice(0, 300).map(item);
    const c = x.client, total = Number(x.total);
    return {
      client: { name: str(c.name, 240), phone: str(c.phone, 60), email: str(c.email, 240), address: str(c.address, 400) },
      issued: str(x.issued, 20), proposalNo: str(x.proposalNo, 60), heading: str(x.heading, 240), autoHeading: str(x.autoHeading, 240),
      includes: str(x.includes, 160), included: items(x.included), excludes: str(x.excludes, 160),
      excludedAll: items(Array.isArray(x.excludedAll) ? x.excludedAll : x.excluded), excluded: items(x.excluded),
      total: Number.isFinite(total) ? total : 0, totalText: str(x.totalText, 40) || money(Number.isFinite(total) ? total : 0), footer: str(x.footer, 400)
    };
  }

  function fixTicket(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
    const tpl = Object.prototype.hasOwnProperty.call(setups, raw.tpl) ? raw.tpl : 'framing';
    const t = blankTicket(tpl, raw.id.slice(0, 20));
    t.example = !!raw.example;
    t.status = STATUS[raw.status] ? raw.status : 'draft';
    // A locked ticket reads its own copy of the template. One saved before copies were
    // kept is frozen here, against the template as it stands today.
    // The copy knows which sheet it is costed on, even if its template has since gone.
    const sheet = raw.frozen && (raw.frozen.sheet === 'roofing' || raw.frozen.sheet === 'crew') ? raw.frozen.sheet : setups[tpl].sheet;
    if (!editable(t)) t.frozen = normalizeSetup(raw.frozen, sheet) || clone(setups[tpl]);
    const su = tplOf(t);
    for (const k of ['createdAt', 'updatedAt', 'submittedAt', 'decidedAt']) if (typeof raw[k] === 'string') t[k] = raw[k].slice(0, 40);
    t.note = str(raw.note, 400); t.notes = str(raw.notes, 2000);
    t.log = (Array.isArray(raw.log) ? raw.log : []).filter(e => e && typeof e.what === 'string').slice(-30)
      .map(e => ({ at: str(e.at, 40), what: str(e.what, 60), note: str(e.note, 400) }));

    const s = raw.s && typeof raw.s === 'object' ? raw.s : {};
    for (const k of SCOPE_TEXT) if (typeof s[k] === 'string') t.s[k] = s[k].slice(0, 2000);
    t.s.showEx = s.showEx !== false;
    t.s.jobs = s.jobs && typeof s.jobs === 'object' ? s.jobs : {};
    t.s.ans = s.ans && typeof s.ans === 'object' ? s.ans : {};
    t.s.items = (Array.isArray(s.items) ? s.items : []).filter(it => it && typeof it === 'object').slice(0, 400).map(it => Object.assign(
      { id: okId(it.id) ? it.id : uid('i'), text: str(it.text, 120) },
      okId(it.job) ? { job: it.job } : {}, okId(it.job) && okId(it.pid) ? { pid: it.pid, was: str(it.was, 120) } : {}, it.off ? { off: true } : {}));
    if (editable(t)) foldExtras(t.s);
    reconcileScope(t.s, su);

    t.uw = fixUw(raw.uw, su);
    if (editable(t)) reconcileUw(t.uw, su);
    t.snapshot = t.status === 'approved' ? fixSnap(raw.snapshot) : null;
    return t;
  }

  /* ---------- 4. Rules ---------- */

  const applies = (q, s) => !q.jobs.length || q.jobs.some(j => s.jobs[j]);

  // Scope answers -> what the proposal says. `quote` comes from underwriting.
  // `priced` are lines that carry their own amount (the piece-rate sheet's client price
  // lines). They print first, then the included lines of the scopes of work ticked, then
  // the answers. A Yes whose `priced` line is on the ticket adds no line of its own.
  function buildModel(s, su, quote, priced) {
    const jobsOn = su.jobs.filter(j => s.jobs[j.id]);
    const multi = jobsOn.length > 1;
    const autoHeading = jobsOn.length ? joinNames(jobsOn.map(j => safe(j.heading || j.label))) : 'Scope of Work';
    const inc = [], exc = [], charged = new Set();
    for (const p of priced || []) { inc.push({ service: p.service, desc: p.desc, amount: p.amount }); charged.add(p.id); }
    for (const it of itemsShown(s)) { const line = safe(it.text); if (line) inc.push({ service: line }); }
    let headline = '', pending = false;

    for (const q of su.questions) {
      if (!applies(q, s)) continue;
      const a = s.ans[q.id] || blankAns(q);
      const star = q.star && multi ? '**' : '';
      if (q.kind === 'text') {
        const line = [safe(q.prefix), safe(a.text) || safe(q.def)].filter(Boolean).join(' ');
        if (line) inc.push({ service: star + line });
        continue;
      }
      if (!a.a) { if (q.headline) pending = true; continue; }
      const line = safe(q.line), name = safe(q.short) || safe(q.label);
      if (a.a === 'yes') {
        if (q.headline && !headline) headline = safe(q.headline);
        if (q.priced && charged.has(q.priced)) continue;
        const picked = q.options.filter(o => a.opts && a.opts[o.id]).map(o => safe(o.label));
        if (q.other && safe(a.other)) picked.push(safe(a.other));
        if (q.optMode === 'desc') {
          inc.push({ service: star + (line || name), desc: capFirst(picked.map((p, i) => (i ? lowFirst(p) : p)).join(', ')) });
        } else {
          if (line) inc.push({ service: star + line });
          for (const p of picked) inc.push({ service: star + capFirst(p) });
          if (!line && !picked.length) inc.push({ service: star + name });
        }
      } else if (a.a === 'no' && q.exclOn) {
        exc.push({ service: safe(q.excl) || line || name });
      }
    }
    for (const l of linesOf(s.extraIn)) inc.push({ service: l });
    for (const l of linesOf(s.extraEx)) exc.push({ service: l });

    // The grey row. A template can fix its wording; otherwise it is
    // "Labor and <first Yes that carries a word>", or "Labor Only".
    let includes = 'Includes- ' + (safe(su.includes) || 'Labor');
    if (!su.includes) {
      if (headline) includes += ' and ' + headline;
      else if (!pending) includes += ' Only';
    }

    const street = safe(s.street), city = safe(s.city), st = upperLatin(safe(s.state)), zip = safe(s.zip);
    const tail = [city, [st, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const total = round2(quote || 0);
    return {
      client: { name: safe(s.name), phone: safe(s.phone), email: safe(s.email), address: street ? [street, tail].filter(Boolean).join(', ') : '' },
      issued: safe(s.issued) || todayISO(),
      proposalNo: safe(s.proposalNo),
      heading: safe(s.heading) || autoHeading,
      autoHeading,
      includes,
      included: inc,
      excludes: safe(su.exclTitle) || 'Excludes- By Owner / Others',
      excludedAll: exc,
      excluded: s.showEx ? exc : [],
      total,
      totalText: money(total),
      footer: safe(s.footer)
    };
  }
  // Roofing: every client price line with a quantity prints on the proposal.
  function pricedLines(t) {
    const su = tplOf(t);
    if (su.sheet !== 'roofing') return [];
    return t.uw.sell.filter(l => num(l.qty) > 0 && num(l.price) > 0).map(l => ({
      id: l.id,
      service: safe(l.label) || 'Roofing',
      desc: su.showUnit ? `${fmtQty(num(l.qty))} × ${money(num(l.price))}${safe(l.unit) ? ' per ' + safe(l.unit) : ''}` : '',
      amount: money(round2(num(l.qty) * num(l.price)))
    }));
  }

  const kindOf = (has, profit, margin, watch) => (!has ? 'none' : profit < 0 ? 'bad' : watch > 0 && margin * 100 < watch ? 'warn' : 'ok');
  const sumOf = (list, f) => round2(list.reduce((a, x) => a + f(x), 0));
  // The two numbers a ticket is judged by, the same shape for every sheet type.
  const factOf = (label, value, margin, watch, fmt) => ({ label, value, margin, text: margin == null ? '' : fmt(margin), kind: kindOf(margin != null, value, margin, watch) });

  /* Underwriting math, Framing (sheet "crew").
       client quote     = SQFT x labor price per SQFT            (or a typed lump sum)
       total per day    = laborers x price per laborer           (per crew line)
       labor cost       = total per day x days                   (planned days, then overrun days)
       our total cost   = labor + supplies                       (planned and overrun)
       projected profit = client quote - our total cost
       margin           = profit / client quote */
  function crewCalc(uw, watch) {
    const quote = uw.mode === 'lump' ? round2(num(uw.lump)) : round2(num(uw.sqft) * num(uw.rate));
    const crews = uw.crews.map(c => {
      const count = num(c.count), rate = num(c.rate), dA = num(c.dA), dB = num(c.dB);
      const perDay = round2(count * rate);
      return {
        id: c.id, count, rate, dA, dB, perDay, costA: round2(perDay * dA), costB: round2(perDay * dB),
        empty: !clean(c.count) && !clean(c.rate),
        complete: count > 0 && rate > 0 && dA > 0 && dB > 0
      };
    });
    const laborA = sumOf(crews, c => c.costA), laborB = sumOf(crews, c => c.costB);
    const supplies = sumOf(uw.supplies, l => num(l.cost));
    const costA = round2(laborA + supplies), costB = round2(laborB + supplies);
    const profitA = round2(quote - costA), profitB = round2(quote - costB);
    const marginA = quote > 0 ? profitA / quote : null, marginB = quote > 0 ? profitB / quote : null;
    return {
      sheet: 'crew', quote, crews, laborers: sumOf(crews, c => c.count), perDay: sumOf(crews, c => c.perDay),
      laborA, laborB, supplies, costA, costB, profitA, profitB, marginA, marginB,
      started: quote > 0 && costA > 0,
      facts: [factOf('Profit, planned', profitA, marginA, 0, pct), factOf('Profit, overrun', profitB, marginB, watch, pct)]
    };
  }

  /* Underwriting math, Roofing (sheet "roofing"). Labor is piece rate: a set amount per
     square for the kind of roof, so there are no days to project.
       client quote    = sum of client price lines, quantity x unit price
       labor           = sum of labor lines, quantity x unit price
       materials       = sum of quantity x price-book price, then sales tax on top
       total hard cost = labor + materials with tax
       gross profit    = client quote - total hard cost
       commission      = client quote x commission rate
       net profit      = gross profit - commission
       cost per SQ     = hard cost / squares on the labor lines
       quote per SQ    = client quote / squares on the client price lines */
  const lineAmount = l => round2(num(l.qty) * num(l.price));
  function roofCalc(uw, watch) {
    const quote = sumOf(uw.sell, lineAmount), labor = sumOf(uw.labor, lineAmount), matSub = sumOf(uw.mats, lineAmount);
    const matTax = round2(matSub * uw.tax / 100), matTotal = round2(matSub + matTax);
    const hard = round2(labor + matTotal), gross = round2(quote - hard);
    const commission = round2(quote * uw.commission / 100), net = round2(gross - commission);
    const squares = sumOf(uw.labor.filter(isSq), l => num(l.qty)), sellSq = sumOf(uw.sell.filter(isSq), l => num(l.qty));
    const grossM = quote > 0 ? gross / quote : null, netM = quote > 0 ? net / quote : null;
    // Payments: each share of the quote. When the shares come to 100%, the last real
    // payment takes whatever rounding left over, so the payments always add up to the quote.
    const schedule = uw.schedule.map(p => ({ pct: p, amount: round2(quote * p / 100) }));
    const scheduleSum = round2(uw.schedule.reduce((a, p) => a + p, 0));
    const last = schedule.reduce((at, x, i) => (x.pct > 0 ? i : at), -1); // the last payment that is not 0%
    if (scheduleSum === 100 && last >= 0) schedule[last].amount = round2(quote - sumOf(schedule.filter((x, i) => i !== last), x => x.amount));
    return {
      sheet: 'roofing', quote, labor, matSub, matTax, matTotal, hard, gross, commission, net, grossM, netM,
      taxPct: uw.tax, commissionPct: uw.commission, squares, sellSq, hasSq: uw.labor.some(isSq) || uw.sell.some(isSq),
      costPerSq: squares > 0 ? round2(hard / squares) : null,
      quotePerSq: sellSq > 0 ? round2(quote / sellSq) : null,
      schedule, scheduleSum,
      started: quote > 0 && hard > 0,
      facts: [factOf('Gross profit', gross, grossM, 0, pct2), factOf('Net profit', net, netM, watch, pct2)]
    };
  }
  /* The pitch helper. Flat (plan) square feet x the pitch factor = true roof square feet,
     and 100 square feet is one square. The factor is the slope multiplier off a roofer's
     pitch chart, sqrt(1 + (rise / 12)^2) kept to three places: 5/12 is 1.083, 10/12 is
     1.302, 12/12 is 1.414. The result only informs the estimator; quantities are typed. */
  const pitchFactor = rise => Math.round(Math.sqrt(1 + (rise / 12) * (rise / 12)) * 1000) / 1000;
  const pitchOf = v => Math.min(24, num(String(v == null ? '' : v).split('/')[0])); // "5/12" is 5
  function measCalc(meas) {
    const rows = meas.rows.map(r => {
      const area = round2(num(r.sqft) * pitchFactor(pitchOf(r.pitch)));
      return { id: r.id, area, squares: round2(area / 100) };
    });
    const area = sumOf(rows, r => r.area);
    return { rows, flat: sumOf(meas.rows, r => num(r.sqft)), area, squares: round2(area / 100) };
  }
  const calcOf = t => { const su = tplOf(t); return su.sheet === 'roofing' ? roofCalc(t.uw, su.watch) : crewCalc(t.uw, su.watch); };

  // The underwriting lines of a ticket, by the part of the sheet they sit in.
  const uwGroups = t => (tplOf(t).sheet === 'roofing'
    ? [['client price', t.uw.sell], ['labor', t.uw.labor], ['materials', t.uw.mats]]
    : [['', t.uw.supplies]]);
  const uwLines = t => uwGroups(t).flatMap(g => g[1]);
  const lineHas = (t, l) => (tplOf(t).sheet === 'roofing' ? num(l.qty) > 0 : num(l.cost) > 0);

  // What the scope says about a line: in | out | '' (no linked answer yet). An answer is
  // tied to a line in one of two ways. `cost`: a Yes means the line must carry a number
  // (`must`). `priced`: the client price line that charges for it, which a Yes may leave
  // empty because the item can sit inside the roof price.
  function scopeSays(t, lineId) {
    let said = '', word = '';
    for (const q of tplOf(t).questions) {
      if (q.kind !== 'choice' || !applies(q, t.s)) continue;
      const hard = q.cost === lineId;
      if (!hard && q.priced !== lineId) continue;
      const a = (t.s.ans[q.id] || {}).a;
      if (a === 'yes') {
        if (hard) return { said: 'in', word: 'In scope', must: true };
        said = 'in'; word = 'In scope';
      } else if (a === 'no' && said !== 'in') { said = 'out'; word = 'By others'; }
      else if (a === 'na' && !said) { said = 'out'; word = 'Not needed'; }
    }
    return { said, word, must: false };
  }
  // A line and the scope disagree: a Yes with nothing on its cost line, or a number on a
  // line the scope says is by others or not needed.
  function clashOf(t, l) {
    const { said, must } = scopeSays(t, l.id), has = lineHas(t, l);
    return (said === 'in' && must && !has) || (said === 'out' && has);
  }

  // Piece-rate sheet: a client price or labor line can belong to one scope of work (`job` in Setup).
  // `fitsJob` is false for such a line on a ticket for a different system.
  function lineJob(t, id) {
    const su = tplOf(t);
    if (su.sheet !== 'roofing') return '';
    const l = su.sell.find(x => x.id === id) || su.labor.find(x => x.id === id);
    return (l && l.job) || '';
  }
  function fitsJob(t, id) {
    const j = lineJob(t, id);
    return !j || !!t.s.jobs[j] || !tplOf(t).jobs.some(x => t.s.jobs[x.id]);
  }
  // Scopes of work picked on the ticket with no line of their own in a list where other
  // scopes have one. A scope added on the spot has no price and no labor rate until
  // somebody sets them up, and the sheet says so instead of just looking short.
  function jobsBare(t, key) {
    const su = tplOf(t);
    if (su.sheet !== 'roofing' || !su[key].some(l => l.job)) return [];
    return su.jobs.filter(j => t.s.jobs[j.id] && !su[key].some(l => l.job === j.id));
  }
  // The lines of one piece-rate list that show on the ticket. Open: every line that fits the
  // scope of work picked. Locked for review: the lines in use, plus any empty line the
  // scope says should carry a quantity. A line that carries a quantity always shows.
  function roofShown(t, key) {
    return editable(t)
      ? t.uw[key].filter(l => num(l.qty) > 0 || fitsJob(t, l.id))
      : t.uw[key].filter(l => num(l.qty) > 0 || clashOf(t, l));
  }

  // Flags: things the approver should look at. They never block submitting.
  function flagsOf(t, calc) {
    const su = tplOf(t), roof = su.sheet === 'roofing', thing = roof ? 'quantity' : 'cost', out = [];
    for (const [where, lines] of uwGroups(t)) {
      const at = where ? ` under ${where}` : '';
      for (const l of lines) {
        const name = clean(l.label) || 'A line';
        if (lineHas(t, l) && !fitsJob(t, l.id)) {
          const j = su.jobs.find(x => x.id === lineJob(t, l.id));
          out.push({ level: 'warn', text: `${name}: it has a quantity${at}, but ${j ? j.label : 'its scope of work'} is not picked on this ticket.` });
        }
        if (!clashOf(t, l)) continue;
        const { said, word } = scopeSays(t, l.id);
        out.push({
          level: 'warn', text: said === 'in'
            ? `${name}: the scope includes it, but it has no ${thing}${at}.`
            : `${name}: it has a ${thing}${at}, but the scope says ${word.toLowerCase()}.`
        });
      }
    }
    if (roof) {
      if (calc.labor > 0 && !(calc.matSub > 0)) out.push({ level: 'warn', text: 'No materials are priced on this job.' });
      if (calc.quote > 0 && calc.scheduleSum !== 100) out.push({ level: 'warn', text: `The payment schedule adds up to ${fmtRate(calc.scheduleSum)}%, not 100%.` });
      if (calc.started) {
        if (calc.gross < 0) out.push({ level: 'bad', text: 'The hard cost is over the client quote.' });
        else if (calc.net < 0) out.push({ level: 'bad', text: 'Loses money once the commission comes out.' });
        else if (su.watch > 0 && calc.netM * 100 < su.watch) out.push({ level: 'warn', text: `Net margin is ${pct2(calc.netM)}, under the ${su.watch}% line.` });
      }
    } else if (calc.started) {
      if (calc.profitA < 0) out.push({ level: 'bad', text: 'Loses money even on the planned days.' });
      else if (calc.profitB < 0) out.push({ level: 'bad', text: 'Loses money if the job runs to the overrun days.' });
      else if (su.watch > 0 && calc.marginB * 100 < su.watch) out.push({ level: 'warn', text: `Overrun margin is ${pct(calc.marginB)}, under the ${su.watch}% line.` });
    }
    return out;
  }

  // What still has to be filled in before the ticket can go for approval.
  function todoOf(t, calc) {
    const s = t.s, su = tplOf(t), m = [];
    if (!clean(s.name)) m.push({ tab: 'scope', id: 'f-name', text: 'Client name' });
    if (su.jobs.length && !su.jobs.some(j => s.jobs[j.id])) m.push({ id: 'job-' + su.jobs[0].id, text: 'Scope of work' });
    for (const q of su.questions) {
      if (q.kind !== 'choice' || !applies(q, s)) continue;
      const a = s.ans[q.id] || blankAns(q), nm = q.short || q.label, p = 'q-' + q.id;
      if (!a.a) m.push({ tab: 'scope', id: p + '-yes', text: `${nm}: ${q.na ? 'pick an answer' : 'yes or no'}` });
      else if (a.a === 'yes' && q.need && (q.options.length || q.other)) {
        const any = q.options.some(o => a.opts && a.opts[o.id]) || (q.other && clean(a.other));
        if (!any) m.push({ tab: 'scope', id: q.options.length ? `${p}-opt-${q.options[0].id}` : p + '-other', text: `Which ${lowFirst(nm)}` });
      }
    }
    if (su.sheet === 'roofing') {
      const u = t.uw, first = (key, fallback) => { const l = roofShown(t, key)[0]; return l ? `u-ln-${l.id}-qty` : fallback; };
      if (!u.sell.some(l => num(l.qty) > 0)) m.push({ tab: 'uw', id: first('sell', 'btnAddSell'), text: 'Client price' });
      if (!u.labor.some(l => num(l.qty) > 0)) m.push({ tab: 'uw', id: first('labor', 'btnAddLabor'), text: t.tpl === 'roofing' ? 'Labor: add the squares' : 'Labor: add a quantity' });
      for (const l of uwLines(t)) {
        if (!(num(l.qty) > 0)) continue;
        if (l.custom && !clean(l.label)) m.push({ tab: 'uw', id: `u-ln-${l.id}-label`, text: 'Name the line you added' });
        if (!(num(l.price) > 0)) m.push({ tab: 'uw', id: `u-ln-${l.id}-price`, text: `Price: ${brief(l.label) || 'the line you added'}` });
      }
      return m;
    }
    if (!(calc.quote > 0)) {
      const id = t.uw.mode === 'lump' ? 'u-lump' : num(t.uw.sqft) > 0 ? 'u-rate' : 'u-sqft';
      m.push({ tab: 'uw', id, text: 'Client quote' });
    }
    const used = calc.crews.filter(c => !c.empty);
    if (!used.length) m.push({ tab: 'uw', id: `u-crew-${t.uw.crews[0].id}-count`, text: 'Labor: add a crew line' });
    calc.crews.forEach((c, i) => {
      if (c.empty || c.complete) return;
      const k = !(c.count > 0) ? 'count' : !(c.rate > 0) ? 'rate' : !(c.dA > 0) ? 'dA' : 'dB';
      m.push({ tab: 'uw', id: `u-crew-${c.id}-${k}`, text: `Labor: finish crew line ${i + 1}` });
    });
    return m;
  }

  function logIt(t, what, note) {
    t.log.push({ at: nowISO(), what, note: note || '' });
    if (t.log.length > 30) t.log.shift();
  }
  // An approved ticket shows the proposal exactly as it was approved.
  const modelOf = (t, calc) => (t.status === 'approved' && t.snapshot
    ? t.snapshot
    : buildModel(t.s, tplOf(t), (calc || calcOf(t)).quote, pricedLines(t)));

  function summaryText(t, m) {
    const L = [`PROPOSAL TICKET ${t.id} - Quest Roofing - ${tplOf(t).name}`];
    if (clean(t.s.estimator)) L.push('Estimator: ' + clean(t.s.estimator));
    L.push('Status: ' + STATUS[t.status]);
    L.push('Issued: ' + m.issued + (m.proposalNo ? '   Proposal #: ' + m.proposalNo : ''));
    L.push('', 'Client: ' + (m.client.name || '(not entered)'));
    if (m.client.phone) L.push('Phone: ' + m.client.phone);
    if (m.client.email) L.push('Email: ' + m.client.email);
    if (m.client.address) L.push('Job site: ' + m.client.address);
    L.push('', 'Job: ' + m.heading, m.includes.replace('Includes- ', 'Includes: '));
    for (const i of m.included) L.push('  - ' + i.service.replace(/^\*+/, '') + (i.desc ? ' (' + i.desc + ')' : '') + (i.amount ? '  ' + i.amount : ''));
    if (m.excludedAll.length) {
      L.push('Not included, by owner / others:');
      for (const i of m.excludedAll) L.push('  - ' + i.service);
    }
    L.push('', 'Total: ' + m.totalText);
    if (clean(t.notes)) L.push('', 'Notes: ' + String(t.notes).trim());
    return L.join('\n');
  }

  return {
    // 1. helpers
    clean, safe, upperLatin, linesOf, capFirst, lowFirst, joinNames,
    num, numIn, round2, fmtNum, fmtQty, fmtRate, money, moneyText, pct, pct2, DASH,
    pad2, todayISO, nowISO, when, dayOf, fmtPhone,
    uid, okId, clone, str, brief,
    // 2. templates
    preset, defaultFraming, defaultRoofing, BUILTIN, isBuiltin, MAX_SCOPES,
    starterScope, isSq, MAX_PRESET, MAX_ITEMS, setupLines, normalizeSetup, fresh,
    // 3. tickets
    STATUS, editable, SCOPE_TEXT, FORM_TEXT,
    tplOf, sameName, scopeName, subLine,
    blankAns, blankScope, reconcileScope, reconcileItems, reconcileUw, foldExtras, itemsShown,
    blankCrew, blankPitch, blankUw, typedPrice, offBook, fixUw,
    blankTicket, fixSnap, fixTicket,
    // 4. rules
    applies, buildModel, pricedLines,
    crewCalc, roofCalc, lineAmount, pitchFactor, pitchOf, measCalc, calcOf,
    uwGroups, uwLines, lineHas, scopeSays, clashOf, lineJob, fitsJob, jobsBare, roofShown,
    flagsOf, todoOf, logIt, modelOf, summaryText,
    // world
    init,
  };
})
