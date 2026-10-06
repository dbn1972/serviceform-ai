import fs from 'node:fs';
import { load, parse } from './lockparse.mjs';
const BASE = '/tmp/pnpm-lock.base.yaml', PROBE = '/tmp/probe/pnpm-lock.yaml';
function serialize(doc) {
  let out = doc.head.join('\n') + '\n';
  for (const s of doc.order) {
    out += s + ':\n';
    let first = true;
    for (const b of doc.sections[s].values()) { out += (first && !doc.gap[s] ? '' : '\n') + b.lines.join('\n') + '\n'; first = false; }
    out += '\n';
  }
  return out.replace(/\n+$/, '\n');
}
const baseText = fs.readFileSync(BASE, 'utf8');
const main = parse(baseText);
if (serialize(main) !== baseText) { fs.writeFileSync('/tmp/stitch/rt.yaml', serialize(main)); throw new Error('round-trip mismatch'); }
const probe = load(PROBE);
function insertSorted(map, block) {
  const entries = [...map.entries()];
  let idx = entries.findIndex(([k]) => k > block.key);
  if (idx === -1) idx = entries.length;
  entries.splice(idx, 0, [block.key, block]);
  map.clear(); for (const [k, v] of entries) map.set(k, v);
}
const report = { importersAdded: [], packagesAdded: [], snapshotsAdded: [], keptMain: [] };
const emptyImporters = ['services/cmp-015-application-case', 'services/cmp-017-work-queue-tasks', 'services/cmp-029-sla-escalation'];
for (const k of emptyImporters) { insertSorted(main.sections.importers, { key: k, raw: k, lines: [`  ${k}: {}`] }); report.importersAdded.push(k); }
const imp = probe.sections.importers.get('services/cmp-016-workflow-engine');
insertSorted(main.sections.importers, imp); report.importersAdded.push(imp.key);
for (const s of ['packages', 'snapshots']) {
  for (const [k, b] of probe.sections[s]) {
    const m = main.sections[s].get(k);
    if (m) { if (m.lines.join('\n') !== b.lines.join('\n')) report.keptMain.push(`${s}:${k}`); continue; }
    insertSorted(main.sections[s], b); report[s + 'Added'].push(k);
  }
}
fs.writeFileSync('/workspace/pnpm-lock.yaml', serialize(main));
fs.writeFileSync('/tmp/stitch/merge-report.json', JSON.stringify(report, null, 2));
console.log('importers+', report.importersAdded.length, 'packages+', report.packagesAdded.length, 'snapshots+', report.snapshotsAdded.length, 'keptMain', report.keptMain);
