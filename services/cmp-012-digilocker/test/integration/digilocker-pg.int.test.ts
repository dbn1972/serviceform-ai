import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedDigiLockerConnector } from '../../src/connectors/simulated-digilocker.js';
import { requestFingerprint } from '../../src/domain/fingerprint.js';
import type { SimulationMarker } from '../../src/domain/simulation.js';
import { buildDigiLockerService, PgDigilockerRepository } from '../../src/index.js';
import { envelopeOf, TOPIC_DOMAIN } from '../../src/outbox.js';
import type {
  DigiLockerApiPort,
  DigiLockerPublishRequest,
  DigiLockerPublishResult,
} from '../../src/ports/digilocker-api-port.js';
import type { PublishRow } from '../../src/repo/types.js';
import {
  ACTOR_SYSTEM,
  AllowAllAuthorizer,
  BINDING_ID,
  CONSENT_REF,
  CREDENTIAL_ID,
  ctxFor,
  DOCUMENT_TYPE_REF,
  FakeConnectorBindingPort,
  FakeCredentialVerificationPort,
  PURPOSE_CODE,
  TENANT_A,
  TENANT_B,
  TEST_RUN_ID,
} from '../doubles/fixtures.js';
import {
  asSqlPool,
  asTenant,
  closeHarness,
  errorCode,
  setupHarness,
  type Harness,
  type PgPoolLike,
} from './helpers.js';

type Body = Record<string, unknown>;
const ENDPOINT = 'POST /v1/digilocker-publish';
const NOW = new Date('2026-10-14T05:00:00.000Z');

function marker(scenario = 'digilocker_publish'): SimulationMarker {
  return {
    simulation: true,
    scenario,
    test_run_id: TEST_RUN_ID,
    connector_binding_id: BINDING_ID,
    environment: 'CI',
  };
}

function row(tenantId: string, overrides: Partial<PublishRow> = {}): PublishRow {
  return {
    tenant_id: tenantId,
    publish_request_id: randomUUID(),
    credential_id: CREDENTIAL_ID,
    credential_lifecycle_status_at_request: 'ISSUED',
    consent_ref: CONSENT_REF,
    purpose_code: PURPOSE_CODE,
    connector_binding_id: BINDING_ID,
    connector_mode: 'SIMULATED',
    simulation_marker: { ...marker() },
    document_type_ref: DOCUMENT_TYPE_REF,
    publish_status: 'PENDING',
    provider_transaction_ref: null,
    failure_code: null,
    attempt_number: 1,
    idempotency_key: `int-key-${randomUUID()}`,
    issuance_reversed_on_publish_failure: false,
    registry_status_changed_by_publish: false,
    invented_statutory_policy_forbidden: true,
    correlation_id: randomUUID(),
    actor_type: 'SYSTEM',
    created_by: ACTOR_SYSTEM,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function domainEnvelope(tenantId: string, aggregateId: string) {
  return envelopeOf({
    eventType: 'DigiLockerPublishRequested',
    tenantId,
    cellId: 'cell-01',
    aggregateType: 'DigiLockerPublish',
    aggregateId,
    aggregateVersion: 1,
    occurredAt: NOW.toISOString(),
    correlationId: randomUUID(),
    actor: { type: 'SYSTEM', id: ACTOR_SYSTEM },
    data: { publish_request_id: aggregateId },
  });
}

const COUNT_SQL = {
  publishById:
    'SELECT count(*)::int AS n FROM sf_digilocker.publish_record WHERE publish_request_id = $1',
  publishByKey:
    'SELECT count(*)::int AS n FROM sf_digilocker.publish_record WHERE idempotency_key = $1',
  idempotencyByKey:
    'SELECT count(*)::int AS n FROM sf_digilocker.idempotency_record WHERE idempotency_key = $1',
  outboxById: 'SELECT count(*)::int AS n FROM sf_digilocker.outbox_event WHERE event_id = $1',
} as const;

async function adminCount(
  admin: PgPoolLike,
  which: keyof typeof COUNT_SQL,
  value: string,
): Promise<number> {
  const r = await admin.query(COUNT_SQL[which], [value]);
  return Number(r.rows[0]?.['n']);
}

class ProbedConnector implements DigiLockerApiPort {
  readonly mode = 'SIMULATED' as const;
  readonly inner: SimulatedDigiLockerConnector;
  readonly txStateAtCall: boolean[] = [];
  constructor(
    private readonly repo: PgDigilockerRepository,
    sim: SimulationMarker,
  ) {
    this.inner = new SimulatedDigiLockerConnector(sim);
  }
  get simulation(): SimulationMarker {
    return this.inner.simulation;
  }
  publish(request: DigiLockerPublishRequest): Promise<DigiLockerPublishResult> {
    this.txStateAtCall.push(this.repo.inTransaction());
    return this.inner.publish(request);
  }
}

describe('CMP-012 PgDigilockerRepository on PostgreSQL (FORCE RLS, ADR-0006 roles)', () => {
  let h: Harness;
  let repo: PgDigilockerRepository;

  beforeAll(async () => {
    h = await setupHarness();
    repo = new PgDigilockerRepository(asSqlPool(h.rt));
  });

  afterAll(async () => {
    await closeHarness(h);
  });

  describe('publish record round-trip', () => {
    it('inserts, reads and updates a record with the outbox rows committed in the same tx', async () => {
      const r = row(TENANT_A);
      const env = domainEnvelope(TENANT_A, r.publish_request_id);
      await repo.withTx(ctxFor(TENANT_A), async (tx) => {
        await tx.insertPublishRecord(r);
        await tx.insertOutbox(env, TOPIC_DOMAIN);
      });

      const got = await repo.withTx(ctxFor(TENANT_A), (tx) =>
        tx.getPublishRecord(TENANT_A, r.publish_request_id),
      );
      expect(got).toEqual(r);

      const updated = await repo.withTx(ctxFor(TENANT_A), (tx) =>
        tx.updatePublishRecord(TENANT_A, r.publish_request_id, {
          publish_status: 'PUBLISHED',
          provider_transaction_ref: `sim:${r.publish_request_id}`,
          failure_code: null,
          attempt_number: 2,
        }),
      );
      expect(updated).toBe(true);
      const after = await repo.withTx(ctxFor(TENANT_A), (tx) =>
        tx.getPublishRecord(TENANT_A, r.publish_request_id),
      );
      expect(after?.publish_status).toBe('PUBLISHED');
      expect(after?.provider_transaction_ref).toBe(`sim:${r.publish_request_id}`);
      expect(after?.attempt_number).toBe(2);
      expect(after?.credential_id).toBe(r.credential_id);
      expect(after?.issuance_reversed_on_publish_failure).toBe(false);
      expect(after?.registry_status_changed_by_publish).toBe(false);

      const ob = await h.admin.query(
        `SELECT tenant_id::text, topic, partition_key, event_type, aggregate_id::text, envelope
           FROM sf_digilocker.outbox_event WHERE event_id = $1`,
        [env.event_id],
      );
      expect(ob.rows).toHaveLength(1);
      expect(ob.rows[0]).toMatchObject({
        tenant_id: TENANT_A,
        topic: TOPIC_DOMAIN,
        partition_key: r.publish_request_id,
        event_type: 'DigiLockerPublishRequested',
        aggregate_id: r.publish_request_id,
      });
      expect((ob.rows[0]?.['envelope'] as Body)['event_id']).toBe(env.event_id);
    });

    it('rolls back the record and its outbox rows together when the tx fails', async () => {
      const r = row(TENANT_A);
      const env = domainEnvelope(TENANT_A, r.publish_request_id);
      const failure = await errorCode(() =>
        repo.withTx(ctxFor(TENANT_A), async (tx) => {
          await tx.insertPublishRecord(r);
          await tx.insertOutbox(env, TOPIC_DOMAIN);
          throw Object.assign(new Error('boom'), { code: 'TEST_ABORT' });
        }),
      );
      expect(failure).toBe('TEST_ABORT');
      expect(await adminCount(h.admin, 'publishById', r.publish_request_id)).toBe(0);
      expect(await adminCount(h.admin, 'outboxById', env.event_id)).toBe(0);
    });

    it('routes tenant-null (audit) envelopes to outbox_event_platform keyed by audit_id', async () => {
      const auditId = randomUUID();
      const eventId = randomUUID();
      await repo.withTx(ctxFor(TENANT_A), (tx) =>
        tx.insertOutbox(
          {
            event_id: eventId,
            event_type: 'AuditEvent',
            schema_version: 1,
            tenant_id: null,
            cell_id: 'cell-01',
            aggregate_type: 'AuditEvent',
            aggregate_id: auditId,
            aggregate_version: 0,
            occurred_at: NOW.toISOString(),
            correlation_id: randomUUID(),
            actor: { type: 'SYSTEM', id: ACTOR_SYSTEM },
            data: { audit_id: auditId },
          },
          'sf.audit.ingest.v1',
        ),
      );
      const ob = await h.admin.query(
        'SELECT partition_key FROM sf_digilocker.outbox_event_platform WHERE event_id = $1',
        [eventId],
      );
      expect(ob.rows[0]?.['partition_key']).toBe(`audit:${auditId}`);
    });

    it('enforces the publish-failure invariants as CHECK constraints (issuance never reversed)', async () => {
      const bad = row(TENANT_A, {
        issuance_reversed_on_publish_failure: true as unknown as false,
      });
      expect(
        await errorCode(() => repo.withTx(ctxFor(TENANT_A), (tx) => tx.insertPublishRecord(bad))),
      ).toBe('23514');
      const noFailureCode = row(TENANT_A, { publish_status: 'FAILED', failure_code: null });
      expect(
        await errorCode(() =>
          repo.withTx(ctxFor(TENANT_A), (tx) => tx.insertPublishRecord(noFailureCode)),
        ),
      ).toBe('23514');
    });

    it('cannot mutate immutable provenance columns or delete publish records', async () => {
      const r = row(TENANT_A);
      await repo.withTx(ctxFor(TENANT_A), (tx) => tx.insertPublishRecord(r));
      expect(
        await errorCode(() =>
          asTenant(h.rt, TENANT_A, ACTOR_SYSTEM, (c) =>
            c.query(
              'UPDATE sf_digilocker.publish_record SET credential_id = $2 WHERE publish_request_id = $1',
              [r.publish_request_id, randomUUID()],
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await errorCode(() =>
          asTenant(h.rt, TENANT_A, ACTOR_SYSTEM, (c) =>
            c.query('DELETE FROM sf_digilocker.publish_record WHERE publish_request_id = $1', [
              r.publish_request_id,
            ]),
          ),
        ),
      ).toBe('42501');
    });
  });

  describe('idempotency claim / peek / complete', () => {
    it('claims once, replays the stored record, then round-trips the completed response', async () => {
      const principalId = randomUUID();
      const key = `int-key-${randomUUID()}`;
      const fingerprint = `sha256:${'a'.repeat(64)}`;
      const claim = { principalId, endpoint: ENDPOINT, key, fingerprint, now: NOW };

      expect(await repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(claim))).toBe(
        'claimed',
      );

      const replay = await repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(claim));
      expect(replay).not.toBe('claimed');
      expect(replay).toMatchObject({
        tenant_id: TENANT_A,
        principal_id: principalId,
        endpoint: ENDPOINT,
        idempotency_key: key,
        request_fingerprint: fingerprint,
        status: 'IN_PROGRESS',
        response_status: null,
        response_body: null,
        created_at: NOW.toISOString(),
        expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
      });

      const body = { publish_request_id: randomUUID(), publish_status: 'PUBLISHED' };
      await repo.withTx(ctxFor(TENANT_A), (tx) =>
        tx.completeIdempotency({ principalId, endpoint: ENDPOINT, key, status: 201, body }),
      );
      const peek = await repo.withTx(ctxFor(TENANT_A), (tx) =>
        tx.peekIdempotency({ principalId, endpoint: ENDPOINT, key }),
      );
      expect(peek).toMatchObject({
        status: 'COMPLETED',
        response_status: 201,
        response_body: body,
      });

      const again = await repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(claim));
      expect(again).toMatchObject({
        status: 'COMPLETED',
        response_status: 201,
        response_body: body,
      });

      expect(
        await repo.withTx(ctxFor(TENANT_A), (tx) =>
          tx.peekIdempotency({ principalId, endpoint: ENDPOINT, key: `other-${key}` }),
        ),
      ).toBeNull();
    });

    it('does not let tenant B see or replay tenant A idempotency records', async () => {
      const principalId = randomUUID();
      const key = `int-key-${randomUUID()}`;
      const claim = {
        principalId,
        endpoint: ENDPOINT,
        key,
        fingerprint: `sha256:${'b'.repeat(64)}`,
        now: NOW,
      };
      expect(await repo.withTx(ctxFor(TENANT_A), (tx) => tx.claimIdempotency(claim))).toBe(
        'claimed',
      );
      expect(
        await repo.withTx(ctxFor(TENANT_B), (tx) =>
          tx.peekIdempotency({ principalId, endpoint: ENDPOINT, key }),
        ),
      ).toBeNull();
      expect(await repo.withTx(ctxFor(TENANT_B), (tx) => tx.claimIdempotency(claim))).toBe(
        'claimed',
      );
    });
  });

  describe('tenant-negative (FORCE RLS)', () => {
    let t1: PublishRow;

    beforeAll(async () => {
      t1 = row(TENANT_A);
      await repo.withTx(ctxFor(TENANT_A), (tx) => tx.insertPublishRecord(t1));
    });

    it('a T1 record is invisible and unupdatable under T2', async () => {
      expect(
        await repo.withTx(ctxFor(TENANT_B), (tx) =>
          tx.getPublishRecord(TENANT_B, t1.publish_request_id),
        ),
      ).toBeNull();
      expect(
        await repo.withTx(ctxFor(TENANT_B), (tx) =>
          tx.updatePublishRecord(TENANT_B, t1.publish_request_id, {
            publish_status: 'FAILED',
            provider_transaction_ref: null,
            failure_code: 'SF-INT-001',
            attempt_number: 9,
          }),
        ),
      ).toBe(false);

      const raw = await asTenant(h.rt, TENANT_B, ACTOR_SYSTEM, async (c) => {
        const sel = await c.query(
          'SELECT 1 FROM sf_digilocker.publish_record WHERE publish_request_id = $1',
          [t1.publish_request_id],
        );
        const upd = await c.query(
          `UPDATE sf_digilocker.publish_record SET attempt_number = 9
            WHERE tenant_id = $1 AND publish_request_id = $2`,
          [TENANT_A, t1.publish_request_id],
        );
        return { sel: sel.rows.length, upd: upd.rowCount };
      });
      expect(raw).toEqual({ sel: 0, upd: 0 });

      const still = await repo.withTx(ctxFor(TENANT_A), (tx) =>
        tx.getPublishRecord(TENANT_A, t1.publish_request_id),
      );
      expect(still?.publish_status).toBe('PENDING');
      expect(still?.attempt_number).toBe(1);
    });

    it('sees nothing without a tenant context', async () => {
      const n = await asTenant(h.rt, null, ACTOR_SYSTEM, async (c) => {
        const r = await c.query('SELECT 1 FROM sf_digilocker.publish_record');
        return r.rows.length;
      });
      expect(n).toBe(0);
    });

    it('refuses writes whose tenant does not match the transaction tenant', async () => {
      const foreign = row(TENANT_A);
      expect(
        await errorCode(() =>
          repo.withTx(ctxFor(TENANT_B), (tx) => tx.insertPublishRecord(foreign)),
        ),
      ).toBe('SF-TEN-002');
      expect(
        await errorCode(() =>
          repo.withTx(ctxFor(TENANT_B), (tx) =>
            tx.getPublishRecord(TENANT_A, t1.publish_request_id),
          ),
        ),
      ).toBe('SF-TEN-002');
      expect(
        await errorCode(() =>
          repo.withTx(ctxFor(TENANT_B), (tx) =>
            tx.insertOutbox(domainEnvelope(TENANT_A, randomUUID()), TOPIC_DOMAIN),
          ),
        ),
      ).toBe('SF-TEN-002');

      // Bypassing the repository guard, RLS WITH CHECK still refuses the row.
      expect(
        await errorCode(() =>
          asTenant(h.rt, TENANT_B, ACTOR_SYSTEM, (c) =>
            c.query(
              `INSERT INTO sf_digilocker.idempotency_record (tenant_id, principal_id, endpoint,
                 idempotency_key, request_fingerprint, status, expires_at)
               VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now() + interval '1 day')`,
              [
                TENANT_A,
                randomUUID(),
                ENDPOINT,
                `int-key-${randomUUID()}`,
                `sha256:${'c'.repeat(64)}`,
              ],
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await errorCode(() =>
          asTenant(h.rt, TENANT_B, ACTOR_SYSTEM, async (c) => {
            const env = domainEnvelope(TENANT_A, randomUUID());
            await c.query(
              `INSERT INTO sf_digilocker.outbox_event (event_id, tenant_id, topic, partition_key,
                 event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)
               VALUES ($1,$2,$3,$4,$5,1,$6,$7,1,$8::jsonb)`,
              [
                env.event_id,
                TENANT_A,
                TOPIC_DOMAIN,
                env.aggregate_id,
                env.event_type,
                env.aggregate_type,
                env.aggregate_id,
                JSON.stringify(env),
              ],
            );
          }),
        ),
      ).toBe('42501');
      expect(await adminCount(h.admin, 'publishById', foreign.publish_request_id)).toBe(0);
    });

    it('rejects a transaction without tenant context before touching the database', async () => {
      const ctx = { ...ctxFor(TENANT_A), tenant_id: null } as unknown as ReturnType<typeof ctxFor>;
      expect(await errorCode(() => repo.withTx(ctx, () => Promise.resolve(1)))).toBe('SF-TEN-001');
    });
  });

  describe('privilege boundary (ADR-0006)', () => {
    const tables = [
      {
        select: 'SELECT 1 FROM sf_digilocker.publish_record LIMIT 1',
        del: 'DELETE FROM sf_digilocker.publish_record',
      },
      {
        select: 'SELECT 1 FROM sf_digilocker.idempotency_record LIMIT 1',
        del: 'DELETE FROM sf_digilocker.idempotency_record',
      },
    ] as const;

    for (const which of ['peer', 'appOnly'] as const) {
      it(`${which} login cannot read or write CMP-012 tables`, async () => {
        const pool = h[which];
        for (const t of tables) {
          expect(
            await errorCode(() => asTenant(pool, TENANT_A, ACTOR_SYSTEM, (c) => c.query(t.select))),
          ).toBe('42501');
          expect(
            await errorCode(() => asTenant(pool, TENANT_A, ACTOR_SYSTEM, (c) => c.query(t.del))),
          ).toBe('42501');
        }
        const r = row(TENANT_A);
        const peerRepo = new PgDigilockerRepository(asSqlPool(pool));
        expect(
          await errorCode(() =>
            peerRepo.withTx(ctxFor(TENANT_A), (tx) => tx.insertPublishRecord(r)),
          ),
        ).toBe('42501');
        expect(
          await errorCode(() =>
            peerRepo.withTx(ctxFor(TENANT_A), (tx) =>
              tx.updatePublishRecord(TENANT_A, r.publish_request_id, {
                publish_status: 'FAILED',
                provider_transaction_ref: null,
                failure_code: 'SF-INT-001',
                attempt_number: 2,
              }),
            ),
          ),
        ).toBe('42501');
        expect(
          await errorCode(() =>
            peerRepo.withTx(ctxFor(TENANT_A), (tx) =>
              tx.claimIdempotency({
                principalId: randomUUID(),
                endpoint: ENDPOINT,
                key: `int-key-${randomUUID()}`,
                fingerprint: `sha256:${'d'.repeat(64)}`,
                now: NOW,
              }),
            ),
          ),
        ).toBe('42501');
      });
    }

    it('runtime login is not the table owner and cannot bypass RLS', async () => {
      const r = await h.admin.query(
        `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_digilocker' AND c.relname = ANY($1::text[])`,
        [['publish_record', 'idempotency_record', 'outbox_event']],
      );
      expect(r.rows).toHaveLength(3);
      for (const t of r.rows) {
        expect(t['owner']).toBe('sf_migrator');
        expect(t['forced']).toBe(true);
      }
      const role = await h.admin.query(
        `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sf_t012_rt'`,
      );
      expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    });
  });

  describe('inTransaction()', () => {
    it('is true only inside withTx', async () => {
      expect(repo.inTransaction()).toBe(false);
      const inside = await repo.withTx(ctxFor(TENANT_A), () =>
        Promise.resolve(repo.inTransaction()),
      );
      expect(inside).toBe(true);
      expect(repo.inTransaction()).toBe(false);
      await errorCode(() => repo.withTx(ctxFor(TENANT_A), () => Promise.reject(new Error('x'))));
      expect(repo.inTransaction()).toBe(false);
    });

    it('refuses a nested withTx', async () => {
      const nested = await errorCode(() =>
        repo.withTx(ctxFor(TENANT_A), () =>
          repo.withTx(ctxFor(TENANT_A), () => Promise.resolve(1)),
        ),
      );
      expect(nested).toBe('SF-SYS-001');
    });
  });

  describe('DigiLockerService publish flow on PostgreSQL (SIMULATED connector)', () => {
    function build(scenario = 'digilocker_publish') {
      const api = new ProbedConnector(repo, marker(scenario));
      const credentialVerification = new FakeCredentialVerificationPort(TENANT_A);
      const service = buildDigiLockerService({
        repository: repo,
        authorizer: new AllowAllAuthorizer(),
        connectorBinding: new FakeConnectorBindingPort('CI'),
        credentialVerification,
        digilockerApi: api,
        runtimeEnvironment: 'CI',
        clock: () => NOW,
      });
      return { service, api, credentialVerification };
    }

    const input = {
      credential_id: CREDENTIAL_ID,
      consent_ref: CONSENT_REF,
      purpose_code: PURPOSE_CODE,
      document_type_ref: DOCUMENT_TYPE_REF,
      test_run_id: TEST_RUN_ID,
    };
    const idemFor = (key: string) => ({
      key,
      endpoint: ENDPOINT,
      fingerprint: requestFingerprint('POST', '/v1/digilocker-publish', input),
    });

    it('publishes, persists the record + domain/audit outbox, and replays idempotently', async () => {
      const { service, api } = build();
      const ctx = ctxFor(TENANT_A, ACTOR_SYSTEM, 'SYSTEM');
      const idem = idemFor(`int-key-${randomUUID()}`);

      const first = await service.publishCredential(ctx, input, idem);
      expect(first.status).toBe(201);
      const body = first.body as Body;
      expect(body['publish_status']).toBe('PUBLISHED');
      expect(body['connector_mode']).toBe('SIMULATED');
      expect(body['issuance_reversed_on_publish_failure']).toBe(false);
      expect(body['registry_status_changed_by_publish']).toBe(false);
      expect(api.txStateAtCall).toEqual([false]);
      const id = String(body['publish_request_id']);

      const stored = await repo.withTx(ctx, (tx) => tx.getPublishRecord(TENANT_A, id));
      expect(stored).toMatchObject({
        tenant_id: TENANT_A,
        publish_status: 'PUBLISHED',
        connector_mode: 'SIMULATED',
        idempotency_key: idem.key,
        created_by: ACTOR_SYSTEM,
      });
      expect((stored?.simulation_marker as Body)['simulation']).toBe(true);

      const domain = await h.admin.query(
        `SELECT event_type FROM sf_digilocker.outbox_event WHERE aggregate_id = $1 AND topic = $2`,
        [id, TOPIC_DOMAIN],
      );
      expect(domain.rows.map((r) => r['event_type'])).toEqual(['DigiLockerPublishSucceeded']);
      const audit = await h.admin.query(
        `SELECT envelope FROM sf_digilocker.outbox_event_platform
          WHERE topic = 'sf.audit.ingest.v1' AND envelope -> 'data' ->> 'resource_id' = $1`,
        [id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(((audit.rows[0]?.['envelope'] as Body)['data'] as Body)['tenant_id']).toBe(TENANT_A);

      const replay = await service.publishCredential(ctx, input, idem);
      expect(replay).toEqual(first);
      expect(api.txStateAtCall).toEqual([false]);
      expect(await adminCount(h.admin, 'publishByKey', idem.key)).toBe(1);

      const mismatch = await errorCode(() =>
        service.publishCredential(
          ctx,
          { ...input, purpose_code: 'OTHER_PURPOSE' },
          {
            ...idem,
            fingerprint: requestFingerprint('POST', '/v1/digilocker-publish', {
              ...input,
              purpose_code: 'OTHER_PURPOSE',
            }),
          },
        ),
      );
      expect(mismatch).toBe('SF-APP-002');

      const read = await service.getPublishRecord(ctx, id);
      expect(read).toEqual({ status: 200, body: first.body });
      expect(await errorCode(() => service.getPublishRecord(ctxFor(TENANT_B), id))).toBe(
        'SF-SYS-002',
      );
    });

    it('records a FAILED publish without reversing issuance', async () => {
      const { service, credentialVerification } = build('digilocker_publish_fail');
      const ctx = ctxFor(TENANT_A, ACTOR_SYSTEM, 'SYSTEM');
      const res = await service.publishCredential(ctx, input, idemFor(`int-key-${randomUUID()}`));
      expect(res.status).toBe(201);
      const body = res.body as Body;
      expect(body['publish_status']).toBe('FAILED');
      expect(body['failure_code']).toBe('SF-INT-001');
      const id = String(body['publish_request_id']);
      const stored = await h.admin.query(
        `SELECT publish_status, failure_code, issuance_reversed_on_publish_failure,
                registry_status_changed_by_publish
           FROM sf_digilocker.publish_record WHERE publish_request_id = $1`,
        [id],
      );
      expect(stored.rows[0]).toEqual({
        publish_status: 'FAILED',
        failure_code: 'SF-INT-001',
        issuance_reversed_on_publish_failure: false,
        registry_status_changed_by_publish: false,
      });
      expect(credentialVerification.result.lifecycle).toBe('ISSUED');
      const ev = await h.admin.query(
        `SELECT event_type FROM sf_digilocker.outbox_event WHERE aggregate_id = $1`,
        [id],
      );
      expect(ev.rows.map((r) => r['event_type'])).toEqual(['DigiLockerPublishFailed']);
    });

    it('persists nothing when the credential is not ISSUED (fail-closed)', async () => {
      const { service, credentialVerification, api } = build();
      credentialVerification.result = { ...credentialVerification.result, lifecycle: 'SIGNED' };
      const key = `int-key-${randomUUID()}`;
      const err = await errorCode(() =>
        service.publishCredential(ctxFor(TENANT_A), input, idemFor(key)),
      );
      expect(err).not.toBe('allowed');
      expect(api.txStateAtCall).toEqual([]);
      expect(await adminCount(h.admin, 'publishByKey', key)).toBe(0);
      expect(await adminCount(h.admin, 'idempotencyByKey', key)).toBe(0);
    });
  });
});
