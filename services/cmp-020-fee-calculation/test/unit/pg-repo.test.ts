import { describe, expect, it } from 'vitest';
import type { Cmp020Error } from '../../src/errors.js';
import { UnboundApplicationPinsPort } from '../../src/ports/application-pins-port.js';
import { UnboundFeePolicyPort } from '../../src/ports/fee-policy-port.js';
import { UnboundFeeRulesPort } from '../../src/ports/fee-rules-port.js';
import {
  PgFeeRepository,
  type SqlClient,
  type SqlPool,
  type SqlResult,
} from '../../src/repo/pg.js';
import type { QuoteRow } from '../../src/repo/types.js';
import { ctxFor, TENANT_A } from '../doubles/fixtures.js';

type Responder = (text: string, values: unknown[]) => SqlResult | Error;

class ScriptedPool implements SqlPool {
  readonly log: { text: string; values: unknown[] }[] = [];
  released = 0;
  constructor(private readonly respond: Responder = () => ({ rows: [], rowCount: 0 })) {}
  connect(): Promise<SqlClient> {
    return Promise.resolve({
      query: <R>(text: string, values: unknown[] = []): Promise<SqlResult<R>> => {
        this.log.push({ text: text.replace(/\s+/g, ' ').trim(), values });
        const out = this.respond(text, values);
        return out instanceof Error ? Promise.reject(out) : Promise.resolve(out as SqlResult<R>);
      },
      release: () => {
        this.released += 1;
      },
    });
  }
}

const QUOTE_DB_ROW = {
  tenant_id: TENANT_A,
  quote_id: '22222222-2222-4222-8222-222222222222',
  application_id: '33333333-3333-4333-8333-333333333333',
  cell_id: 'cell-01',
  tenant_service_binding_id: '88888888-8888-4888-8888-888888888888',
  fee_policy_version_id: '44444444-4444-4444-8444-444444444441',
  fee_policy_content_hash: `sha256:${'a'.repeat(64)}`,
  rule_version_id: '55555555-5555-4555-8555-555555555555',
  rule_content_hash: null,
  rule_evaluation_id: null,
  currency: 'XTS',
  total_amount_minor: '9007199254740991',
  amount_source: 'FEE_POLICY_METADATA',
  waiver_policy_ref: null,
  facts_hash: `sha256:${'f'.repeat(64)}`,
  calculation_hash: `sha256:${'e'.repeat(64)}`,
  idempotency_key: 'key-00000001',
  correlation_id: '12121212-1212-4212-8212-121212121212',
  actor_type: 'CITIZEN',
  issued_by: '66666666-6666-4666-8666-666666666666',
  issued_at: new Date('2026-10-10T02:00:00Z'),
};

describe('unbound ports fail closed', () => {
  it.each([
    [
      'pins',
      () => new UnboundApplicationPinsPort().getFeePins(),
      'APPLICATION_PINS_PORT_NOT_BOUND',
    ],
    ['policy', () => new UnboundFeePolicyPort().getPublishedVersion(), 'FEE_POLICY_PORT_NOT_BOUND'],
    ['rules', () => new UnboundFeeRulesPort().evaluate(), 'FEE_RULES_PORT_NOT_BOUND'],
  ])('%s', async (_label, call, code) => {
    const err = (await (call as () => Promise<unknown>)().catch((e: unknown) => e)) as Cmp020Error;
    expect(err.code).toBe('SF-SYS-004');
    expect(err.details?.[0]?.code).toBe(code);
  });
});

describe('PgFeeRepository transaction envelope', () => {
  it('sets tenant session context locally, commits and releases', async () => {
    const pool = new ScriptedPool();
    const repo = new PgFeeRepository(pool);
    expect(repo.inTransaction()).toBe(false);
    const inside = await repo.withTx(ctxFor(TENANT_A), () => Promise.resolve(repo.inTransaction()));
    expect(inside).toBe(true);
    expect(pool.log[0]?.text).toBe('BEGIN');
    expect(pool.log.slice(1, 6).map((q) => q.values[0])).toEqual([
      'app.tenant_id',
      'app.cell_id',
      'app.actor_type',
      'app.actor_id',
      'app.correlation_id',
    ]);
    expect(pool.log.slice(1, 6).every((q) => q.text === 'SELECT set_config($1, $2, true)')).toBe(
      true,
    );
    expect(pool.log.at(-1)?.text).toBe('COMMIT');
    expect(pool.released).toBe(1);
  });

  it('rolls back on error, keeps the original error, and releases', async () => {
    const pool = new ScriptedPool((text) =>
      text === 'ROLLBACK' ? new Error('rollback failed') : { rows: [], rowCount: 0 },
    );
    const repo = new PgFeeRepository(pool);
    await expect(
      repo.withTx(ctxFor(TENANT_A), () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(pool.log.at(-1)?.text).toBe('ROLLBACK');
    expect(pool.released).toBe(1);
  });

  it('refuses nested transactions and missing tenant', async () => {
    const repo = new PgFeeRepository(new ScriptedPool());
    await expect(
      repo.withTx(ctxFor(TENANT_A), () => repo.withTx(ctxFor(TENANT_A), () => Promise.resolve(1))),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await expect(
      repo.withTx({ ...ctxFor(TENANT_A), tenant_id: null }, () => Promise.resolve(1)),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
  });
});

describe('PgFeeRepository statements', () => {
  it('maps quote and line rows exactly, including bigint amounts', async () => {
    const pool = new ScriptedPool((text) => {
      if (text.includes('FROM sf_fee.fee_quote_line')) {
        return {
          rows: [
            {
              quote_id: QUOTE_DB_ROW.quote_id,
              line_seq: 1,
              code: 'A',
              amount_minor: '9007199254740991',
              calculation_basis: 'FEE_POLICY_LINE',
              description_code: null,
              rule_output_key: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('FROM sf_fee.fee_quote')) return { rows: [QUOTE_DB_ROW], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const repo = new PgFeeRepository(pool);
    const out = await repo.withTx(ctxFor(TENANT_A), async (tx) => ({
      quote: await tx.getQuote(QUOTE_DB_ROW.quote_id),
      byCalc: await tx.findQuoteByCalculation(
        QUOTE_DB_ROW.application_id,
        QUOTE_DB_ROW.calculation_hash,
      ),
      list: await tx.listByApplication(QUOTE_DB_ROW.application_id),
      lines: await tx.listLines(QUOTE_DB_ROW.quote_id),
    }));
    expect(out.quote?.total_amount_minor).toBe(9007199254740991n);
    expect(out.quote?.issued_at).toBe('2026-10-10T02:00:00.000Z');
    expect(out.quote?.rule_content_hash).toBeNull();
    expect(out.byCalc?.quote_id).toBe(QUOTE_DB_ROW.quote_id);
    expect(out.list).toHaveLength(1);
    expect(out.lines[0]?.amount_minor).toBe(9007199254740991n);
    const reads = pool.log.filter(
      (q) => q.text.startsWith('SELECT tenant_id') || q.text.includes('FROM sf_fee'),
    );
    expect(reads.every((q) => q.values[0] === TENANT_A)).toBe(true);
  });

  it('returns undefined when no row matches', async () => {
    const repo = new PgFeeRepository(new ScriptedPool());
    const out = await repo.withTx(ctxFor(TENANT_A), async (tx) => [
      await tx.getQuote('x'),
      await tx.findQuoteByCalculation('x', 'y'),
      await tx.peekIdempotency({ principalId: 'p', endpoint: 'e', key: 'k' }),
    ]);
    expect(out).toEqual([undefined, undefined, undefined]);
  });

  it('writes amounts as decimal strings and reports dedupe conflicts', async () => {
    let quoteInserts = 0;
    const pool = new ScriptedPool((text) => {
      if (text.includes('INSERT INTO sf_fee.fee_quote (')) {
        quoteInserts += 1;
        return { rows: [], rowCount: quoteInserts === 1 ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const repo = new PgFeeRepository(pool);
    const row: QuoteRow = {
      ...QUOTE_DB_ROW,
      total_amount_minor: 9007199254740991n,
      issued_at: '2026-10-10T02:00:00.000Z',
      amount_source: 'FEE_POLICY_METADATA',
      actor_type: 'CITIZEN',
    };
    const results = await repo.withTx(ctxFor(TENANT_A), async (tx) => {
      const a = await tx.insertQuote(row);
      const b = await tx.insertQuote(row);
      await tx.insertLine({
        quote_id: row.quote_id,
        line_seq: 1,
        code: 'A',
        amount_minor: 5n,
        calculation_basis: 'FEE_POLICY_LINE',
        description_code: null,
        rule_output_key: null,
      });
      return [a, b];
    });
    expect(results).toEqual([true, false]);
    const insert = pool.log.find((q) => q.text.includes('INSERT INTO sf_fee.fee_quote ('));
    expect(insert?.values[11]).toBe('9007199254740991');
    const line = pool.log.find((q) => q.text.includes('INSERT INTO sf_fee.fee_quote_line'));
    expect(line?.values[4]).toBe('5');
    expect(line?.values[0]).toBe(TENANT_A);
  });

  it('idempotency: claim, replay, conflict, in-progress and complete', async () => {
    const scenario: { inserted: number; existing: Record<string, unknown> | null } = {
      inserted: 1,
      existing: null,
    };
    const pool = new ScriptedPool((text) => {
      if (text.includes('INSERT INTO sf_fee.idempotency_record'))
        return { rows: [], rowCount: scenario.inserted };
      if (text.includes('FROM sf_fee.idempotency_record')) {
        return {
          rows: scenario.existing ? [scenario.existing] : [],
          rowCount: scenario.existing ? 1 : 0,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const repo = new PgFeeRepository(pool);
    const p = {
      principalId: 'p',
      endpoint: 'POST /v1/fee-quotes',
      key: 'k-00000001',
      fingerprint: 'sha256:x',
      now: new Date(0),
    };
    const claim = () => repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(p));
    expect(await claim()).toBe('claimed');
    scenario.inserted = 0;
    scenario.existing = {
      request_fingerprint: 'sha256:x',
      status: 'COMPLETED',
      response_status: 201,
      response_body: { a: 1 },
    };
    expect(await claim()).toEqual({ status: 201, body: { a: 1 } });
    scenario.existing = {
      request_fingerprint: 'sha256:other',
      status: 'COMPLETED',
      response_status: 201,
      response_body: {},
    };
    await expect(claim()).rejects.toMatchObject({ code: 'SF-APP-002' });
    scenario.existing = {
      request_fingerprint: 'sha256:x',
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    };
    await expect(claim()).rejects.toMatchObject({ code: 'SF-APP-002' });
    scenario.existing = null;
    await expect(claim()).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await repo.withTx(ctxFor(TENANT_A), (tx) =>
      tx.completeIdempotency({
        principalId: 'p',
        endpoint: p.endpoint,
        key: p.key,
        status: 201,
        body: { q: 1 },
      }),
    );
    const complete = pool.log.find((q) => q.text.startsWith('UPDATE sf_fee.idempotency_record'));
    expect(complete?.values).toEqual([TENANT_A, 'p', p.endpoint, p.key, 201, '{"q":1}']);
  });

  it('outbox partition keys: aggregate id for domain events, audit id for audit events', async () => {
    const pool = new ScriptedPool();
    const repo = new PgFeeRepository(pool);
    const base = {
      event_id: 'e1',
      tenant_id: TENANT_A,
      event_type: 'X',
      schema_version: 1,
      aggregate_type: 'FeeQuote',
      aggregate_id: 'agg-1',
      aggregate_version: 1,
      cell_id: 'cell-01',
      occurred_at: '2026-10-10T00:00:00Z',
      correlation_id: 'c',
      actor: { type: 'SYSTEM' as const, id: 'a' },
    };
    await repo.withTx(ctxFor(TENANT_A), async (tx) => {
      await tx.insertOutbox({ ...base, data: {} }, 'sf.fee.events.v1');
      await tx.insertOutbox({ ...base, data: { audit_id: 'audit-9' } }, 'sf.audit.ingest.v1');
      await tx.insertOutbox({ ...base, data: {} }, 'sf.audit.ingest.v1');
    });
    const keys = pool.log
      .filter((q) => q.text.includes('INSERT INTO sf_fee.outbox_event'))
      .map((q) => q.values[3]);
    expect(keys).toEqual(['agg-1', 'audit:audit-9', 'audit:agg-1']);
  });
});
