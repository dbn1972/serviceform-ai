import { describe, expect, it } from 'vitest';
import { mapPgError } from '../../src/errors.js';
import { envelopeOf } from '../../src/events.js';
import { PgGrievanceStore, type SqlClient, type SqlQueryResult } from '../../src/store/pg-store.js';
import { Cmp027Error } from '../../src/errors.js';
import { ctx, CITIZEN, T1 } from '../doubles/fixtures.js';

class FakeClient implements SqlClient {
  readonly calls: { text: string; values?: unknown[] }[] = [];
  failNext: Error | null = null;
  result: SqlQueryResult = { rows: [], rowCount: 0 };
  released = false;
  async query(text: string, values?: unknown[]): Promise<SqlQueryResult> {
    this.calls.push(values === undefined ? { text } : { text, values });
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    if (
      text === 'BEGIN' ||
      text === 'COMMIT' ||
      text === 'ROLLBACK' ||
      text.startsWith('SELECT set_config')
    ) {
      return { rows: [], rowCount: 0 };
    }
    return this.result;
  }
  release(): void {
    this.released = true;
  }
}

describe('PgGrievanceStore', () => {
  it('applies SF-CON-DB-SESSION-CONTEXT and inserts grievance + outbox', async () => {
    const client = new FakeClient();
    client.result = { rows: [], rowCount: 1 };
    const store = new PgGrievanceStore({ connect: async () => client });
    const c = ctx(T1, 'CITIZEN', CITIZEN);
    await store.withTx(
      {
        tenantId: T1,
        cellId: 'cell-01',
        actorType: 'CITIZEN',
        actorId: CITIZEN,
        correlationId: c.correlation_id,
      },
      async (tx) => {
        await tx.insertGrievance({
          grievance_id: '11111111-1111-4111-8111-111111111111',
          tenant_id: T1,
          cell_id: 'cell-01',
          kind: 'GRIEVANCE',
          status: 'FILED',
          aggregate_version: 1,
          reference_code: 'GF-111111111111',
          category_code: null,
          filer_id: CITIZEN,
          organisation_id: null,
          jurisdiction_id: null,
          office_id: null,
          service_id: null,
          application_id: null,
          workflow_version_id: null,
          created_by: CITIZEN,
          created_at: '2026-10-06T12:00:00.000Z',
          updated_at: '2026-10-06T12:00:00.000Z',
          last_correlation_id: c.correlation_id,
        });
        await tx.insertOutbox(
          envelopeOf({
            eventType: 'GrievanceFiled',
            ctx: c,
            aggregateId: '11111111-1111-4111-8111-111111111111',
            aggregateVersion: 1,
            occurredAt: '2026-10-06T12:00:00.000Z',
            data: { status: 'FILED' },
          }),
          'sf.grievance.events.v1',
        );
        return true;
      },
    );
    expect(client.calls.some((c0) => c0.text === 'BEGIN')).toBe(true);
    expect(client.calls.some((c0) => c0.text === 'COMMIT')).toBe(true);
    expect(client.calls.some((c0) => c0.values?.[0] === 'app.tenant_id')).toBe(true);
    expect(client.released).toBe(true);
  });

  it('maps postgres failures and rolls back', async () => {
    const client = new FakeClient();
    client.failNext = Object.assign(new Error('boom'), { code: '23505' });
    const store = new PgGrievanceStore({ connect: async () => client });
    await expect(
      store.withTx(
        {
          tenantId: T1,
          cellId: 'cell-01',
          actorType: 'CITIZEN',
          actorId: CITIZEN,
          correlationId: '11111111-1111-4111-8111-111111111111',
        },
        async (tx) => tx.getGrievance('11111111-1111-4111-8111-111111111111'),
      ),
    ).rejects.toBeInstanceOf(Cmp027Error);
    expect(client.calls.some((c0) => c0.text === 'ROLLBACK')).toBe(true);
  });

  it('covers remaining tx methods against a fake client', async () => {
    const client = new FakeClient();
    const c = ctx(T1, 'CITIZEN', CITIZEN);
    const gid = '11111111-1111-4111-8111-111111111111';
    client.result = {
      rowCount: 1,
      rows: [
        {
          grievance_id: gid,
          tenant_id: T1,
          cell_id: 'cell-01',
          kind: 'GRIEVANCE',
          status: 'FILED',
          aggregate_version: 1,
          reference_code: 'GF-111111111111',
          category_code: null,
          filer_id: CITIZEN,
          organisation_id: null,
          jurisdiction_id: null,
          office_id: null,
          service_id: null,
          application_id: null,
          workflow_version_id: null,
          created_by: CITIZEN,
          created_at: '2026-10-06T12:00:00.000Z',
          updated_at: '2026-10-06T12:00:00.000Z',
          last_correlation_id: c.correlation_id,
          request_fingerprint: 'sha256:' + 'ab'.repeat(32),
          response_status: 201,
          response_body: { ok: true },
          transition_id: gid,
          command: 'FILE',
          from_status: null,
          to_status: 'FILED',
          idempotency_key: 'idem-key-xxxxxxxx',
          authz_decision_id: gid,
          authz_policy_revision: 'r1',
          correlation_id: c.correlation_id,
          actor_type: 'CITIZEN',
          actor_id: CITIZEN,
          reason_code: null,
          policy_ref: null,
          occurred_at: '2026-10-06T12:00:00.000Z',
          response_id: gid,
          author_actor_type: 'OFFICER',
          author_id: CITIZEN,
          body_ref: 'evd:resp-0001',
          role_code: 'GRIEVANCE_OFFICER',
        },
      ],
    };
    const store = new PgGrievanceStore({ connect: async () => client });
    await store.withTx(
      {
        tenantId: T1,
        cellId: 'cell-01',
        actorType: 'CITIZEN',
        actorId: CITIZEN,
        correlationId: c.correlation_id,
      },
      async (tx) => {
        await tx.lookupIdempotency({
          principalId: CITIZEN,
          endpoint: 'POST /v1/grievances',
          key: 'idem-key-xxxxxxxx',
        });
        await tx.claimIdempotency({
          principalId: CITIZEN,
          endpoint: 'POST /v1/grievances',
          key: 'idem-other-xxxxxxxx',
          fingerprint: 'sha256:' + 'cd'.repeat(32),
          now: new Date('2026-10-06T12:00:00.000Z'),
        });
        await tx.completeIdempotency({
          principalId: CITIZEN,
          endpoint: 'POST /v1/grievances',
          key: 'idem-key-xxxxxxxx',
          response: { status: 201, body: { ok: true } },
        });
        await tx.getGrievance(gid, { forUpdate: true });
        await tx.updateGrievance({
          grievanceId: gid,
          fromStatus: 'FILED',
          toStatus: 'CATEGORISED',
          fromVersion: 1,
          categoryCode: 'DELAY',
          organisationId: null,
          jurisdictionId: null,
          officeId: null,
          workflowVersionId: null,
          updatedAt: '2026-10-06T12:00:00.000Z',
          correlationId: c.correlation_id,
        });
        await tx.insertTransition({
          transition_id: gid,
          tenant_id: T1,
          grievance_id: gid,
          command: 'CATEGORISE',
          from_status: 'FILED',
          to_status: 'CATEGORISED',
          aggregate_version: 2,
          idempotency_key: 'idem-key-xxxxxxxx',
          authz_decision_id: gid,
          authz_policy_revision: 'r1',
          correlation_id: c.correlation_id,
          actor_type: 'OFFICER',
          actor_id: CITIZEN,
          reason_code: null,
          policy_ref: null,
          occurred_at: '2026-10-06T12:00:00.000Z',
        });
        await tx.listTransitions(gid);
        await tx.insertResponse({
          response_id: gid,
          tenant_id: T1,
          grievance_id: gid,
          author_actor_type: 'OFFICER',
          author_id: CITIZEN,
          body_ref: 'evd:resp-0001',
          created_at: '2026-10-06T12:00:00.000Z',
          correlation_id: c.correlation_id,
        });
        await tx.listResponses(gid);
        await tx.insertAssignmentRequest({
          request_id: gid,
          tenant_id: T1,
          grievance_id: gid,
          assignment: {
            role_code: 'GRIEVANCE_OFFICER',
            organisation_id: gid,
            office_id: null,
            jurisdiction_id: gid,
            service_scope_id: null,
          },
          status: 'REQUESTED',
          created_at: '2026-10-06T12:00:00.000Z',
          correlation_id: c.correlation_id,
        });
        await tx.getAssignmentRequest(gid);
        await tx.insertAiAssist({
          assist_id: gid,
          tenant_id: T1,
          grievance_id: gid,
          kind: 'CLASSIFY',
          suggestion_code: 'DELAY',
          duplicate_of_id: null,
          created_at: '2026-10-06T12:00:00.000Z',
          correlation_id: c.correlation_id,
        });
        return true;
      },
    );
    expect(client.calls.length).toBeGreaterThan(10);
  });

  it('maps pg hints for stale version and rls', () => {
    expect(mapPgError({ code: 'P0001', hint: 'SF_STALE_VERSION' }).code).toBe('SF-APP-001');
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '40001' }).code).toBe('SF-APP-001');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-APP-001');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError(new Error('x')).code).toBe('SF-SYS-001');
  });
});
