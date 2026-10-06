import { load, nameOf, verOf } from './lockparse.mjs';
const main = load('/tmp/pnpm-lock.base.yaml'), probe = load('/tmp/probe/pnpm-lock.yaml');
for (const sec of ['packages', 'snapshots']) {
  let same = 0, diff = [], add = [];
  for (const [k, b] of probe.sections[sec]) {
    const m = main.sections[sec].get(k);
    if (m) { if (m.lines.join('\n') === b.lines.join('\n')) same++; else diff.push(k); } else add.push(k);
  }
  console.log(sec, 'probe', probe.sections[sec].size, 'identical-in-main', same, 'conflict', diff.length, 'new', add.length);
  if (diff.length) console.log(' CONFLICT', diff);
  if (sec === 'packages') {
    const mainNames = new Map();
    for (const k of main.sections.packages.keys()) { const n = nameOf(k); (mainNames.get(n) || mainNames.set(n, []).get(n)).push(verOf(k)); }
    for (const k of add) { const n = nameOf(k); if (mainNames.has(n)) console.log(' new-version-of-existing', k, 'main has', mainNames.get(n).join(',')); }
  }
}
console.log('importer', [...probe.sections.importers.keys()]);
