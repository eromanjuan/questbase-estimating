const fs = require('fs');
const src = fs.readFileSync('public/app.js', 'utf8');
let depth = 0, line = 1;
let inStr = false, strCh = '', inTpl = false, inLine = false, inBlock = false;
for (let i = 0; i < src.length; i++) {
  const c = src[i];
  if (c === '\n') line++;
  if (inLine) { if (c === '\n') inLine = false; continue; }
  if (inBlock) { if (c === '*' && src[i + 1] === '/') { inBlock = false; i++; } continue; }
  if (inStr) { if (c === '\\') { i++; continue; } if (c === strCh) inStr = false; continue; }
  if (inTpl) { if (c === '\\') { i++; continue; } if (c === '`') inTpl = false; continue; }
  if (c === '/' && src[i + 1] === '/') { inLine = true; continue; }
  if (c === '/' && src[i + 1] === '*') { inBlock = true; i++; continue; }
  if (c === '"' || c === "'" || c === '`') { if (c === '`') inTpl = true; else { inStr = true; strCh = c; } continue; }
  if (c === '{') depth++;
  if (c === '}') { depth--; if (depth < 0) { console.log('Extra } at line', line); process.exit(0); } }
}
console.log('Final depth:', depth, 'at line', line);