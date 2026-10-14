import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { buildQrVerificationService } from '../../src/index.js';
import type { TenantContext } from '../../src/types.js';
import {
  ctxFor,
  issueBody,
  MutableClock,
  publicVerifierCtx,
  ScriptedAuthorizer,
  TENANT_A,
} from '../doubles/fixtures.js';
import { MemoryQrRepository } from '../doubles/memory-repo.js';
import { FakeCredentials, FakeRegistry, TxProbe } from '../doubles/ports.js';

/**
 * M07-SEC-F05 regression: the QR opaque bearer token in `GET /v1/qr/verify/:opaque_token`
 * must never reach host logs. Drives the real CMP-023 service through the API host with
 * the production logger (CMP-047 sanitisation + pino redaction).
 */

interface InjectResponse {
  statusCode: number;
  json(): unknown;
}
interface HostApp {
  inject(o: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<InjectResponse>;
  close(): Promise<void>;
}
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Non-literal specifiers keep the host graph out of this component's TypeScript program.
const hostSrc = (p: string): string =>
  new URL(`../../../../apps/api/src/${p}`, import.meta.url).href;
const obsSrc = new URL('../../../../packages/observability/src/index.ts', import.meta.url).href;

async function host(state: { ctx: TenantContext }, lines: string[]): Promise<HostApp> {
  const { buildApp } = (await import(hostSrc('app.ts'))) as {
    buildApp(c: unknown, d: unknown): Promise<HostApp>;
  };
  const { loadConfig } = (await import(hostSrc('config.ts'))) as {
    loadConfig(e: Record<string, string>): unknown;
  };
  const { createLogger } = (await import(obsSrc)) as {
    createLogger(c: object): unknown;
  };
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const repository = new MemoryQrRepository();
  const probe = new TxProbe();
  probe.repo = repository;
  const service = buildQrVerificationService({
    repository,
    authorizer: new ScriptedAuthorizer(),
    registry: new FakeRegistry(probe),
    credentials: new FakeCredentials(probe),
    clock: new MutableClock(Date.parse('2026-10-14T10:00:00Z')).now,
  });
  return buildApp(
    loadConfig({
      SF_ENVIRONMENT: 'CI',
      SF_SERVICE_VERSION: '0.0.0-test',
      LOG_LEVEL: 'info',
      SF_GATEWAY_RATE_LIMIT_MAX: '1000',
    }),
    {
      logger: createLogger({ service: 'api-test', version: 'test', level: 'info', destination }),
      m07: { qr: { service, resolveContext: () => Promise.resolve(state.ctx) } },
    },
  );
}

let app: HostApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function issueOpaque(state: { ctx: TenantContext }): Promise<string> {
  const issued = await (app as HostApp).inject({
    method: 'POST',
    url: '/v1/qr/tokens',
    headers: { 'idempotency-key': 'rem-f05-key-000001' },
    payload: issueBody(),
  });
  expect(issued.statusCode).toBe(201);
  state.ctx = publicVerifierCtx(TENANT_A);
  return ((issued.json() as Body)['token'] as Body)['opaque_token'] as string;
}

function urls(lines: string[]): string[] {
  return lines
    .map((l) => JSON.parse(l) as Body)
    .filter((e) => e['req'] && typeof e['req']['url'] === 'string')
    .map((e) => `${e['message'] as string} ${e['req']['url'] as string}`);
}

describe('M07-SEC-F05: QR opaque token never written to host logs', () => {
  it('verify path token is replaced by the route template in incoming and completed lines', async () => {
    const lines: string[] = [];
    const state = { ctx: ctxFor(TENANT_A) };
    app = await host(state, lines);
    const opaque = await issueOpaque(state);

    const verified = await app.inject({ method: 'GET', url: `/v1/qr/verify/${opaque}?probe=1` });
    expect(verified.statusCode).toBe(200);

    expect(lines.join('\n')).not.toContain(opaque);
    expect(lines.join('\n')).not.toContain('probe=1');
    const verifyUrls = urls(lines).filter((u) => u.includes('/v1/qr/verify'));
    expect(verifyUrls).toEqual([
      'incoming request /v1/qr/verify/:opaque_token',
      'request completed /v1/qr/verify/:opaque_token',
    ]);
  });

  it('a rejected token (unknown, malformed or foreign) is redacted the same way', async () => {
    const lines: string[] = [];
    const state = { ctx: ctxFor(TENANT_A) };
    app = await host(state, lines);
    await issueOpaque(state);
    const probes = ['U'.repeat(43), 'not*a*token', 'x'];
    for (const p of probes) {
      const r = await app.inject({ method: 'GET', url: `/v1/qr/verify/${p}` });
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    const text = lines.join('\n');
    for (const p of probes) expect(text).not.toContain(`/v1/qr/verify/${p}`);
    expect(urls(lines).filter((u) => u.includes('/v1/qr/verify'))).toHaveLength(probes.length * 2);
  });

  it('non-bearer routes keep their path in logs (redaction is route-scoped)', async () => {
    const lines: string[] = [];
    const state = { ctx: ctxFor(TENANT_A) };
    app = await host(state, lines);
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/qr/tokens',
      headers: { 'idempotency-key': 'rem-f05-key-000002' },
      payload: issueBody(),
    });
    const tokenId = ((issued.json() as Body)['token'] as Body)['token_id'] as string;
    const read = await app.inject({ method: 'GET', url: `/v1/qr/tokens/${tokenId}` });
    expect(read.statusCode).toBe(200);
    expect(urls(lines)).toContain(`request completed /v1/qr/tokens/${tokenId}`);
    expect(lines.join('\n')).not.toContain('rem-f05-key-000002');
  });
});
