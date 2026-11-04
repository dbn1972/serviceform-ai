import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  outboxPartitionKey,
  PgDigilockerRepository,
  toIdempotencyRecord,
  toPublishRow,
  type SqlClient,
  type SqlPool,
  type SqlResult,
} from '../../src/repo/pg.js';
import type { EventEnvelope } from '../../src/types.js';
import {
  ACTOR_SYSTEM,
  BINDING_ID,
  CREDENTIAL_ID,
  ctxFor,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';

class FakeClient implements SqlClient {
  readonly log: Array<{ text: string; values: unknown[] | undefined }> = [];
  released = 0;
  constructor(private readonly respond: (text: string) => SqlResult) {}
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<R>> {
    this.log.push({ text, values });
    return Promise.resolve(this.respond(text) as SqlResult<R>);
  }
  release(): void {
    this.released += 1;
  }
}

function fakePool(respond: (text: string) => SqlResult = () => ({ rows: [], rowCount: 0 })) {
  const client = new FakeClient(respond);
  const pool: SqlPool = { connect: () => Promise.resolve(client) };
  return { pool, client };
}

describe('pg row mapping', () => {
  it('maps a publish_record row with Date timestamps and jsonb marker', () => {
    const id = randomUUID();
    const r = toPublishRow({
      tenant_id: TENANT_A,
      publish_request_id: id,
      credential_id: CREDENTIAL_ID,
      credential_lifecycle_status_at_request: 'ISSUED',
      consent_ref: randomUUID(),
      purpose_code: 'DL_IDENTITY_VERIFY',
      connector_binding_id: BINDING_ID,
      connector_mode: 'SIMULATED',
      simulation_marker: { simulation: true },
      document_type_ref: 'IN.GOV.TEST',
      publish_status: 'PUBLISHED',
      provider_transaction_ref: 'sim:ref',
      failure_code: null,
      attempt_number: 1,
      idempotency_key: 'int-key-00000001',
      issuance_reversed_on_publish_failure: false,
      registry_status_changed_by_publish: false,
      invented_statutory_policy_forbidden: true,
      correlation_id: randomUUID(),
      actor_type: 'SYSTEM',
      created_by: ACTOR_SYSTEM,
      created_at: new Date('2026-10-14T05:00:00Z'),
      updated_at: new Date('2026-10-14T05:00:01Z'),
    });
    expect(r.publish_request_id).toBe(id);
    expect(r.created_at).toBe('2026-10-14T05:00:00.000Z');
    expect(r.updated_at).toBe('2026-10-14T05:00:01.000Z');
    expect(r.simulation_marker).toEqual({ simulation: true });
    expect(r.failure_code).toBeNull();
    expect(r.provider_transaction_ref).toBe('sim:ref');
    expect(r.issuance_reversed_on_publish_failure).toBe(false);
  });

  it('maps an idempotency row, keeping nulls as null', () => {
    const rec = toIdempotencyRecord({
      tenant_id: TENANT_A,
      principal_id: ACTOR_SYSTEM,
      endpoint: 'POST /v1/digilocker-publish',
      idempotency_key: 'int-key-00000001',
      request_fingerprint: `sha256:${'a'.repeat(64)}`,
      status: 'IN_PROGRESS',
      response_ref: null,
      response_status: null,
      response_body: null,
      created_at: new Date('2026-10-14T05:00:00Z'),
      expires_at: new Date('2026-10-15T05:00:00Z'),
    });
    expect(rec.response_status).toBeNull();
    expect(rec.response_body).toBeNull();
    expect(rec.expires_at).toBe('2026-10-15T05:00:00.000Z');
    expect(toIdempotencyRecord({ ...rec, response_status: '201' }).response_status).toBe(201);
  });

  it('keys audit envelopes by audit_id and domain envelopes by aggregate', () => {
    const env = {
      aggregate_id: randomUUID(),
      data: { audit_id: 'a-1' },
    } as unknown as EventEnvelope<object>;
    expect(outboxPartitionKey(env, 'sf.audit.ingest.v1')).toBe('audit:a-1');
    expect(outboxPartitionKey(env, 'sf.digilocker.events.v1')).toBe(env.aggregate_id);
    const noAudit = { aggregate_id: 'agg', data: {} } as unknown as EventEnvelope<object>;
    expect(outboxPartitionKey(noAudit, 'sf.audit.ingest.v1')).toBe('audit:agg');
  });
});

describe('PgDigilockerRepository transaction framing', () => {
  it('sets transaction-local tenant context, commits and releases', async () => {
    const { pool, client } = fakePool();
    const repo = new PgDigilockerRepository(pool);
    await repo.withTx(ctxFor(TENANT_A), () => Promise.resolve());
    expect(client.log[0]?.text).toBe('BEGIN');
    expect(client.log[1]).toEqual({
      text: 'SELECT set_config($1, $2, true)',
      values: ['app.tenant_id', TENANT_A],
    });
    expect(client.log.at(-1)?.text).toBe('COMMIT');
    expect(client.released).toBe(1);
  });

  it('rolls back and releases on failure', async () => {
    const { pool, client } = fakePool();
    const repo = new PgDigilockerRepository(pool);
    await expect(
      repo.withTx(ctxFor(TENANT_A), () => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(client.log.at(-1)?.text).toBe('ROLLBACK');
    expect(client.log.some((q) => q.text === 'COMMIT')).toBe(false);
    expect(client.released).toBe(1);
  });

  it('refuses mismatched tenant arguments without issuing SQL', async () => {
    const { pool, client } = fakePool();
    const repo = new PgDigilockerRepository(pool);
    await expect(
      repo.withTx(ctxFor(TENANT_A), (tx) => tx.getPublishRecord(TENANT_B, randomUUID())),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
    expect(client.log.some((q) => q.text.includes('sf_digilocker.publish_record'))).toBe(false);
  });

  it('returns the existing record when the idempotency claim conflicts', async () => {
    const existing = {
      tenant_id: TENANT_A,
      principal_id: ACTOR_SYSTEM,
      endpoint: 'POST /v1/digilocker-publish',
      idempotency_key: 'int-key-00000001',
      request_fingerprint: `sha256:${'a'.repeat(64)}`,
      status: 'COMPLETED',
      response_ref: null,
      response_status: 201,
      response_body: { ok: true },
      created_at: '2026-10-14T05:00:00.000Z',
      expires_at: '2026-10-15T05:00:00.000Z',
    };
    const { pool } = fakePool((text) =>
      text.startsWith('SELECT tenant_id')
        ? { rows: [existing], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    const repo = new PgDigilockerRepository(pool);
    const res = await repo.withTx(ctxFor(TENANT_A), (tx) =>
      tx.claimIdempotency({
        principalId: ACTOR_SYSTEM,
        endpoint: existing.endpoint,
        key: existing.idempotency_key,
        fingerprint: existing.request_fingerprint,
        now: new Date('2026-10-14T05:00:00Z'),
      }),
    );
    expect(res).toEqual(existing);
  });
});
