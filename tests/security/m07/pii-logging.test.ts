import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { makeHarness as h023 } from '../../../services/cmp-023-qr-verification/test/doubles/harness.js';
import {
  ctxFor as ctx023,
  issueBody,
  publicVerifierCtx,
  TENANT_A as A023,
} from '../../../services/cmp-023-qr-verification/test/doubles/fixtures.js';
import type { TenantContext } from '../../../services/cmp-023-qr-verification/src/types.js';
import { capturingLogger, hostConfig } from './helpers.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const M07 = [
  'cmp-022-credential-engine',
  'cmp-023-qr-verification',
  'cmp-024-credential-registry',
  'cmp-012-digilocker',
];
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function files(dir: string, ext = /\.(ts|json|sql)$/): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue;
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ext.test(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Synthetic-data guard. UUID segments are excluded by the hex/hyphen look-arounds. */
const PII_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['aadhaar-spaced', /\b[2-9]\d{3}\s\d{4}\s\d{4}\b/],
  ['aadhaar-12', /(?<![0-9a-fA-F-])[2-9]\d{11}(?![0-9a-fA-F])/],
  ['in-mobile', /(?<![0-9a-fA-F-])[6-9]\d{9}(?![0-9a-fA-F])/],
  ['in-mobile-intl', /\+91[-\s]?[6-9]\d{9}\b/],
  ['pan', /\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/],
  [
    'email',
    /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net|test)\b)[A-Za-z0-9-]+\.(?:com|in|org|net|gov\.in|co\.in)\b/,
  ],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['bearer', /Bearer\s+[A-Za-z0-9._-]{20,}/],
];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M07-SEC privacy: no PII/secrets in source, fixtures or logs', () => {
  it('M07 sources and fixtures contain no PII-shaped or secret-shaped literals', () => {
    const hits: string[] = [];
    const roots = [...M07.map((c) => join(ROOT, 'services', c)), join(ROOT, 'tests/security/m07')];
    for (const root of roots) {
      for (const f of files(root)) {
        const text = readFileSync(f, 'utf8');
        for (const [label, re] of PII_PATTERNS) {
          if (f.endsWith('pii-logging.test.ts')) continue;
          const m = re.exec(text);
          if (m) hits.push(`${label} ${relative(ROOT, f)}: ${m[0]}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('M07 component sources never write to console or log request bodies/headers', () => {
    for (const c of M07) {
      for (const f of files(join(ROOT, 'services', c, 'src'), /\.ts$/)) {
        const text = readFileSync(f, 'utf8');
        expect(text, relative(ROOT, f)).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\(/);
        expect(text, relative(ROOT, f)).not.toMatch(
          /\blog(ger)?\.(info|warn|error|debug)\([^)]*(body|headers|consent_ref|opaque_token)/,
        );
      }
    }
  });

  it('QR audit records a one-way token ref, never the opaque bearer token', async () => {
    const h = h023();
    const issued = await h.call('POST', '/v1/qr/tokens', issueBody());
    const opaque = (issued.body as Body)['token']['opaque_token'] as string;
    h.state.ctx = publicVerifierCtx(A023);
    await h.call('GET', `/v1/qr/verify/${opaque}`);
    await h.call('GET', `/v1/qr/verify/${'z'.repeat(43)}`);
    const store = (
      h.repo as unknown as {
        stores: Map<string, { outbox: Array<{ envelope: { event_type?: string } }> }>;
      }
    ).stores.get(A023);
    const audits = (store?.outbox ?? [])
      .map((o) => o.envelope)
      .filter((e) => JSON.stringify(e).includes('AuditEventSubmitted'));
    const verifyAudits = audits.filter((e) => JSON.stringify(e).includes('QR_TOKEN_VERIFY'));
    expect(verifyAudits.length).toBe(2);
    const text = JSON.stringify(audits);
    expect(text).not.toContain(opaque);
    expect(text).not.toContain('z'.repeat(43));
  });

  it('FINDING M07-SEC-F05: host access log records the QR opaque bearer token from the verify path', async () => {
    const h = h023();
    const state: { ctx: TenantContext } = { ctx: ctx023(A023) };
    const logs: string[] = [];
    app = await buildApp(hostConfig, {
      logger: capturingLogger(logs),
      m07: { qr: { service: h.service, resolveContext: () => Promise.resolve(state.ctx) } },
    });
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/qr/tokens',
      headers: { 'idempotency-key': 'sec-pii-01' },
      payload: issueBody(),
    });
    expect(issued.statusCode).toBe(201);
    const opaque = (issued.json() as Body)['token']['opaque_token'] as string;
    state.ctx = publicVerifierCtx(A023);
    const verified = await app.inject({ method: 'GET', url: `/v1/qr/verify/${opaque}?probe=1` });
    expect(verified.statusCode).toBe(200);

    const text = logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    // Bodies, idempotency keys and query strings are kept out of logs.
    expect(text).not.toContain('sec-pii-01');
    expect(text).not.toContain('probe=1');
    expect(text).not.toContain('credtype:tenant-meta');
    // Finding remains until SF-M07-003-REM merges onto the evaluated tip.
    expect(text).toContain(opaque);
  });
});
