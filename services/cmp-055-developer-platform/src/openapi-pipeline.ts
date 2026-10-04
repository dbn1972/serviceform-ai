/**
 * Component-local OpenAPI/AsyncAPI lint helpers (Eng v1.4 CMP-055).
 * Never reads or writes contracts/shared — frozen shared set stays guardian-owned.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type ContractLintFinding = { path: string; message: string };

export type ContractLintResult = {
  filesChecked: number;
  findings: ContractLintFinding[];
};

const OPENAPI_NAMES = new Set(['openapi.json', 'openapi.yaml', 'openapi.yml']);
const ASYNCAPI_NAMES = new Set(['asyncapi.json', 'asyncapi.yaml', 'asyncapi.yml']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Prefer JSON.parse; many repo "*.yaml" OpenAPI files are JSON-shaped. */
export function parseContractDocument(text: string, path: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${path}: empty document`);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown;
  }
  // Minimal YAML subset for AsyncAPI/OpenAPI headers used in this repo.
  // Full YAML lint runs in scripts/gates/openapi_asyncapi_gate.py (PyYAML).
  const doc: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentMap: Record<string, unknown> | null = null;
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (top && !line.startsWith(' ')) {
      const key = top[1];
      if (!key) continue;
      currentKey = key;
      currentMap = null;
      const value = (top[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
      if (value === '' || value === '|' || value === '>') {
        currentMap = {};
        doc[key] = currentMap;
      } else {
        doc[key] = value;
      }
      continue;
    }
    if (currentMap && currentKey) {
      const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (nested) {
        const k = nested[1];
        if (!k) continue;
        const v = (nested[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
        currentMap[k] = v === '' ? {} : v;
      }
    }
  }
  return doc;
}

export function lintOpenApiDocument(doc: unknown, path: string): ContractLintFinding[] {
  const out: ContractLintFinding[] = [];
  if (!isRecord(doc)) {
    out.push({ path, message: 'OpenAPI root must be an object' });
    return out;
  }
  const version = doc.openapi;
  if (typeof version !== 'string' || !version.startsWith('3.')) {
    out.push({ path, message: 'openapi must be a 3.x version string' });
  }
  if (
    !isRecord(doc.info) ||
    typeof doc.info.title !== 'string' ||
    typeof doc.info.version !== 'string'
  ) {
    out.push({ path, message: 'info.title and info.version are required' });
  }
  if (!isRecord(doc.paths) || Object.keys(doc.paths).length === 0) {
    out.push({ path, message: 'paths must be a non-empty object' });
  }
  return out;
}

export function lintAsyncApiDocument(doc: unknown, path: string): ContractLintFinding[] {
  const out: ContractLintFinding[] = [];
  if (!isRecord(doc)) {
    out.push({ path, message: 'AsyncAPI root must be an object' });
    return out;
  }
  const version = doc.asyncapi;
  if (typeof version !== 'string' || !(version.startsWith('2.') || version.startsWith('3.'))) {
    out.push({ path, message: 'asyncapi must be a 2.x or 3.x version string' });
  }
  if (
    !isRecord(doc.info) ||
    typeof doc.info.title !== 'string' ||
    typeof doc.info.version !== 'string'
  ) {
    out.push({ path, message: 'info.title and info.version are required' });
  }
  const channels = doc.channels;
  const operations = doc.operations;
  const hasChannels = isRecord(channels) && Object.keys(channels).length > 0;
  const hasOperations = isRecord(operations) && Object.keys(operations).length > 0;
  if (!hasChannels && !hasOperations) {
    out.push({ path, message: 'channels or operations must be a non-empty object' });
  }
  return out;
}

export function discoverComponentContractFiles(repoRoot: string): string[] {
  const servicesRoot = join(repoRoot, 'services');
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(servicesRoot);
  } catch {
    return found;
  }
  for (const name of entries) {
    const contractsDir = join(servicesRoot, name, 'contracts');
    let st;
    try {
      st = statSync(contractsDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const file of readdirSync(contractsDir)) {
      if (OPENAPI_NAMES.has(file) || ASYNCAPI_NAMES.has(file)) {
        found.push(join(contractsDir, file));
      }
    }
  }
  return found.sort();
}

export function lintComponentContracts(repoRoot: string): ContractLintResult {
  const findings: ContractLintFinding[] = [];
  const files = discoverComponentContractFiles(repoRoot);
  for (const abs of files) {
    const rel = relative(repoRoot, abs).split('\\').join('/');
    if (rel.startsWith('contracts/shared/')) {
      findings.push({
        path: rel,
        message: 'refusing frozen shared contract path (CMP-055 does not mutate contracts/shared)',
      });
      continue;
    }
    const base = abs.split('/').pop() ?? abs;
    let doc: unknown;
    try {
      doc = parseContractDocument(readFileSync(abs, 'utf8'), rel);
    } catch (err) {
      findings.push({ path: rel, message: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (OPENAPI_NAMES.has(base)) findings.push(...lintOpenApiDocument(doc, rel));
    if (ASYNCAPI_NAMES.has(base)) findings.push(...lintAsyncApiDocument(doc, rel));
  }
  return { filesChecked: files.length, findings };
}
