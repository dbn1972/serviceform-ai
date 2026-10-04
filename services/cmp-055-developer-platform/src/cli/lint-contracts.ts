#!/usr/bin/env node
import { resolve } from 'node:path';
import { lintComponentContracts } from '../openapi-pipeline.js';

const root = resolve(process.argv[2] ?? process.cwd());
const result = lintComponentContracts(root);
for (const f of result.findings) {
  console.error(`ERROR ${f.path}: ${f.message}`);
}
console.log(
  `checked ${result.filesChecked} component contract file(s); ${result.findings.length} finding(s)`,
);
process.exit(result.findings.length > 0 ? 1 : 0);
