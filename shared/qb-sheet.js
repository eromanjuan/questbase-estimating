/* ======================================================================
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

  const LOGO = 'data:image/jpeg;base64,${logoB64}';
  const LOGO_RATIO = 381 / 738;
  const COMPANY = {
    name: 'QUEST ROOFING',
    addr1: '24871 S Ellsworth Rd 100-130,',
    addr2: 'Queen Creek, AZ 85142',
    phone: 'P:602-399-6455',
    email: 'E:info@questroofing.com',
    roc: 'ROC# 355136'
  };

  /* ---------- 5. Sheet: the proposal page ----------
     One layout pass produces drawing steps (rect / text / image) in points. The same
     steps are drawn as SVG for the on-screen sheet and as a PDF, so the two always match.
     Geometry is measured off the existing Quest Roofing proposal (a 1280 px wide render)
     and mapped onto an 8.5 in wide page. */

  const S = 0.4702;
  const PX = px => 18 + (px - 88) * S;
  const PY = py => (py - 6) * S;
  const PAGE_W = 612, LETTER_H = 792;
  const LEFT = PX(88), RIGHT = PX(1313);
  const TXT_L = PX(94.5), TXT_R = PX(1306);
  const COL2 = PX(699), COL3 = PX(1079);
  const INK = '#000000', BLUE = '#0470f7', BAND = '#bdbdbd', STRIPE = '#f3f3f3', WHITE = '#ffffff';
  const MIN_ROWS = 10;

  function layout(m, measure, limit) {
    const pages = [];
    let ops, y, stripe = 0;
    const bottom = limit - 30;

    const start = () => { ops = []; pages.push(ops); };
    const rect = (x, yy, w, hh, fill) => ops.push({ k: 'rect', x, y: yy, w, h: hh, fill });
    const text = (s, x, yy, size, bold, align, fill) => {
      if (s) ops.push({ k: 'text', str: s, x, y: yy, size, bold: !!bold, align: align || 'left', fill: fill || INK });
    };
    const shrink = (s, size, bold, maxW, min) => {
      let z = size;
      while (z > min && measure(s, z, bold) > maxW) z -= 0.2;
      return z;
    };
    const breakLong = (line, size, bold, maxW) => {
      if (measure(line, size, bold) <= maxW) return [line];
      const parts = [];
      let cur = '';
      for (const ch of line) {
        if (cur && measure(cur + ch, size, bold) > maxW) { parts.push(cur); cur = ch; } else cur += ch;
      }
      if (cur) parts.push(cur);
      return parts;
    };
    const wrap = (s, size, bold, maxW) => {
      const out = [];
      let line = '';
      for (const w of String(s).split(' ')) {
        const t = line ? line + ' ' + w : w;
        if (!line || measure(t, size, bold) <= maxW) line = t; else { out.push(line); line = w; }
      }
      if (line) out.push(line);
      return out.flatMap(l => breakLong(l, size, bold, maxW));
    };

    const head = () => {
      rect(LEFT, y, RIGHT - LEFT, 49 * S, BLUE);
      const b = y + 30 * S, z = 22.2 * S;
      text('Product / Service', (LEFT + COL2) / 2, b, z, true, 'center', WHITE);
      text('Description', (COL2 + COL3) / 2, b, z, true, 'center', WHITE);
      text('Total', (COL3 + RIGHT) / 2, b, z, true, 'center', WHITE);
      y += 49 * S;
    };
    const room = hh => { if (y + hh > bottom) { start(); y = 30; head(); stripe = 0; } };
    const band = (label, amount) => {
      const hh = 41 * S, z = 20.5 * S;
      room(hh + 41.65 * S);
      rect(LEFT, y, RIGHT - LEFT, hh, BAND);
      const maxW = RIGHT - LEFT - 14 - (amount ? measure(amount, z, true) + 18 : 0);
      text(label, TXT_L, y + 27 * S, shrink(label, z, true, maxW, 7), true);
      if (amount) text(amount, TXT_R, y + 27 * S, z, true, 'right');
      y += hh; stripe = 0;
    };
    // A line item: service, an optional description, and an optional amount of its own.
    const row = item => {
      const z = 21 * S, zd = 19.5 * S, lh = 25 * S, base = 41.65 * S;
      const hasDesc = !!(item && item.desc), amount = item && item.amount;
      const edge = hasDesc ? COL2 : COL3;
      const sv = item ? wrap(item.service, z, false, edge - TXT_L - 8) : [];
      const ds = hasDesc ? wrap(item.desc, zd, false, COL3 - COL2 - 12) : [];
      const n = Math.max(1, sv.length, ds.length);
      const hh = base + (n - 1) * lh;
      if (!item && y + hh > bottom) return false;
      room(hh);
      if (stripe % 2) rect(LEFT, y, RIGHT - LEFT, hh, STRIPE);
      sv.forEach((l, i) => text(l, TXT_L, y + 27 * S + i * lh, z));
      ds.forEach((l, i) => text(l, COL2 + 6, y + 27 * S + i * lh, zd));
      if (amount) text(amount, TXT_R, y + 27 * S, shrink(amount, z, false, RIGHT - COL3 - 10, 7), false, 'right');
      y += hh; stripe++;
      return true;
    };

    start();

    // letterhead
    const logoW = 246 * S;
    ops.push({ k: 'image', x: PX(116), y: PY(73), w: logoW, h: logoW * LOGO_RATIO });
    const cx = PX(427);
    text(COMPANY.name, cx, PY(102), 24.7 * S, true);
    text(COMPANY.addr1, cx, PY(139.5), 18.6 * S);
    text(COMPANY.addr2, cx, PY(161.5), 18.6 * S);
    text(COMPANY.phone, cx, PY(189), 22.6 * S, true);
    text(COMPANY.email, cx, PY(217), 20.6 * S, true);
    text(COMPANY.roc, TXT_R, PY(156), 47.5 * S, true, 'right');
    rect(LEFT, PY(228.5), RIGHT - LEFT, 6 * S, INK);

    // client
    const bz = 20.6 * S, boxL = PX(976), boxW = RIGHT - boxL;
    const clientW = boxL - TXT_L - 16;
    y = PY(278);
    for (const l of wrap('CLIENT: ' + upperLatin(m.client.name), bz, true, clientW)) { text(l, TXT_L, y, bz, true); y += 27 * S; }
    y += 4 * S;
    for (const v of [m.client.phone, m.client.email]) {
      if (v) { text(v, TXT_L, y, shrink(v, bz, false, clientW, 6)); y += 31 * S; }
    }
    if (m.client.address) {
      y += 4 * S;
      for (const l of wrap(m.client.address, bz, false, clientW)) { text(l, TXT_L, y, bz); y += 27 * S; }
    }

    // issued / total box
    rect(boxL, PY(252), boxW, 31 * S, BLUE);
    if (m.proposalNo) {
      const pn = 'Proposal # ' + m.proposalNo;
      text(pn, PX(984), PY(274.5), shrink(pn, 20.5 * S, true, boxW - 10, 6), true, 'left', WHITE);
    }
    text('Issued', PX(983), PY(309), bz);
    text(m.issued, TXT_R, PY(309), bz, false, 'right');
    rect(boxL, PY(314), boxW, 32 * S, BLUE);
    const tz = 23.5 * S;
    text('Total', PX(984), PY(337.5), tz, true, 'left', WHITE);
    text(m.totalText, TXT_R, PY(337.5), shrink(m.totalText, tz, true, boxW - measure('Total', tz, true) - 22, 6), true, 'right', WHITE);

    // heading + table
    y = Math.max(PY(441), y + 39 * S);
    text(m.heading, TXT_L, y, shrink(m.heading, 25.5 * S, true, RIGHT - TXT_L - 6, 8), true);
    y += 6 * S;
    head();
    band(m.includes, m.totalText);
    m.included.forEach(row);
    if (m.excluded.length) {
      if (!m.included.length) row(null);
      band(m.excludes, '');
      m.excluded.forEach(row);
    }
    const used = m.included.length + (m.excluded.length ? m.excluded.length + (m.included.length ? 1 : 2) : 0);
    for (let i = Math.max(1, MIN_ROWS - used); i > 0; i--) { if (!row(null)) break; }

    // closing bar + footer
    const fz = 20.4 * S, gz = 27.8 * S;
    const foot = m.footer ? wrap(m.footer, fz, true, PX(983) - TXT_L - 14) : [];
    const extra = Math.max(0, foot.length - 1) * 25 * S;
    room(42 * S + 30 * S + extra + 10);
    rect(LEFT, y, RIGHT - LEFT, 42 * S, BLUE);
    y += 42 * S;
    foot.forEach((l, j) => text(l, TXT_L, y + 30 * S + j * 25 * S, fz, true));
    text('Total', PX(983), y + 27 * S, gz, true);
    text(m.totalText, TXT_R, y + 27 * S, shrink(m.totalText, gz, true, TXT_R - PX(983) - measure('Total', gz, true) - 12, 7), true, 'right');
    return { pages, height: y + 30 * S + extra + 71.5 * S };
  }

  // One page sized to its content, the way the current proposal comes out. A scope
  // too long for a Letter page flows onto Letter pages instead.
  function compose(m) {
    let L = layout(m, measure, Infinity);
    if (L.height <= LETTER_H) return { pages: L.pages, w: PAGE_W, h: Math.ceil(L.height) };
    L = layout(m, measure, LETTER_H);
    return { pages: L.pages, w: PAGE_W, h: LETTER_H };
  }

  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function buildDoc(m) {
    const doc = compose(m);
    const orient = doc.w > doc.h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ unit: 'pt', format: [doc.w, doc.h], orientation: orient, compress: true });
    doc.pages.forEach((ops, i) => {
      if (i) pdf.addPage([doc.w, doc.h], orient);
      for (const op of ops) {
        if (op.k === 'rect') {
          pdf.setFillColor(...rgb(op.fill));
          pdf.rect(op.x, op.y, op.w, op.h, 'F');
        } else if (op.k === 'text') {
          pdf.setFont('helvetica', op.bold ? 'bold' : 'normal');
          pdf.setFontSize(op.size);
          pdf.setTextColor(...rgb(op.fill));
          pdf.text(op.str, op.x, op.y, { align: op.align });
        } else if (op.k === 'image') {
          pdf.addImage(LOGO, 'JPEG', op.x, op.y, op.w, op.h);
        }
      }
    });
    pdf.setProperties({ title: `Proposal - ${m.client.name || 'Client'} - ${m.heading}`, subject: m.heading, author: 'Quest Roofing', creator: 'Quest Base Estimating' });
    return pdf;
  }
  const fileName = m => `Quest Roofing Proposal - ${(m.client.name || 'Client').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()} - ${m.issued}.pdf`;

  return { LOGO, LOGO_RATIO, COMPANY, PAGE_W, LETTER_H, compose, measure, buildDoc, fileName };
})
