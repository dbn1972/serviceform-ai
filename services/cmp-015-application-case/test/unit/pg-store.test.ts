import { describe, expect, it } from 'vitest';
import { Cmp015Error } from '../../src/errors.js';
import { PgCaseStore, type SqlClient, type SqlQueryResult } from '../../src/store/pg-store.js';
import type { DbSession } from '../../src/store/types.js';
import { CITIZEN, OFFICER, pinsFor, T1, TSB_T1 } from '../doubles/fixtures.js';

type Responder = (text: string, values: unknown[]) => SqlQueryResult | Error | undefined;

class ScriptedClient implements SqlClient {
  readonly log: { text: string; values: unknown[] }[] = [];
  released = 0;
  constructor(private readonly responder: Responder) {}
  async query(text: string, values: unknown[] = []): Promise<SqlQueryResult> {
    this.log.push({ text, values });
    const r = this.responder(text, values);
    if (r instanceof Error) throw r;
    return r ?? { rows: [], rowCount: 0 };
  }
  release(): void {
    this.released += 1;
  }
}

const session: DbSession = {
  tenantId: T1,
  cellId: 'cell-01',
  actorType: 'CITIZEN',
  actorId: CITIZEN,
  correlationId: OFFICER,
};
const pins = pinsFor(TSB_T1);
const caseDbRow = {
  application_id: CITIZEN,
  tenant_id: T1,
  cell_id: 'cell-01',
  service_id: OFFICER,
  applicant_id: CITIZEN,
  organisation_id: null,
  jurisdiction_id: OFFICER,
  state: 'DRAFT',
  aggregate_version: '1',
  ...pins,
  credential_template_version_id: null,
  notification_version_id: null,
  pin_graph_hash: `sha256:${'a'.repeat(64)}`,
  created_by: CITIZEN,
  created_at: new Date('2026-10-05T10:00:00Z'),
  updated_at: '2026-10-05T10:00:00Z',
  submitted_at: null,
  last_correlation_id: OFFICER,
};

function storeWith(responder: Responder): { store: PgCaseStore; client: ScriptedClient } {
  const client = new ScriptedClient(responder);
  return { store: new PgCaseStore({ connect: async () => client }), client };
}

describe('PgCaseStore (SF-CON-DB-SESSION-CONTEXT; short transaction)', () => {
  it('opens a transaction, sets transaction-local session context, commits and releases', async () => {
    const { store, client } = storeWith(() => undefined);
    await store.withTx(session, async () => 'ok');
    expect(client.log.map((l) => l.text)).toEqual([
      'BEGIN',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'COMMIT',
    ]);
    expect(client.log.slice(1, 6).map((l) => l.values[0])).toEqual([
      'app.tenant_id',
      'app.cell_id',
      'app.actor_type',
      'app.actor_id',
      'app.correlation_id',
    ]);
    expect(client.released).toBe(1);
  });

  it('rolls back and maps PostgreSQL errors; survives a failing ROLLBACK', async () => {
    const { store, client } = storeWith((text) =>
      text === 'ROLLBACK' ? new Error('gone') : undefined,
    );
    await expect(
      store.withTx(session, async () => {
        throw Object.assign(new Error('check'), {
          code: 'P0001',
          hint: 'SF_REQUEST_NOT_COMMITTED',
        });
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-001', details: [{ code: 'REQUEST_NOT_COMMITTED' }] });
    expect(client.log.at(-1)?.text).toBe('ROLLBACK');
    expect(client.released).toBe(1);
  });

  it('maps case rows (Date / string timestamps, bigint strings, optional pins)', async () => {
    const { store } = storeWith((text) =>
      text.includes('FROM sf_application_case.application_case')
        ? { rows: [caseDbRow], rowCount: 1 }
        : undefined,
    );
    const row = await store.withTx(session, (tx) => tx.getCase(CITIZEN, { forUpdate: true }));
    expect(row).toMatchObject({
      aggregate_version: 1,
      created_at: '2026-10-05T10:00:00.000Z',
      organisation_id: null,
    });
    expect(row?.pins).toEqual(pins);
    const none = await storeWith(() => undefined).store.withTx(session, (tx) =>
      tx.getCase(CITIZEN),
    );
    expect(none).toBeNull();
  });

  it('writes with optimistic predicates and parameterised SQL only', async () => {
    const { store, client } = storeWith((text) =>
      text.startsWith('UPDATE') || text.startsWith('INSERT')
        ? { rows: [], rowCount: 1 }
        : undefined,
    );
    await store.withTx(session, async (tx) => {
      expect(
        await tx.updateCaseState({
          applicationId: CITIZEN,
          fromState: 'DRAFT',
          toState: 'READY_TO_SUBMIT',
          fromVersion: 1,
          updatedAt: '2026-10-05T10:00:00Z',
          submittedAt: null,
          correlationId: OFFICER,
        }),
      ).toBe(true);
      expect(
        await tx.consumeRequest({
          requestId: OFFICER,
          atVersion: 2,
          updatedAt: 'x',
          correlationId: OFFICER,
        }),
      ).toBe(true);
      expect(
        await tx.updateRequestStatus({
          requestId: OFFICER,
          fromStatus: 'SUBMITTED',
          toStatus: 'COMMITTED',
          reasonCode: null,
          updatedAt: 'x',
          correlationId: OFFICER,
        }),
      ).toBe(true);
      await tx.insertCase({
        application_id: CITIZEN,
        tenant_id: T1,
        cell_id: 'cell-01',
        service_id: OFFICER,
        applicant_id: CITIZEN,
        organisation_id: null,
        jurisdiction_id: null,
        state: 'DRAFT',
        aggregate_version: 1,
        pins,
        pin_graph_hash: `sha256:${'a'.repeat(64)}`,
        created_by: CITIZEN,
        created_at: 'x',
        updated_at: 'x',
        submitted_at: null,
        last_correlation_id: OFFICER,
      });
      await tx.insertOutbox(
        {
          event_id: OFFICER,
          event_type: 'AuditEventSubmitted',
          schema_version: 1,
          tenant_id: T1,
          cell_id: 'cell-01',
          aggregate_type: 'AuditEvent',
          aggregate_id: CITIZEN,
          aggregate_version: 1,
          occurred_at: '2026-10-05T10:00:00.000Z',
          correlation_id: OFFICER,
          actor: { type: 'CITIZEN', id: CITIZEN },
          data: { audit_id: CITIZEN },
        },
        'sf.audit.ingest.v1',
      );
    });
    const update = client.log.find((l) =>
      l.text.includes('UPDATE sf_application_case.application_case'),
    );
    expect(update?.text).toMatch(
      /WHERE application_id = \$5 AND state = \$6 AND aggregate_version = \$7/,
    );
    const insertCase = client.log.find((l) =>
      l.text.includes('INSERT INTO sf_application_case.application_case'),
    );
    expect(insertCase?.values).toHaveLength(25);
    const outbox = client.log.find((l) => l.text.includes('outbox_event'));
    expect(outbox?.values[3]).toBe(`audit:${CITIZEN}`);
    expect(client.log.every((l) => !l.text.includes(T1))).toBe(true);
  });

  it('idempotency: claim, replay, conflict and in-progress', async () => {
    const completed = {
      request_fingerprint: 'sha256:f',
      status: 'COMPLETED',
      response_status: 201,
      response_body: { a: 1 },
    };
    const pending = {
      request_fingerprint: 'sha256:f',
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    };
    const ref = {
      principalId: CITIZEN,
      endpoint: 'POST /v1/applications',
      key: 'abcdefgh',
      now: new Date(),
      fingerprint: 'sha256:f',
    };
    const claimed = storeWith((t) =>
      t.startsWith('INSERT') ? { rows: [], rowCount: 1 } : undefined,
    );
    expect(await claimed.store.withTx(session, (tx) => tx.claimIdempotency(ref))).toBe('claimed');
    const replay = storeWith((t) =>
      t.startsWith('SELECT request_fingerprint') ? { rows: [completed], rowCount: 1 } : undefined,
    );
    expect(await replay.store.withTx(session, (tx) => tx.claimIdempotency(ref))).toEqual({
      status: 201,
      body: { a: 1 },
    });
    const conflict = storeWith((t) =>
      t.startsWith('SELECT request_fingerprint') ? { rows: [completed], rowCount: 1 } : undefined,
    );
    await expect(
      conflict.store.withTx(session, (tx) =>
        tx.claimIdempotency({ ...ref, fingerprint: 'sha256:g' }),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
    const inflight = storeWith((t) =>
      t.startsWith('SELECT request_fingerprint') ? { rows: [pending], rowCount: 1 } : undefined,
    );
    await expect(
      inflight.store.withTx(session, (tx) => tx.claimIdempotency(ref)),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
    expect(await inflight.store.withTx(session, (tx) => tx.lookupIdempotency(ref))).toEqual({
      state: 'pending',
      fingerprint: 'sha256:f',
    });
    const vanished = storeWith(() => undefined);
    await expect(
      vanished.store.withTx(session, (tx) => tx.claimIdempotency(ref)),
    ).rejects.toBeInstanceOf(Cmp015Error);
    await vanished.store.withTx(session, (tx) =>
      tx.completeIdempotency({ ...ref, response: { status: 200, body: {} } }),
    );
  });

  it('maps transition and request rows', async () => {
    const transition = {
      transition_id: OFFICER,
      tenant_id: T1,
      application_id: CITIZEN,
      command: 'SUBMIT',
      from_state: 'READY_TO_SUBMIT',
      to_state: 'SUBMITTED',
      transition_key: 'READY_TO_SUBMIT>SUBMITTED',
      transition_class: 'ALWAYS_LEGAL',
      aggregate_version: '3',
      idempotency_key: 'abcdefgh',
      authz_decision_id: OFFICER,
      authz_policy_revision: 'rev',
      correlation_id: OFFICER,
      actor_type: 'CITIZEN',
      actor_id: CITIZEN,
      reason_code: null,
      request_id: null,
      policy_ref: null,
      occurred_at: new Date('2026-10-05T10:00:00Z'),
    };
    const request = {
      request_id: OFFICER,
      tenant_id: T1,
      application_id: CITIZEN,
      kind: 'WITHDRAWAL',
      status: 'COMMITTED',
      workflow_ref: null,
      status_reason_code: null,
      case_state_at_request: 'DRAFT',
      consumed_at_version: '2',
      created_by: CITIZEN,
      created_at: new Date('2026-10-05T10:00:00Z'),
      updated_at: new Date('2026-10-05T10:00:00Z'),
      last_correlation_id: OFFICER,
    };
    const { store } = storeWith((t) => {
      if (t.includes('FROM sf_application_case.case_transition'))
        return { rows: [transition], rowCount: 1 };
      if (t.includes('FROM sf_application_case.case_request_reference'))
        return { rows: [request], rowCount: 1 };
      return undefined;
    });
    await store.withTx(session, async (tx) => {
      expect((await tx.listTransitions(CITIZEN))[0]).toMatchObject({
        aggregate_version: 3,
        occurred_at: '2026-10-05T10:00:00.000Z',
      });
      expect(await tx.getRequest(OFFICER, { forUpdate: true })).toMatchObject({
        consumed_at_version: 2,
        status: 'COMMITTED',
      });
      expect(await tx.getRequest(OFFICER)).toMatchObject({ kind: 'WITHDRAWAL' });
      await tx.insertTransition({
        ...transition,
        aggregate_version: 3,
        from_state: 'READY_TO_SUBMIT',
        to_state: 'SUBMITTED',
        transition_class: 'ALWAYS_LEGAL',
        actor_type: 'CITIZEN',
        occurred_at: 'x',
      } as never);
      await tx.insertRequest({ ...request, consumed_at_version: null } as never);
    });
    const empty = storeWith(() => undefined);
    expect(await empty.store.withTx(session, (tx) => tx.getRequest(OFFICER))).toBeNull();
  });
});
