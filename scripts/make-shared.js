/* ======================================================================
   One-time migration: extract the shared rule engine from the prototype
   ----------------------------------------------------------------------
   Reads the prototype's app.js and writes:
     shared/qb-rules.js  — helpers, templates, tickets, underwriting rules
     shared/qb-sheet.js  — proposal sheet layout + PDF

   These modules are plain UMD: they attach to window.QB in a browser and
   module.exports on the server, so the browser and the server run the
   exact same math. Run once; the outputs are the source of truth after.
   ====================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = 'C:\\Users\\ROM\\Downloads\\questbase-estimating-handoff\\questbase-estimating-handoff\\prototype\\src';
const read = p => fs.readFileSync(path.join(SRC, p), 'utf8');
const lines = read('app.js').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n'); // 1-based inclusive

/* ---------------- shared/qb-rules.js ---------------- */

const rulesBody = [
  slice(79, 96),    // helpers: clean, safe, upperLatin, linesOf, capFirst, lowFirst, joinNames
  slice(98, 127),   // numbers: num, numIn, round2, fmtNum, fmtQty, fmtRate, money, moneyText, pct, pct2, DASH
  slice(129, 150),  // misc: pad2, todayISO, nowISO, when, dayOf, fmtPhone, uid, okId, clone, str, brief
  slice(152, 437),  // §2 Templates: preset, defaultFraming, defaultRoofing, BUILTIN, starterScope, normalizeSetup, fresh
  slice(439, 473),  // §3 Tickets: data-shape documentation
  slice(475, 478),  // STATUS, editable, SCOPE_TEXT, FORM_TEXT
  slice(482, 694),  // tplOf, subLine, blank*, reconcile*, fixUw, blankTicket, fixSnap, fixTicket
  slice(894, 1231), // §4 Rules: applies, buildModel, pricedLines, crewCalc, roofCalc, measCalc, calcOf, flags, todos
].join('\n\n');

const rules = `/* ======================================================================
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

${rulesBody}

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
`;

fs.writeFileSync(path.join(ROOT, 'shared', 'qb-rules.js'), rules, 'utf8');

/* ---------------- shared/qb-sheet.js ---------------- */

const logoB64 = fs.readFileSync(path.join(SRC, 'logo3x.jpg')).toString('base64');

const sheetBody = [
  slice(30, 39),      // LOGO (placeholder), LOGO_RATIO, COMPANY
  slice(1233, 1247),  // §5 sheet: layout constants S..MIN_ROWS
  slice(1249, 1389),  // layout()
  slice(1391, 1398),  // compose()
  slice(1454, 1478),  // rgb, buildPdf, fileName
].join('\n\n');

const sheet = `/* ======================================================================
   QUEST BASE: proposal sheet layout and PDF
   ----------------------------------------------------------------------
   One layout pass produces drawing steps (rect / text / image) in points,
   drawn as SVG on screen and as a PDF. Shared by the browser (app.js)
   and the server (the proposal.pdf endpoint) so the two always match.

   jsPDF is injected: window.jspdf.jsPDF in a browser, require('jspdf') on
   a server. Canvas is the text-measurement fallback when it is missing.
   ====================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('jspdf').jsPDF);
  } else {
    root.QB = root.QB || {};
    root.QB.sheet = factory((root.jspdf && root.jspdf.jsPDF) || null);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (jsPDF) {
  'use strict';

${sheetBody}

  return { LOGO, LOGO_RATIO, COMPANY, PAGE_W, LETTER_H, compose, measure, buildDoc, fileName };
})
`;

// measure: drop the browser-only jsPDF lookup; the constructor is injected.
// Canvas stays the fallback for the on-screen sheet only.
let sheetOut = sheet.replace(
  "  // Text widths come from the PDF library when it loaded, so line breaks on screen and\n  // in the PDF are identical. Canvas is the fallback for the on-screen sheet only.\n  const jsPDF = window.jspdf && window.jspdf.jsPDF;\n  const measure = (() => {",
  "  // Text widths come from the PDF library when it loaded, so line breaks on screen and\n  // in the PDF are identical. Canvas is the fallback for the on-screen sheet only.\n  const measure = (() => {"
);

// buildPdf -> buildDoc: return the document, let the caller pick the output format.
sheetOut = sheetOut.replace('  function buildPdf(m) {', '  function buildDoc(m) {');
sheetOut = sheetOut.replace("    return pdf.output('blob');", '    return pdf;');
sheetOut = sheetOut.replace("creator: 'Quest Base estimating prototype'", "creator: 'Quest Base Estimating'");

// inline the logo as a data URI.
sheetOut = sheetOut.replace("const LOGO = '__LOGO__';", "const LOGO = 'data:image/jpeg;base64,${logoB64}';");

fs.writeFileSync(path.join(ROOT, 'shared', 'qb-sheet.js'), sheetOut, 'utf8');

console.log('wrote shared/qb-rules.js and shared/qb-sheet.js');
