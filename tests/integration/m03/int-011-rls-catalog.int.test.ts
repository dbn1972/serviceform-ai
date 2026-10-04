import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  T1,
  T2,
  asTenant,
  createLogin,
  dropRoles,
  migrateUp,
  rolePassword,
  runtimePool,
  withAdmin,
} from './pg-harness.js';

const ROLES = [
  'sf_m03rls_001',
  'sf_m03rls_033',
  'sf_m03rls_034',
  'sf_m03rls_051',
  'sf_m03rls_052',
  'sf_m03rls_053',
] as const;

const HASH = `sha256:${'ab'.repeat(32)}`;

describe('INT-011 M03 LOGIN RLS catalog (independent)', () => {
  const password = rolePassword();
  const leaks: string[] = [];
  let p001: ReturnType<typeof runtimePool>;
  let p033: ReturnType<typeof runtimePool>;
  let p034: ReturnType<typeof runtimePool>;
  let p051: ReturnType<typeof runtimePool>;
  let p052: ReturnType<typeof runtimePool>;
  let p053: ReturnType<typeof runtimePool>;

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await dropRoles(c, ROLES);
    });
    migrateUp();
    await withAdmin(async (c) => {
      await createLogin(c, 'sf_m03rls_001', 'sf_cmp001_rw', password);
      await createLogin(c, 'sf_m03rls_033', 'sf_cmp033_rw', password);
      await createLogin(c, 'sf_m03rls_034', 'sf_cmp034_rw', password);
      await createLogin(c, 'sf_m03rls_051', 'sf_cmp051_rw', password);
      await createLogin(c, 'sf_m03rls_052', 'sf_cmp052_rw', password);
      await createLogin(c, 'sf_m03rls_053', 'sf_cmp053_rw', password);
    });
    p001 = runtimePool('sf_m03rls_001', password);
    p033 = runtimePool('sf_m03rls_033', password);
    p034 = runtimePool('sf_m03rls_034', password);
    p051 = runtimePool('sf_m03rls_051', password);
    p052 = runtimePool('sf_m03rls_052', password);
    p053 = runtimePool('sf_m03rls_053', password);
  }, 120_000);

  afterAll(async () => {
    await Promise.all([p001.end(), p033.end(), p034.end(), p051.end(), p052.end(), p053.end()]);
    const leakage = leaks.length;
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakage);
    mkdirSync('test-results/m03-int', { recursive: true });
    writeFileSync(
      'test-results/m03-int/cross-tenant.json',
      JSON.stringify(
        {
          CROSS_TENANT_LEAKAGE: leakage,
          leaks,
          commit_sha: process.env['M03_COMMIT_SHA'] ?? '',
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('tenant-scoped M03 tables hide T1 rows from T2 LOGIN sessions', async () => {
    const categoryId = randomUUID();
    const serviceId = randomUUID();
    const offeringId = randomUUID();
    await asTenant(p001, null, ACTOR, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.category (category_id, category_code, display_label, status, created_by)
         VALUES ($1,'FAMILY_M03','Family','ACTIVE',$2)
         ON CONFLICT (category_code) DO NOTHING`,
        [categoryId, ACTOR],
      );
      const cat = await c.query<{ category_id: string }>(
        `SELECT category_id FROM sf_catalogue.category WHERE category_code = 'FAMILY_M03'`,
      );
      const cid = cat.rows[0]?.category_id ?? categoryId;
      await c.query(
        `INSERT INTO sf_catalogue.canonical_service
           (canonical_service_id, service_code, category_id, status, created_by)
         VALUES ($1,'svc-m03int',$2,'DRAFT',$3)
         ON CONFLICT (service_code) DO NOTHING`,
        [serviceId, cid, ACTOR],
      );
    });
    const svc = await asTenant(p001, null, ACTOR, async (c) => {
      const r = await c.query<{ canonical_service_id: string }>(
        `SELECT canonical_service_id FROM sf_catalogue.canonical_service WHERE service_code = 'svc-m03int'`,
      );
      return r.rows[0]!.canonical_service_id;
    });
    await asTenant(p001, T1, ACTOR, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.offering
           (tenant_id, offering_id, canonical_service_id, offering_code, created_by)
         VALUES ($1,$2,$3,'off-m03',$4)`,
        [T1, offeringId, svc, ACTOR],
      );
    });
    const offT2 = await asTenant(p001, T2, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT offering_id FROM sf_catalogue.offering WHERE offering_id = $1`,
        [offeringId],
      );
      return r.rowCount ?? 0;
    });
    if (offT2 > 0) leaks.push('CMP-001 offering');

    const docId = randomUUID();
    await asTenant(p033, T1, ACTOR, async (c) => {
      await c.query(
        `INSERT INTO sf_metadata.metadata_document (
           document_id, tenant_id, cell_id, document_key, kind, schema_id, payload, payload_hash,
           status, created_by
         ) VALUES ($1,$2,'cell-01','generic.rls','SERVICE','sf.metadata.kind.service.v1','{"code":"generic_service"}',$3,'DRAFT',$4)`,
        [docId, T1, HASH, ACTOR],
      );
    });
    const docT2 = await asTenant(p033, T2, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT document_id FROM sf_metadata.metadata_document WHERE document_id = $1`,
        [docId],
      );
      return r.rowCount ?? 0;
    });
    if (docT2 > 0) leaks.push('CMP-033 metadata_document');

    const setId = randomUUID();
    await asTenant(p034, T1, ACTOR, async (c) => {
      await c.query(
        `INSERT INTO sf_master_data.code_set
           (tenant_id, code_set_id, set_code, localization_key, status, created_by)
         VALUES ($1,$2,'SET_M03','md.set_m03','ACTIVE',$3)`,
        [T1, setId, ACTOR],
      );
    });
    const setT2 = await asTenant(p034, T2, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT code_set_id FROM sf_master_data.code_set WHERE code_set_id = $1`,
        [setId],
      );
      return r.rowCount ?? 0;
    });
    if (setT2 > 0) leaks.push('CMP-034 code_set');

    const reqId = randomUUID();
    await asTenant(p051, T1, ACTOR, async (c) => {
      await c.query(
        `INSERT INTO sf_maker_checker.publication_request (
           request_id, tenant_id, cell_id, subject_type, subject_id, proposed_hash, status, maker_principal_id
         ) VALUES ($1,$2,'cell-01','TENANT_SERVICE_BINDING',$3,$4,'DRAFT',$5)`,
        [reqId, T1, randomUUID(), HASH, ACTOR],
      );
    });
    const reqT2 = await asTenant(p051, T2, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT request_id FROM sf_maker_checker.publication_request WHERE request_id = $1`,
        [reqId],
      );
      return r.rowCount ?? 0;
    });
    if (reqT2 > 0) leaks.push('CMP-051 publication_request');

    const bindId = randomUUID();
    const pins = {
      service: { version_ref: 'service.v1', content_hash: HASH },
      offering: { version_ref: 'offering.v1', content_hash: HASH },
      form: { version_ref: 'form.v1', content_hash: HASH },
      rules: { version_ref: 'rules.v1', content_hash: HASH },
      evidence: { version_ref: 'evidence.v1', content_hash: HASH },
      fee: { version_ref: 'fee.v1', content_hash: HASH },
      workflow: { version_ref: 'workflow.v1', content_hash: HASH },
      sla: { version_ref: 'sla.v1', content_hash: HASH },
      access: { version_ref: 'access.v1', content_hash: HASH },
      credential: { version_ref: 'credential.v1', content_hash: HASH },
      notification: { version_ref: 'notification.v1', content_hash: HASH },
      authorization_policy: { version_ref: 'authorization_policy.v1', content_hash: HASH },
    };
    await asTenant(p052, T1, ACTOR, async (c) => {
      await c.query(
        `INSERT INTO sf_versioning.tenant_service_binding (
           binding_id, tenant_id, cell_id, binding_key, offering_ref, metadata_bundle_ref,
           pins, dependency_graph, artifact_hash, status, created_by
         ) VALUES ($1,$2,'cell-01','generic.rls','off-ref','bundle-ref',$3::jsonb,'{}'::jsonb,$4,'DRAFT',$5)`,
        [bindId, T1, JSON.stringify(pins), HASH, ACTOR],
      );
    });
    const bindT2 = await asTenant(p052, T2, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT binding_id FROM sf_versioning.tenant_service_binding WHERE binding_id = $1`,
        [bindId],
      );
      return r.rowCount ?? 0;
    });
    if (bindT2 > 0) leaks.push('CMP-052 tenant_service_binding');

    const locId = randomUUID();
    await asTenant(p053, T1, ACTOR, async (c) => {
      await c.query(
        `INSERT INTO sf_localization.locale
           (tenant_id, locale_id, locale_tag, is_default, status, created_by)
         VALUES ($1,$2,'en',true,'ACTIVE',$3)`,
        [T1, locId, ACTOR],
      );
    });
    const locT2 = await asTenant(p053, T2, ACTOR, async (c) => {
      const r = await c.query(`SELECT locale_id FROM sf_localization.locale WHERE locale_id = $1`, [
        locId,
      ]);
      return r.rowCount ?? 0;
    });
    if (locT2 > 0) leaks.push('CMP-053 locale');

    expect(leaks).toEqual([]);
    expect(leaks.length).toBe(0);
  });
});
