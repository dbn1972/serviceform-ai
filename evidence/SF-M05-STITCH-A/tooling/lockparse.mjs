import fs from 'node:fs';
export function parse(text) {
  const lines = text.split('\n');
  const out = { head: [], sections: {}, order: [] };
  let sec = null, block = null;
  for (const line of lines) {
    if (/^[a-zA-Z]/.test(line)) {
      const m = line.match(/^(importers|packages|snapshots):\s*$/);
      if (m) { sec = m[1]; out.sections[sec] = new Map(); out.order.push(sec); out.gap = out.gap || {}; out.gap[sec] = null; block = null; continue; }
      if (sec) throw new Error('unexpected top-level after sections: ' + line);
      out.head.push(line); continue;
    }
    if (!sec) { out.head.push(line); continue; }
    if (out.gap[sec] === null) out.gap[sec] = line === '';
    if (line === '') { block = null; continue; }
    const km = line.match(/^  (\S.*?):(?: (.*))?$/);
    if (km && !line.startsWith('   ')) {
      let key = km[1]; const raw = key;
      if (/^'.*'$/.test(key)) key = key.slice(1, -1).replace(/''/g, "'");
      block = { key, raw, lines: [line] }; out.sections[sec].set(key, block); continue;
    }
    if (!block) throw new Error('orphan line: ' + line);
    block.lines.push(line);
  }
  return out;
}
export function load(p) { return parse(fs.readFileSync(p, 'utf8')); }
export function nameOf(key) { const i = key.lastIndexOf('@', key.indexOf('(') === -1 ? undefined : key.indexOf('(')); return key.slice(0, i > 0 ? i : key.length); }
export function verOf(key) { const base = key.split('(')[0]; return base.slice(base.lastIndexOf('@') + 1); }
