import { describe, expect, it } from 'vitest';
import { PgNotificationRepository, type SqlClient, type SqlPool } from '../../src/repo/pg.js';
import type { AttemptRow, DispatchRow, TemplateRow } from '../../src/repo/types.js';
import { ctxFor, BINDING_SMS, TENANT_A } from '../doubles/fixtures.js';

interface Recorded {
  text: string;
  values: unknown[] | undefined;
}

type Responder = (text: string, values: unknown[] | undefined) => Record<string, unknown>[] | null;

class FakePool implements SqlPool {
  readonly log: Recorded[] = [];
  released = 0;
  constructor(private readonly respond: Responder = () => null) {}
  connect(): Promise<SqlClient> {
    return Promise.resolve({
      query: (text: string, values?: unknown[]) => {
        this.log.push({ text, values });
        if (text === 'FAIL_COMMIT_SENTINEL') return Promise.reject(new Error('x'));
        const rows = this.respond(text, values) ?? [];
        return Promise.resolve({ rows, rowCount: rows.length } as never);
      },
      release: () => {
        this.released += 1;
      },
    });
  }
}

const NOW = '2026-10-10T10:00:00.000Z';

const dispatchRow: DispatchRow = {
  tenant_id: TENANT_A,
  dispatch_id: '55555555-5555-4555-8555-555555555555',
  application_id: null,
  cell_id: 'cell-test-1',
  template_ref: 'tpl.a',
  template_version: 2,
  channel: 'SMS',
  locale: 'en-IN',
  recipient_handle_class: 'CITIZEN_HANDLE_REF',
  recipient_handle_ref: 'handle.demo.0001',
  template_params: { a: 'b' },
  connector_binding_id: BINDING_SMS,
  connector_mode: 'SIMULATED',
  connector_environment: 'CI',
  connector_critical: false,
  simulation_marker: {
    simulation: true,
    scenario: 'notification_sms',
    test_run_id: 'r',
    connector_binding_id: BINDING_SMS,
    environment: 'CI',
  },
  status: 'QUEUED',
  attempts: 0,
  max_attempts: 5,
  next_attempt_at: NOW,
  lease_owner: null,
  lease_expires_at: null,
  provider_message_ref: null,
  last_error_code: null,
  idempotency_key: 'idem-key-0001',
  requested_by: '33333333-3333-4333-8333-333333333333',
  requested_at: NOW,
  sent_at: null,
  delivered_at: null,
  correlation_id: '99999999-9999-4999-8999-999999999990',
  aggregate_version: 1,
  created_at: NOW,
  updated_at: NOW,
};

const templateRow: TemplateRow = {
  template_ref: 'tpl.a',
  template_version: 1,
  channel: 'SMS',
  locale: 'en-IN',
  subject_template: null,
  body_template: 'hi {{a}}',
  allowed_params: ['a'],
  published_by: '33333333-3333-4333-8333-333333333333',
  published_at: NOW,
  correlation_id: '99999999-9999-4999-8999-999999999990',
};

const attemptRow: AttemptRow = {
  dispatch_id: dispatchRow.dispatch_id,
  attempt_no: 1,
  outcome: 'ACCEPTED',
  error_code: null,
  provider_message_ref: 'p-1',
  connector_mode: 'SIMULATED',
  simulation_marker: dispatchRow.simulation_marker,
  occurred_at: NOW,
  correlation_id: dispatchRow.correlation_id,
};

describe('PgNotificationRepository transaction envelope', () => {
  it('sets the tenant session context inside BEGIN..COMMIT and releases the client', async () => {
    const pool = new FakePool();
    const repo = new PgNotificationRepository(pool);
    expect(repo.inTransaction()).toBe(false);
    await repo.withTx(ctxFor(TENANT_A), (tx) => {
      expect(repo.inTransaction()).toBe(true);
      return tx.listAttempts('x');
    });
    const texts = pool.log.map((l) => l.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts.at(-1)).toBe('COMMIT');
    const settings = pool.log.filter((l) => l.text.startsWith('SELECT set_config'));
    expect(settings.map((s) => s.values?.[0])).toEqual([
      'app.tenant_id',
      'app.cell_id',
      'app.actor_type',
      'app.actor_id',
      'app.correlation_id',
    ]);
    expect(settings[0]?.values?.[1]).toBe(TENANT_A);
    expect(pool.released).toBe(1);
    expect(repo.inTransaction()).toBe(false);
  });

  it('rolls back and releases on failure, rethrowing the original error', async () => {
    const pool = new FakePool();
    const repo = new PgNotificationRepository(pool);
    await expect(
      repo.withTx(ctxFor(TENANT_A), () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(pool.log.at(-1)?.text).toBe('ROLLBACK');
    expect(pool.released).toBe(1);
  });

  it('refuses a missing tenant and a nested transaction', async () => {
    const repo = new PgNotificationRepository(new FakePool());
    await expect(
      repo.withTx({ ...ctxFor(TENANT_A), tenant_id: null }, () => Promise.resolve(1)),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
    await expect(
      repo.withTx(ctxFor(TENANT_A), () => repo.withTx(ctxFor(TENANT_A), () => Promise.resolve(1))),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });
});

describe('PgNotificationRepository statements', () => {
  it('every statement is parameterised and scoped to the tenant', async () => {
    const pool = new FakePool((text) => {
      if (text.includes('FROM sf_notification.notification_template'))
        return [
          {
            ...templateRow,
            template_version: '1',
            published_at: new Date(NOW),
          },
        ];
      if (text.includes('FROM sf_notification.notification_dispatch') || text.includes('RETURNING'))
        return [
          {
            ...dispatchRow,
            template_version: '2',
            attempts: '0',
            max_attempts: '5',
            aggregate_version: '1',
            next_attempt_at: new Date(NOW),
            requested_at: new Date(NOW),
            created_at: new Date(NOW),
            updated_at: new Date(NOW),
          },
        ];
      if (text.includes('FROM sf_notification.dispatch_attempt'))
        return [{ ...attemptRow, attempt_no: '1', occurred_at: new Date(NOW) }];
      return null;
    });
    const repo = new PgNotificationRepository(pool);
    const ctx = ctxFor(TENANT_A);
    const out = await repo.withTx(ctx, async (tx) => {
      await tx.insertTemplate(templateRow);
      const tpl = await tx.getTemplate('tpl.a', 'SMS', 'en-IN');
      const pinned = await tx.getTemplate('tpl.a', 'SMS', 'en-IN', 1);
      const versions = await tx.listTemplateVersions('tpl.a');
      await tx.insertDispatch(dispatchRow);
      const got = await tx.getDispatch(dispatchRow.dispatch_id);
      await tx.updateDispatch({ ...dispatchRow, status: 'SENDING' });
      const claimed = await tx.claimDue({
        limit: 3,
        now: new Date(NOW),
        leaseOwner: 'w',
        leaseMs: 60_000,
      });
      await tx.insertAttempt(attemptRow);
      const attempts = await tx.listAttempts(dispatchRow.dispatch_id);
      return { tpl, pinned, versions, got, claimed, attempts };
    });
    expect(out.tpl).toMatchObject({
      template_version: 1,
      allowed_params: ['a'],
      subject_template: null,
    });
    expect(out.got).toMatchObject({
      tenant_id: TENANT_A,
      template_version: 2,
      attempts: 0,
      next_attempt_at: NOW,
      application_id: null,
      lease_owner: null,
    });
    expect(out.claimed).toHaveLength(1);
    expect(out.attempts[0]).toMatchObject({ attempt_no: 1, outcome: 'ACCEPTED' });
    expect(out.versions).toHaveLength(1);

    const statements = pool.log.filter((l) => l.text.includes('sf_notification.'));
    expect(statements.length).toBeGreaterThan(8);
    for (const s of statements) {
      expect(s.text).toMatch(/\$1/);
      expect(s.values?.[0], s.text).toBe(TENANT_A);
      expect(s.text).not.toMatch(/\$\{|' *\+/);
    }
    const claim = pool.log.find((l) => l.text.includes('SKIP LOCKED'));
    expect(claim?.text).toContain('LEAST(d.attempts + 1, d.max_attempts + 1)');
    expect(claim?.values).toEqual([
      TENANT_A,
      NOW,
      3,
      'w',
      new Date(Date.parse(NOW) + 60_000).toISOString(),
    ]);
  });

  it('serialises JSON columns and reads absent optional rows as undefined', async () => {
    const pool = new FakePool();
    const repo = new PgNotificationRepository(pool);
    await repo.withTx(ctxFor(TENANT_A), async (tx) => {
      await tx.insertDispatch({ ...dispatchRow, simulation_marker: null, connector_mode: 'REAL' });
      expect(await tx.getTemplate('x', 'SMS', 'en-IN')).toBeUndefined();
      expect(await tx.getDispatch('x')).toBeUndefined();
    });
    const insert = pool.log.find((l) =>
      l.text.includes('INSERT INTO sf_notification.notification_dispatch'),
    );
    expect(insert?.values?.[10]).toBe('{"a":"b"}');
    expect(insert?.values?.[15]).toBeNull();
  });

  it('claims and replays idempotency records', async () => {
    let existing: Record<string, unknown> | undefined;
    const pool = new FakePool((text) => {
      if (text.includes('INSERT INTO sf_notification.idempotency_record'))
        return existing ? [] : [{}];
      if (text.includes('FROM sf_notification.idempotency_record'))
        return existing ? [existing] : [];
      return null;
    });
    const repo = new PgNotificationRepository(pool);
    const p = {
      principalId: 'p',
      endpoint: 'POST /x',
      key: 'k-0000001',
      fingerprint: 'sha256:' + 'a'.repeat(64),
      now: new Date(NOW),
    };
    expect(await repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(p))).toBe('claimed');
    existing = {
      request_fingerprint: p.fingerprint,
      status: 'COMPLETED',
      response_status: 202,
      response_body: { ok: 1 },
    };
    expect(await repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(p))).toEqual({
      status: 202,
      body: { ok: 1 },
    });
    existing = { ...existing, request_fingerprint: 'sha256:' + 'b'.repeat(64) };
    await expect(
      repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(p)),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
    existing = {
      request_fingerprint: p.fingerprint,
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    };
    await expect(
      repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(p)),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
    existing = undefined;
    const vanished = new FakePool((text) => (text.includes('INSERT INTO') ? [] : []));
    await expect(
      new PgNotificationRepository(vanished).withTx(ctxFor(TENANT_A), (tx) =>
        tx.claimIdempotency(p),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await repo.withTx(ctxFor(TENANT_A), (tx) =>
      tx.completeIdempotency({
        principalId: 'p',
        endpoint: 'POST /x',
        key: 'k',
        status: 202,
        body: { a: 1 },
      }),
    );
    const complete = pool.log.find((l) => l.text.includes("SET status = 'COMPLETED'"));
    expect(complete?.values?.[5]).toBe('{"a":1}');
  });

  it('writes outbox rows with the tenant, aggregate partition and a separate audit partition', async () => {
    const pool = new FakePool();
    const repo = new PgNotificationRepository(pool);
    const base = {
      event_id: '11111111-aaaa-4aaa-8aaa-111111111111',
      schema_version: 1,
      tenant_id: TENANT_A,
      cell_id: 'cell-test-1',
      aggregate_type: 'NotificationDispatch',
      aggregate_id: dispatchRow.dispatch_id,
      aggregate_version: 1,
      occurred_at: NOW,
      correlation_id: dispatchRow.correlation_id,
      actor: { type: 'OFFICER' as const, id: dispatchRow.requested_by },
    };
    await repo.withTx(ctxFor(TENANT_A), async (tx) => {
      await tx.insertOutbox(
        { ...base, event_type: 'NotificationQueued', data: {} },
        'sf.notification.events.v1',
      );
      await tx.insertOutbox(
        { ...base, event_type: 'AuditEventSubmitted', data: { audit_id: 'au-1' } },
        'sf.audit.ingest.v1',
      );
    });
    const inserts = pool.log.filter((l) =>
      l.text.includes('INSERT INTO sf_notification.outbox_event'),
    );
    expect(inserts.map((i) => i.values?.[3])).toEqual([dispatchRow.dispatch_id, 'audit:au-1']);
    expect(inserts.every((i) => i.values?.[1] === TENANT_A)).toBe(true);
  });
});
