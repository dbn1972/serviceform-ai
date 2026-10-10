import { describe, expect, it } from 'vitest';
import { Cmp045Error, mapPgError } from '../../src/errors.js';
import { buildAnalyticsApi } from '../../src/index.js';
import { PgAnalyticsRepository, type SqlClient, type SqlPool } from '../../src/repo/pg.js';
import { AllowAllAuthorizer, CONSUMER_ACTOR, ctxFor, TENANT_A } from '../doubles/fixtures.js';

interface Recorded {
  text: string;
  values: unknown[] | undefined;
}

function fakePool(
  respond: (q: Recorded) => { rows: Record<string, unknown>[]; rowCount: number | null },
) {
  const log: Recorded[] = [];
  let released = 0;
  const client: SqlClient = {
    query: ((text: string, values?: unknown[]) => {
      const rec = { text, values };
      log.push(rec);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text) || text.startsWith('SELECT set_config')) {
        return Promise.resolve({ rows: [], rowCount: null });
      }
      return Promise.resolve(respond(rec));
    }) as SqlClient['query'],
    release: () => {
      released += 1;
    },
  };
  const pool: SqlPool = { connect: () => Promise.resolve(client) };
  return { pool, log, released: () => released };
}

const CTX = ctxFor(TENANT_A) as ReturnType<typeof ctxFor> & { tenant_id: string };

describe('PgAnalyticsRepository transaction discipline', () => {
  it('sets the transaction-local session context before any statement and commits', async () => {
    const { pool, log, released } = fakePool(() => ({ rows: [], rowCount: 0 }));
    const repo = new PgAnalyticsRepository(pool);
    await repo.withTx(CTX, (tx) => tx.getDefinition('11111111-1111-4111-8111-111111111111'));
    const texts = log.map((l) => l.text);
    expect(texts[0]).toBe('BEGIN');
    const settings = log
      .filter((l) => l.text.startsWith('SELECT set_config'))
      .map((l) => l.values?.[0]);
    expect(settings).toEqual([
      'app.tenant_id',
      'app.cell_id',
      'app.actor_type',
      'app.actor_id',
      'app.correlation_id',
    ]);
    expect(log.find((l) => l.text.startsWith('SELECT set_config'))?.text).toContain('true)');
    expect(texts.at(-1)).toBe('COMMIT');
    expect(released()).toBe(1);
  });

  it('rolls back and releases on failure; refuses a null tenant and nested transactions', async () => {
    const { pool, log, released } = fakePool(() => ({ rows: [], rowCount: 0 }));
    const repo = new PgAnalyticsRepository(pool);
    await expect(repo.withTx(CTX, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(log.map((l) => l.text)).toContain('ROLLBACK');
    expect(released()).toBe(1);
    await expect(
      repo.withTx({ ...CTX, tenant_id: null }, () => Promise.resolve(1)),
    ).rejects.toMatchObject({
      code: 'SF-TEN-001',
    });
    await expect(
      repo.withTx(CTX, () => repo.withTx(CTX, () => Promise.resolve(1))),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });

  it('every tenant-table statement binds the transaction tenant, never a caller value', async () => {
    const { pool, log } = fakePool((q) => {
      if (q.text.includes('FROM sf_analytics.projection_state')) {
        return {
          rows: [
            {
              definition_id: 'd',
              active_generation: 1,
              building_generation: null,
              build_token: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const repo = new PgAnalyticsRepository(pool);
    await repo.withTx(CTX, async (tx) => {
      await tx.getState('d', { shared: true });
      await tx.listDefinitions(null);
      await tx.listPublishedForEvent('ApplicationSubmitted');
      await tx.latestDefinitionVersion('X');
      await tx.queryPoints({
        definition_ids: [],
        period_from: null,
        period_to: null,
        dimensions: {},
        limit: 1,
      });
      await tx.queryPoints({
        definition_ids: ['d'],
        period_from: null,
        period_to: null,
        dimensions: {},
        limit: 1,
      });
      await tx.claimInbox('g', 'e');
    });
    const tenantStatements = log.filter((l) => /sf_analytics\./.test(l.text));
    expect(tenantStatements.length).toBeGreaterThan(5);
    for (const s of tenantStatements) expect(s.values, s.text).toContain(TENANT_A);
    expect(log.some((l) => l.text.includes('FOR SHARE'))).toBe(true);
    for (const s of tenantStatements) expect(s.text).not.toMatch(/\$\{|\+\s*['"]/);
  });

  it('maps database errors to the frozen catalogue codes', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError({ code: 'P0001' }).code).toBe('SF-APP-001');
    expect(mapPgError(new Error('x')).code).toBe('SF-SYS-001');
    const own = new Cmp045Error('SF-AUTH-001');
    expect(mapPgError(own)).toBe(own);
  });

  it('requires a repository and builds a working API from a pool', async () => {
    expect(() =>
      buildAnalyticsApi({
        resolveContext: () => Promise.resolve(CTX),
        authorizer: new AllowAllAuthorizer(),
        consumerActorId: CONSUMER_ACTOR,
      }),
    ).toThrow(Cmp045Error);
    const { pool } = fakePool(() => ({ rows: [], rowCount: 0 }));
    const api = buildAnalyticsApi({
      pool,
      resolveContext: () => Promise.resolve(CTX),
      authorizer: new AllowAllAuthorizer(),
      consumerActorId: CONSUMER_ACTOR,
      maxFutureSkewMs: 1,
      rebuildBatchSize: 1,
      maxRebuildBatches: 1,
      rebuildLeaseMs: 1,
    });
    const res = await api.handle({
      method: 'GET',
      path: '/v1/analytics/metric-definitions',
      headers: {},
    });
    expect(res.status).toBe(200);
  });
});
