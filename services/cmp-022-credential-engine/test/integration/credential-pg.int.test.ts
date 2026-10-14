import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCredentialApi, type ApiResponse } from '../../src/api/handler.js';
import { credentialIdFor } from '../../src/domain/credential.js';
import { buildCredentialService } from '../../src/index.js';
import type { TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  APPLICATION_ID,
  ctxFor,
  FakeCasePins,
  FakeRegistry,
  FakeRenderer,
  FakeSigner,
  ISSUANCE_KEY,
  pins,
  simulatedFailed,
  TENANT_A,
  TENANT_B,
  TxProbe,
} from '../doubles/fixtures.js';
import {
  asSqlPool,
  asTenant,
  closeHarness,
  migrate,
  migrateDown,
  setupHarness,
  type Harness,
} from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACTOR = '77777777-7777-4777-8777-777777777777';

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? `error:${String(e)}`;
  }
}

function stack(h: Harness) {
  const probe = new TxProbe();
  const casePins = new FakeCasePins(probe);
  casePins.set(TENANT_B, pins());
  const signer = new FakeSigner(probe);
  const registry = new FakeRegistry(probe);
  const service = buildCredentialService({
    pool: asSqlPool(h.rt),
    authorizer: new AllowAllAuthorizer(),
    casePins,
    renderer: new FakeRenderer(probe),
    signing: signer,
    registry,
    environment: 'CI',
  });
  const ctx: { value: TenantContext } = { value: ctxFor(TENANT_A) };
  const api = createCredentialApi({ service, resolveContext: () => Promise.resolve(ctx.value) });
  let n = 0;
  const call = (
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<ApiResponse> => {
    n += 1;
    return api.handle({
      method,
      path,
      headers:
        method === 'POST' ? { 'idempotency-key': key ?? `int-key-${randomUUID()}-${n}` } : {},
      body,
    });
  };
  return { call, ctx, signer, registry };
}

describe('CMP-022 on PostgreSQL: privilege boundary, FORCE RLS, forward-only lifecycle', () => {
  let h: Harness;
  const ISSUE = { application_id: APPLICATION_ID, issuance_key: ISSUANCE_KEY };
  const ID_A = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles are NOLOGIN/NOBYPASSRLS and every tenant table is FORCE RLS, owned by sf_migrator', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('sf_cmp022_rw', 'sf_t022_rt')`,
    );
    expect(roles.rows).toHaveLength(2);
    for (const r of roles.rows) {
      expect(r['rolsuper']).toBe(false);
      expect(r['rolbypassrls']).toBe(false);
      if (r['rolname'] === 'sf_cmp022_rw') expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_credential' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.map((t) => t['relname'])).toEqual([
      'credential',
      'credential_artifact',
      'downstream_outcome',
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
      'signing_record',
    ]);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) expect(t['forced']).toBe(true);
    }
    const grants = await h.admin.query(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_credential' AND grantee NOT IN ('sf_migrator', 'sf_outbox_publisher')
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')
          AND table_name <> 'idempotency_record'`,
    );
    expect(grants.rows).toEqual([]);
  });

  it('issues end-to-end through the runtime login and writes outbox rows in the same commits', async () => {
    const s = stack(h);
    const res = await s.call('POST', '/v1/credentials', ISSUE, 'int-issue-0001');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ credential_id: ID_A, lifecycle_status: 'ISSUED' });
    const replay = await s.call('POST', '/v1/credentials', ISSUE, 'int-issue-0001');
    expect(replay.body).toEqual(res.body);
    const again = await s.call('POST', '/v1/credentials', ISSUE);
    expect(again.status).toBe(200);
    const producerRead = await code(() =>
      asTenant(h.rt, TENANT_A, ACTOR, (c) => c.query('SELECT 1 FROM sf_credential.outbox_event')),
    );
    expect(producerRead).toBe('42501');
    const events = await h.admin.query(
      `SELECT event_type FROM sf_credential.outbox_event
        WHERE tenant_id = $1 AND topic = 'sf.credential.events.v1' ORDER BY seq`,
      [TENANT_A],
    );
    expect(events.rows.map((r) => r['event_type'])).toEqual([
      'CredentialGenerated',
      'CredentialSigned',
      'CredentialIssued',
    ]);
  });

  it('tenant B sees none of tenant A rows and cannot write rows for tenant A', async () => {
    const counts = await asTenant(h.rt, TENANT_B, ACTOR, (c) =>
      c.query(
        `SELECT (SELECT count(*) FROM sf_credential.credential) AS c,
                (SELECT count(*) FROM sf_credential.credential_artifact) AS a,
                (SELECT count(*) FROM sf_credential.signing_record) AS s,
                (SELECT count(*) FROM sf_credential.idempotency_record) AS i`,
      ),
    );
    expect(counts.rows[0]).toEqual({ c: '0', a: '0', s: '0', i: '0' });
    const forged = await code(() =>
      asTenant(h.rt, TENANT_B, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_credential.credential (tenant_id, credential_id, application_id, cell_id,
             tenant_service_binding_id, service_version_id, credential_template_id,
             credential_template_version, lifecycle_status, issuance_key, idempotency_key,
             approval_decision_ref, correlation_id, actor_type, created_by, generated_at)
           VALUES ($1,$2,$3,'cell-01',$2,$2,$2,1,'GENERATED','forged-key-01','forged-key-01','ref',$2,'SYSTEM',$2,now())`,
          [TENANT_A, randomUUID(), APPLICATION_ID],
        ),
      ),
    );
    expect(forged).toBe('42501');
    const noTenant = await asTenant(h.rt, null, ACTOR, (c) =>
      c.query('SELECT count(*) AS n FROM sf_credential.credential'),
    );
    expect(noTenant.rows[0]?.['n']).toBe('0');
    const s = stack(h);
    s.ctx.value = ctxFor(TENANT_B);
    const read = await s.call('GET', `/v1/credentials/${ID_A}`);
    expect(read.status).toBe(404);
  });

  it('a peer component login cannot read sf_credential', async () => {
    const peer = await code(() =>
      asTenant(h.other, TENANT_A, ACTOR, (c) => c.query('SELECT 1 FROM sf_credential.credential')),
    );
    expect(peer).toBe('42501');
  });

  it('the database refuses lifecycle reversal, provenance edits, deletes and late attachments', async () => {
    const attempt = (sql: string, values: unknown[] = []): Promise<string> =>
      code(() => asTenant(h.rt, TENANT_A, ACTOR, (c) => c.query(sql, values)));
    expect(
      await attempt(
        `UPDATE sf_credential.credential SET lifecycle_status = 'GENERATED', signing_record_id = NULL, signed_at = NULL, issued_at = NULL WHERE credential_id = $1`,
        [ID_A],
      ),
    ).toBe('55000');
    expect(
      await attempt(
        `UPDATE sf_credential.credential SET lifecycle_status = 'SIGNED', issued_at = NULL WHERE credential_id = $1`,
        [ID_A],
      ),
    ).toBe('55000');
    expect(
      await attempt(
        `UPDATE sf_credential.credential SET approval_decision_ref = 'x' WHERE credential_id = $1`,
        [ID_A],
      ),
    ).toBe('42501');
    expect(
      await attempt(`DELETE FROM sf_credential.credential WHERE credential_id = $1`, [ID_A]),
    ).toBe('42501');
    expect(
      await attempt(
        `UPDATE sf_credential.signing_record SET failure_code = 'SF-CRED-001' WHERE credential_id = $1`,
        [ID_A],
      ),
    ).toBe('42501');
    expect(
      await attempt(
        `UPDATE sf_credential.credential_artifact SET sha256 = $2 WHERE credential_id = $1`,
        [ID_A, 'c'.repeat(64)],
      ),
    ).toBe('42501');
    expect(
      await attempt(
        `INSERT INTO sf_credential.signing_record (tenant_id, signing_record_id, credential_id,
           connector_binding_id, connector_mode, signing_result, failure_code, attempt_number,
           idempotency_key, correlation_id, recorded_at)
         VALUES ($1,$2,$3,$2,'REAL','FAILED','SF-CRED-001',9,'late-attempt-9',$2,now())`,
        [TENANT_A, randomUUID(), ID_A],
      ),
    ).toBe('55000');
    const state = await asTenant(h.rt, TENANT_A, ACTOR, (c) =>
      c.query('SELECT lifecycle_status FROM sf_credential.credential WHERE credential_id = $1', [
        ID_A,
      ]),
    );
    expect(state.rows[0]?.['lifecycle_status']).toBe('ISSUED');
  });

  it('a credential cannot be created non-GENERATED or SIGNED without a matching signed attempt', async () => {
    const id = randomUUID();
    const insert = (status: string): Promise<string> =>
      code(() =>
        asTenant(h.rt, TENANT_A, ACTOR, (c) =>
          c.query(
            `INSERT INTO sf_credential.credential (tenant_id, credential_id, application_id, cell_id,
               tenant_service_binding_id, service_version_id, credential_template_id,
               credential_template_version, lifecycle_status, issuance_key, idempotency_key,
               approval_decision_ref, correlation_id, actor_type, created_by, generated_at, issued_at)
             VALUES ($1,$2,$3,'cell-01',$2,$2,$2,1,$4,'raw-key-0001','raw-key-0001','ref',$2,'SYSTEM',$2,now(),
               CASE WHEN $4 = 'ISSUED' THEN now() END)`,
            [TENANT_A, id, randomUUID(), status],
          ),
        ),
      );
    expect(await insert('ISSUED')).toBe('55000');
    expect(await insert('GENERATED')).toBe('allowed');
    const failedAttempt = randomUUID();
    const forced = await code(() =>
      asTenant(h.rt, TENANT_A, ACTOR, async (c) => {
        await c.query(
          `INSERT INTO sf_credential.signing_record (tenant_id, signing_record_id, credential_id,
             connector_binding_id, connector_mode, signing_result, failure_code, attempt_number,
             idempotency_key, correlation_id, recorded_at)
           VALUES ($1,$2,$3,$2,'REAL','FAILED','SF-CRED-001',1,'raw-attempt-1',$2,now())`,
          [TENANT_A, failedAttempt, id],
        );
        await c.query(
          `UPDATE sf_credential.credential SET lifecycle_status = 'SIGNED', signing_record_id = $2, signed_at = now()
            WHERE credential_id = $1`,
          [id, failedAttempt],
        );
      }),
    );
    expect(forced).toBe('55000');
    const binding = randomUUID();
    const simulatedInProd = await code(() =>
      asTenant(h.rt, TENANT_A, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_credential.signing_record (tenant_id, signing_record_id, credential_id,
             connector_binding_id, connector_mode, simulation_marker, signing_result, failure_code,
             attempt_number, idempotency_key, correlation_id, recorded_at)
           VALUES ($1,$2,$3,$2,'SIMULATED',
             jsonb_build_object('simulation', true, 'scenario', 'x_y', 'test_run_id', 't',
               'connector_binding_id', $4::text, 'environment', 'PRODUCTION'),
             'FAILED','SF-CRED-001',2,'raw-attempt-2',$2,now())`,
          [TENANT_A, binding, id, binding],
        ),
      ),
    );
    expect(simulatedInProd).toBe('23514');
  });

  it('a FAILED publish outcome is stored and the credential remains ISSUED', async () => {
    const s = stack(h);
    s.ctx.value = ctxFor(TENANT_A, ACTOR, 'INTEGRATION');
    const res = await s.call('POST', `/v1/credentials/${ID_A}/downstream-outcomes`, {
      channel: 'DIGILOCKER_PUBLISH',
      outcome: 'FAILED',
      outcome_ref: 'publish:int-0001',
      failure_code: 'SF-INT-001',
    });
    expect(res.status).toBe(201);
    const row = await asTenant(h.rt, TENANT_A, ACTOR, (c) =>
      c.query(
        'SELECT lifecycle_status, issued_at FROM sf_credential.credential WHERE credential_id = $1',
        [ID_A],
      ),
    );
    expect(row.rows[0]?.['lifecycle_status']).toBe('ISSUED');
    expect(row.rows[0]?.['issued_at']).not.toBeNull();
  });

  it('concurrent issuance of one issuance_key converges on one credential and one signed attempt', async () => {
    const s = stack(h);
    s.ctx.value = ctxFor(TENANT_B);
    const results = await Promise.all([
      s.call('POST', '/v1/credentials', ISSUE),
      s.call('POST', '/v1/credentials', ISSUE),
      s.call('POST', '/v1/credentials', ISSUE),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((x) => x === 201)).toHaveLength(1);
    for (const r of results) {
      expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
      expect((r.body as Body)['credential_id']).toBe(
        credentialIdFor(TENANT_B, APPLICATION_ID, ISSUANCE_KEY),
      );
    }
    const rows = await asTenant(h.rt, TENANT_B, ACTOR, (c) =>
      c.query(
        `SELECT (SELECT count(*) FROM sf_credential.credential) AS c,
                (SELECT count(*) FROM sf_credential.signing_record) AS s`,
      ),
    );
    expect(rows.rows[0]).toEqual({ c: '1', s: '1' });
    const issuedEvents = await h.admin.query(
      `SELECT count(*) AS e FROM sf_credential.outbox_event WHERE tenant_id = $1 AND event_type = 'CredentialIssued'`,
      [TENANT_B],
    );
    expect(issuedEvents.rows[0]?.['e']).toBe('1');
  });

  it('a FAILED signing attempt persists through PostgreSQL and the retry issues', async () => {
    const s = stack(h);
    s.signer.script = [simulatedFailed];
    const body = { application_id: APPLICATION_ID, issuance_key: 'int-retry-key-01' };
    const failed = await s.call('POST', '/v1/credentials', body, 'int-retry-0001');
    expect(failed.status).toBe(503);
    const ok = await s.call('POST', '/v1/credentials', body, 'int-retry-0001');
    expect(ok.status).toBe(201);
    const id = (ok.body as Body)['credential_id'] as string;
    const records = await s.call('GET', `/v1/credentials/${id}/signing-records`);
    expect(
      ((records.body as Body)['signing_records'] as Body[]).map((r) => r['signing_result']),
    ).toEqual(['FAILED', 'SIGNED']);
  });

  it('migrations go down and up again (rollback path)', () => {
    migrateDown(2);
    migrate();
  });
});
