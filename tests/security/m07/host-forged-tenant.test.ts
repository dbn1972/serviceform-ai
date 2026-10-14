import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../../packages/contracts/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import {
  ALL_ROUTES,
  CANARY,
  capturingLogger,
  FORGED_HEADER_SETS,
  hostConfig,
  probedMounts,
  totalHits,
} from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M07-SEC host edge: forged tenant/identity headers fail closed (SF-TEN-002)', () => {
  it('refuses every forged header spelling on all 17 M07 routes before any component runs', async () => {
    const logs: string[] = [];
    const { mounts, probes } = probedMounts();
    app = await buildApp(hostConfig, { logger: capturingLogger(logs), m07: mounts });
    expect(app.m07Mounted).toEqual(['CMP-022', 'CMP-024', 'CMP-023', 'CMP-012']);

    let leakage = 0;
    let checked = 0;
    for (const route of ALL_ROUTES) {
      for (const headers of FORGED_HEADER_SETS) {
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers: { ...headers, 'idempotency-key': 'sec-probe-01' },
          ...(route.method === 'POST' ? { payload: {} } : {}),
        });
        checked += 1;
        const label = `${route.cmp} ${route.method} ${route.url} ${Object.keys(headers)[0]}`;
        expect(res.statusCode, label).toBe(403);
        expect(validate('error-response', res.json()).valid, label).toBe(true);
        expect(res.json(), label).toMatchObject({ error_code: 'SF-TEN-002' });
        if (res.body.includes(CANARY)) leakage += 1;
      }
    }
    expect(checked).toBe(ALL_ROUTES.length * FORGED_HEADER_SETS.length);
    expect(totalHits(probes)).toBe(0);
    expect(leakage).toBe(0);
    expect(logs.join('\n')).not.toContain(CANARY);
  });

  it('FINDING M07-SEC-F03: x-bypass-rls passes the host edge for CMP-022/023/024 but is inert', async () => {
    const logs: string[] = [];
    const { mounts, probes } = probedMounts(() => Promise.resolve(null));
    app = await buildApp(hostConfig, { logger: capturingLogger(logs), m07: mounts });
    const outcomes: Record<string, number> = {};
    for (const route of ALL_ROUTES.filter((r) => r.method === 'GET')) {
      const res = await app.inject({
        method: 'GET',
        url: route.url,
        headers: { 'x-bypass-rls': 'true' },
      });
      outcomes[route.cmp] = res.statusCode;
      // With no server context the header grants nothing: every route still fails closed.
      expect([401, 403], route.url).toContain(res.statusCode);
    }
    expect(totalHits(probes)).toBe(0);
    // CMP-012 refuses the header by name (403 SF-TEN-002); the others ignore it and fail on context.
    expect(outcomes['CMP-012']).toBe(403);
  });

  it('missing server-derived context fails closed on every route without reaching services', async () => {
    const { mounts, probes } = probedMounts(() => Promise.resolve(null));
    app = await buildApp(hostConfig, { logger: capturingLogger([]), m07: mounts });
    for (const route of ALL_ROUTES) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { 'idempotency-key': 'sec-probe-01' },
        ...(route.method === 'POST' ? { payload: {} } : {}),
      });
      expect([401, 403], `${route.cmp} ${route.url}`).toContain(res.statusCode);
      expect(res.json().error_code).toMatch(/^SF-(AUTH|TEN)-00[12]$/);
    }
    expect(totalHits(probes)).toBe(0);
  });

  it('resolver throwing does not leak internals and does not reach services', async () => {
    const { mounts, probes } = probedMounts(() => Promise.reject(new Error(`boom ${CANARY}`)));
    app = await buildApp(hostConfig, { logger: capturingLogger([]), m07: mounts });
    for (const route of ALL_ROUTES) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { 'idempotency-key': 'sec-probe-01' },
        ...(route.method === 'POST' ? { payload: {} } : {}),
      });
      expect(res.statusCode, route.url).toBeGreaterThanOrEqual(400);
      expect(res.body, route.url).not.toContain(CANARY);
      expect(res.body, route.url).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
    }
    expect(totalHits(probes)).toBe(0);
  });

  it('commands without a valid Idempotency-Key are refused before the service', async () => {
    const { mounts, probes } = probedMounts();
    app = await buildApp(hostConfig, { logger: capturingLogger([]), m07: mounts });
    for (const route of ALL_ROUTES.filter((r) => r.method === 'POST')) {
      for (const key of [undefined, '', 'x', 'k'.repeat(4096)]) {
        const res = await app.inject({
          method: 'POST',
          url: route.url,
          payload: {},
          ...(key === undefined ? {} : { headers: { 'idempotency-key': key } }),
        });
        expect(res.statusCode, `${route.url} key=${String(key?.length)}`).toBe(400);
        expect(res.json()).toMatchObject({ error_code: 'SF-SYS-003' });
      }
    }
    expect(totalHits(probes)).toBe(0);
  });
});
