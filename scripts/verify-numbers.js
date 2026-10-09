/* ======================================================================
   Verify the shared rule engine against every number in HANDOFF.md §10
   — Abraham's framing and roofing sheets, to the cent.
   ====================================================================== */
const Rules = require('../shared/qb-rules.js');

let passed = 0, failed = 0;
function eq(label, actual, expected) {
  const a = Math.round(actual * 100) / 100;
  const e = Math.round(expected * 100) / 100;
  if (a === e) { passed++; }
  else { failed++; console.error(`FAIL ${label}: got ${a}, expected ${e}`); }
}
function eqStr(label, actual, expected) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`FAIL ${label}: got "${actual}", expected "${expected}"`); }
}

// Build the two example tickets exactly as the prototype's demo data did.
const setups = { framing: Rules.normalizeSetup(Rules.defaultFraming(), 'crew'), roofing: Rules.normalizeSetup(Rules.defaultRoofing(), 'roofing') };
Rules.init(setups);

function makeTicket(tpl, s, uw) {
  const t = Rules.blankTicket(tpl, 'T-1000');
  Object.assign(t.s, s);
  Rules.reconcileScope(t.s, setups[tpl]);
  Object.assign(t.uw, uw);
  Rules.reconcileUw(t.uw, setups[tpl]);
  return t;
}

/* ----- Framing: Marcus Delgado (T-1002) ----- */
const framing = makeTicket('framing', {
  estimator: 'Rico Alvarez', name: 'Marcus Delgado', phone: '480-555-0142',
  email: 'mdelgado@example.com', street: '1820 E Sample Ln', city: 'Queen Creek', zip: '85142',
  jobs: { carpentry: true, demo: true },
  ans: {
    materials: { a: 'yes', opts: { lumber: true, truss: true }, other: '' },
    crane: { a: 'yes', opts: {}, other: '' },
    hardware: { a: 'yes', opts: { fasteners: true, bases: true }, other: '' },
    demoWhat: { text: 'existing structure' },
    haul: { a: 'yes', opts: {}, other: '' }
  }
}, {
  mode: 'sqft', sqft: '1,137', rate: '11.00',
  crews: [
    { id: 'c1', count: '1', rate: '250.00', dA: '5', dB: '7' },
    { id: 'c2', count: '3', rate: '230.00', dA: '5', dB: '7' }
  ],
  supplies: [
    { id: 'crane', label: 'Crane', cost: '800.00' },
    { id: 'lift', label: 'Lift', cost: '' },
    { id: 'hardware', label: 'Hardware', cost: '1,500.00' },
    { id: 'lumber', label: 'Lumber', cost: '' },
    { id: 'dump', label: 'Dump', cost: '800.00' },
    { id: 'gas', label: 'Gas', cost: '250.00' },
    { id: 'insurance', label: 'Insurance', cost: '600.00' },
    { id: 'misc', label: 'Misc.', cost: '500.00' }
  ]
});

const fc = Rules.crewCalc(framing.uw, 15);
eq('framing quote', fc.quote, 12507.00);
eq('framing perDay', fc.perDay, 940.00);
eq('framing laborA', fc.laborA, 4700.00);
eq('framing laborB', fc.laborB, 6580.00);
eq('framing supplies', fc.supplies, 4450.00);
eq('framing costA', fc.costA, 9150.00);
eq('framing costB', fc.costB, 11030.00);
eq('framing profitA', fc.profitA, 3357.00);
eq('framing profitB', fc.profitB, 1477.00);
eq('framing marginA', Math.round(fc.marginA * 1000) / 10, 26.8);
eq('framing marginB', Math.round(fc.marginB * 1000) / 10, 11.8);

/* ----- Roofing: Samira Cole (T-1005) ----- */
const roofing = makeTicket('roofing', {
  estimator: 'Tessa Nguyen', name: 'Samira Cole', phone: '480-555-0176',
  email: 'samira.cole@example.com', street: '640 E Mockup Dr', city: 'Scottsdale', zip: '85254',
  jobs: { shingle: true },
  ans: {
    tearoff: { a: 'yes', opts: {}, other: '' },
    plywood: { a: 'yes', opts: {}, other: '' },
    fascia: { a: 'yes', opts: {}, other: '' },
    solar: { a: 'na', opts: {}, other: '' },
    haul: { a: 'yes', opts: {}, other: '' }
  }
}, {
  sell: [
    { id: 'pShingle', label: 'Whole Roof Shingle Replacement (underlayment, drip edge)', unit: 'SQ', price: '580.00', book: '580.00', qty: '26' },
    { id: 'pTile', label: 'Whole Roof Tile Replacement (underlayment)', unit: 'SQ', price: '', book: '', qty: '' },
    { id: 'pFoam', label: 'Whole Roof Foam Replacement', unit: 'SQ', price: '', book: '', qty: '' },
    { id: 'pMetal', label: 'Whole Roof Metal Replacement', unit: 'SQ', price: '', book: '', qty: '' },
    { id: 'pSeam', label: 'Whole Roof Standing Seam Replacement', unit: 'SQ', price: '', book: '', qty: '' },
    { id: 'pPlywood', label: 'Whole Roof Plywood Replacement', unit: 'sheet', price: '60.00', book: '60.00', qty: '' },
    { id: 'pSolar', label: 'Solar Panels un-install & re-install', unit: '', price: '200.00', book: '200.00', qty: '' }
  ],
  labor: [
    { id: 'lShingle', label: 'Shingle install labor', unit: 'SQ', price: '90.00', book: '90.00', qty: '27' },
    { id: 'lTile', label: 'Tile install labor', unit: 'SQ', price: '110.00', book: '110.00', qty: '' },
    { id: 'lFoam', label: 'Foam install labor', unit: 'SQ', price: '', book: '', qty: '' },
    { id: 'lMetal', label: 'Metal install labor', unit: 'SQ', price: '', book: '', qty: '' },
    { id: 'lSeam', label: 'Standing seam install labor', unit: 'SQ', price: '', book: '', qty: '' },
    { id: 'lFascia', label: 'Fascia', unit: '', price: '100.00', book: '100.00', qty: '1' },
    { id: 'lPlywood', label: 'Plywood labor', unit: 'sheet', price: '50.00', book: '50.00', qty: '10' },
    { id: 'lSolar', label: 'Solar panels un-install & re-install', unit: '', price: '200.00', book: '200.00', qty: '' },
    { id: 'lDump', label: 'Dump & gas', unit: '', price: '500.00', book: '500.00', qty: '1' }
  ],
  mats: [
    { id: 'mShingles', label: 'GAF Timberline HDZ shingles, per SQ (3 bundles)', price: '139.00', book: '139.00', qty: '30' },
    { id: 'mRidge', label: 'GAF ridge cap, per 33 ft', price: '86.25', book: '86.25', qty: '4' },
    { id: 'mStarter', label: 'GAF starter strip (120 LF), per bundle', price: '84.85', book: '84.85', qty: '3' },
    { id: 'mValley', label: 'Valley metal', price: '40.00', book: '40.00', qty: '' },
    { id: 'mUnderlay', label: 'SecureGrip 30 underlayment', price: '90.00', book: '90.00', qty: '3' },
    { id: 'mSeam', label: 'Standing seam', price: '400.00', book: '400.00', qty: '' },
    { id: 'mMetalUnder', label: 'Metal underlayment', price: '125.00', book: '125.00', qty: '' },
    { id: 'mUnderNails', label: 'Underlayment nails', price: '24.60', book: '24.60', qty: '2' },
    { id: 'mCoilNails', label: 'Shingle coil nails 1-1/4', price: '55.80', book: '55.80', qty: '3' },
    { id: 'mStaples', label: 'Staples for overhang, 1 in crown, 1 in long', price: '41.50', book: '41.50', qty: '1' },
    { id: 'mBaseBlack', label: 'Base sheet (2 SQ), black', price: '130.00', book: '130.00', qty: '1' },
    { id: 'mCapA', label: 'Cap sheet, 1 SQ', price: '130.00', book: '130.00', qty: '' },
    { id: 'mFlashing', label: 'Flashings', price: '30.00', book: '30.00', qty: '' },
    { id: 'mDrip', label: 'Drip edge, 10 ft', price: '8.00', book: '8.00', qty: '23' },
    { id: 'mCement', label: 'Plastic black roof cement, 5 gal', price: '74.00', book: '74.00', qty: '1' },
    { id: 'mPipe', label: 'Pipe jacks', price: '20.39', book: '20.00', qty: '2' },
    { id: 'mBase', label: 'Base sheet (2 SQ)', price: '140.00', book: '140.00', qty: '' },
    { id: 'mCapB', label: 'Cap sheet, 1 SQ', price: '140.00', book: '140.00', qty: '' },
    { id: 'mCdx', label: 'CDX', price: '60.00', book: '60.00', qty: '' },
    { id: 'mMisc', label: 'Misc', price: '500.00', book: '500.00', qty: '1.5' }
  ],
  meas: { rows: [{ id: 'p1', pitch: '5', sqft: '2,401' }], perimeter: '230', ridge: '120', valley: '' },
  tax: 8.5, commission: 10, schedule: [50, 30, 20]
});

const rc = Rules.roofCalc(roofing.uw, 15);
eq('roofing quote', rc.quote, 15080.00);
eq('roofing labor', rc.labor, 3530.00);
eq('roofing matSub', rc.matSub, 6476.43);
eq('roofing matTax', rc.matTax, 550.50);
eq('roofing matTotal', rc.matTotal, 7026.93);
eq('roofing hard', rc.hard, 10556.93);
eq('roofing gross', rc.gross, 4523.07);
eq('roofing commission', rc.commission, 1508.00);
eq('roofing net', rc.net, 3015.07);
eq('roofing squares', rc.squares, 27);
eq('roofing costPerSq', rc.costPerSq, 391.00);
eq('roofing quotePerSq', rc.quotePerSq, 580.00);
eq('roofing grossM', rc.grossM * 100, 29.99);
eq('roofing netM', rc.netM * 100, 19.99);
eq('roofing hardPct', (rc.hard / rc.quote) * 100, 70.01);

// Payment schedule
eq('roofing pay1', rc.schedule[0].amount, 7540.00);
eq('roofing pay2', rc.schedule[1].amount, 4524.00);
eq('roofing pay3', rc.schedule[2].amount, 3016.00);

// Measurements
const mc = Rules.measCalc(roofing.uw.meas);
eq('roofing meas area', mc.area, 2600.28);
eq('roofing meas squares', mc.squares, 26.00);

/* ----- Other checks from §10 ----- */

// Pitch helper
eq('pitch 5/12', Rules.pitchFactor(5), 1.083);
eq('pitch 10/12', Rules.pitchFactor(10), 1.302);
eq('pitch 12/12', Rules.pitchFactor(12), 1.414);

// Half-cent rounding: 6255.00 at 8.5% = 531.68
eq('half-cent rounding', Rules.round2(6255.00 * 0.085), 531.68);

// Payment remainder: 580.01 at 50/50
const remUw = { sell: [{ id: 'x', label: 'x', unit: '', price: '580.01', book: '580.01', qty: '1' }], labor: [], mats: [], tax: 0, commission: 0, schedule: [50, 50] };
const remCalc = Rules.roofCalc(remUw, 0);
eq('remainder pay1', remCalc.schedule[0].amount, 290.01);
eq('remainder pay2', remCalc.schedule[1].amount, 290.00);

// Payment remainder: 580.01 at 50/30/20
const remUw2 = Object.assign({}, remUw, { schedule: [50, 30, 20] });
const remCalc2 = Rules.roofCalc(remUw2, 0);
eq('remainder 3pay1', remCalc2.schedule[0].amount, 290.01);
eq('remainder 3 pay2', remCalc2.schedule[1].amount, 174.00);
eq('remainder 3 pay3', remCalc2.schedule[2].amount, 116.00);

// New crew template: 2000 SQFT × $4.50
const crewUw = { mode: 'sqft', sqft: '2000', rate: '4.50', lump: '', crews: [{ id: 'c1', count: '3', rate: '200.00', dA: '4', dB: '6' }], supplies: [{ id: 's1', label: 'Supplies', cost: '2100.00' }] };
const crewCalc = Rules.crewCalc(crewUw, 15);
eq('new crew quote', crewCalc.quote, 9000.00);
eq('new crew laborA', crewCalc.laborA, 2400.00);
eq('new crew laborB', crewCalc.laborB, 3600.00);
eq('new crew profitA', crewCalc.profitA, 4500.00);
eq('new crew marginA', crewCalc.marginA * 100, 50.0);
eq('new crew profitB', crewCalc.profitB, 3300.00);
eq('new crew marginB', Math.round(crewCalc.marginB * 1000) / 10, 36.7);

// New piece-rate template: 180 LF × $12.00
const prUw = {
  sell: [{ id: 'p1', label: 'Line', unit: 'LF', price: '12.00', book: '12.00', qty: '180' }],
  labor: [{ id: 'l1', label: 'Labor', unit: 'LF', price: '3.50', book: '3.50', qty: '180' }],
  mats: [], tax: 0, commission: 10, schedule: [50, 30, 20]
};
const prCalc = Rules.roofCalc(prUw, 15);
eq('new pr quote', prCalc.quote, 2160.00);
eq('new pr labor', prCalc.labor, 630.00);
eq('new pr commission', prCalc.commission, 216.00);
eq('new pr net', prCalc.net, 1314.00);
eq('new pr netM', prCalc.netM * 100, 60.83);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
