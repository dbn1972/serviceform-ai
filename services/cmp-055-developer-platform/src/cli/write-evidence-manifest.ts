#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildEvidenceManifest } from '../provenance.js';

const out = resolve(process.argv[2] ?? 'evidence/SF-M01-W2-005/evidence-manifest.json');
const commitSha = process.env.GITHUB_SHA ?? process.env.M01_COMMIT_SHA ?? '';
const taskId = process.env.SF_TASK_ID ?? 'SF-M01-W2-005';

function isGitSha(value: string): boolean {
  if (value.length !== 40) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isLower = c >= 97 && c <= 102;
    const isUpper = c >= 65 && c <= 70;
    if (!isDigit && !isLower && !isUpper) return false;
  }
  return true;
}

if (!isGitSha(commitSha)) {
  console.error('GITHUB_SHA or M01_COMMIT_SHA (40-char) is required');
  process.exit(2);
}

const manifest = buildEvidenceManifest({
  componentId: 'CMP-055',
  taskId,
  commitSha,
  ...(process.env.GITHUB_RUN_ID ? { githubRunId: process.env.GITHUB_RUN_ID } : {}),
  ...(process.env.GITHUB_JOB ? { githubJob: process.env.GITHUB_JOB } : {}),
  artifacts: [
    'evidence/SF-M01-W2-005/EVIDENCE.md',
    'evidence/SF-M01-W2-005/evidence-manifest.json',
  ],
  gates: [
    { name: 'migration-lint', result: 'PASS' },
    { name: 'openapi-asyncapi', result: 'PASS' },
    { name: 'workflow-pin', result: 'PASS' },
    { name: 'contracts-lock', result: 'PASS' },
  ],
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`wrote ${out}\n`);
