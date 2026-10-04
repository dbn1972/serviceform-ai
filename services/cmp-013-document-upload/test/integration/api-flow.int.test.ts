import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate, type EventEnvelope } from '@serviceform/contracts';
import { SIMULATED_MALWARE_SIGNATURE } from '../../src/adapters/simulated-scanner.js';
import { PgUploadRepository } from '../../src/repo/pg.js';
import {
  CANARY,
  T1,
  T2,
  buildHarness,
  idem,
  pdfBytes,
  type Harness as AppHarness,
} from '../doubles/fixtures.js';
import {
  complete,
  createPolicy,
  getDoc,
  openSession,
  putBytes,
  scanRequestFor,
} from '../doubles/flow.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

describe('CMP-013 API over PostgreSQL FORCE RLS (runtime role sf_app + sf_cmp013_rw)', () => {
  let db: Harness;
  let h: AppHarness;
  let repo: PgUploadRepository;

  async function outbox(tenant: string): Promise<EventEnvelope<object>[]> {
    const r = await db.admin.query<{ envelope: EventEnvelope<object> }>(
      `SELECT envelope FROM sf_upload.outbox_event
        WHERE tenant_id = $1 AND topic = 'sf.upload.events.v1' ORDER BY seq`,
      [tenant],
    );
    return r.rows.map((row) => row.envelope);
  }

  beforeAll(async () => {
    db = await setupHarness();
    repo = new PgUploadRepository(db.rt);
    h = await buildHarness(repo);
    expect((await createPolicy(h, 't1-officer')).statusCode).toBe(201);
    expect((await createPolicy(h, 't2-officer')).statusCode).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await h?.app.close();
    await closeHarness(db);
  });

  it('happy path: session -> direct PUT -> complete -> CLEAN scan -> download', async () => {
    const bytes = pdfBytes();
    const { res, body } = await openSession(h, 't1-citizen', bytes);
    expect(res.statusCode).toBe(201);
    await putBytes(h, body.upload, bytes);
    const done = await complete(h, 't1-citizen', body.document_id);
    expect(done.json()).toMatchObject({ status: 'SCAN_PENDING' });
    expect((await getDoc(h, 't1-citizen', body.document_id, '/access')).statusCode).toBe(422);
    const evt = scanRequestFor(await outbox(T1), body.document_id);
    expect(await h.service.processScanRequest(evt)).toBe('AVAILABLE');
    expect(await h.service.processScanRequest(evt)).toBe('DUPLICATE');
    const access = await getDoc(h, 't1-citizen', body.document_id, '/access');
    expect(access.statusCode).toBe(200);
    const scans = await db.admin.query(
      'SELECT verdict FROM sf_upload.document_scan_status WHERE document_id = $1',
      [body.document_id],
    );
    expect(scans.rows).toEqual([{ verdict: 'CLEAN' }]);
    expect(h.probe.calls.filter((c) => c.inTx)).toEqual([]);
    const rows = await db.admin.query<{ envelope: EventEnvelope<object> }>(
      'SELECT envelope FROM sf_upload.outbox_event WHERE tenant_id = $1',
      [T1],
    );
    for (const r of rows.rows) {
      expect(validate('event-envelope', r.envelope).valid).toBe(true);
      const text = JSON.stringify(r.envelope);
      expect(text).not.toContain('sim://');
      expect(text).not.toContain('sig=');
      expect(text).not.toContain('test-only-hmac-key');
    }
    const idemRows = await db.admin.query<{ response_body: unknown }>(
      'SELECT response_body FROM sf_upload.idempotency_record WHERE tenant_id = $1',
      [T1],
    );
    expect(JSON.stringify(idemRows.rows)).not.toContain('sim://');
  });

  it('idempotent session replay creates exactly one document row', async () => {
    const bytes = pdfBytes('replay');
    const headers = idem('pg-replay');
    const a = await openSession(h, 't1-citizen', bytes, {}, headers);
    const b = await openSession(h, 't1-citizen', bytes, {}, headers);
    expect(b.body.document_id).toBe(a.body.document_id);
    const count = await db.admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sf_upload.document_metadata WHERE document_id = $1',
      [a.body.document_id],
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('checksum mismatch and malware are rejected and never downloadable', async () => {
    const declared = pdfBytes('declared');
    const s1 = await openSession(h, 't1-citizen', declared);
    await putBytes(h, s1.body.upload, pdfBytes('tampered'));
    const bad = await complete(h, 't1-citizen', s1.body.document_id);
    expect(bad.json()).toMatchObject({ details: [{ code: 'CHECKSUM_MISMATCH' }] });

    const infected = pdfBytes(SIMULATED_MALWARE_SIGNATURE);
    const s2 = await openSession(h, 't1-citizen', infected);
    await putBytes(h, s2.body.upload, infected);
    await complete(h, 't1-citizen', s2.body.document_id);
    const evt = scanRequestFor(await outbox(T1), s2.body.document_id);
    expect(await h.service.processScanRequest(evt)).toBe('REJECTED');
    for (const id of [s1.body.document_id, s2.body.document_id]) {
      expect((await getDoc(h, 't1-citizen', id, '/access')).statusCode).toBe(422);
    }
    const states = await db.admin.query<{ status: string; rejection_code: string }>(
      `SELECT status, rejection_code FROM sf_upload.document_metadata WHERE document_id = ANY($1::uuid[])
        ORDER BY created_at, rejection_code`,
      [[s1.body.document_id, s2.body.document_id]],
    );
    expect(states.rows.map((r) => r.rejection_code).sort()).toEqual(
      ['CHECKSUM_MISMATCH', 'MALWARE_DETECTED'].sort(),
    );
  });

  it('wrong tenant cannot read, complete or obtain download access; CROSS_TENANT_LEAKAGE=0', async () => {
    const canary = pdfBytes(CANARY);
    const s = await openSession(h, 't2-citizen', canary);
    await putBytes(h, s.body.upload, canary);
    await complete(h, 't2-citizen', s.body.document_id);
    await h.service.processScanRequest(scanRequestFor(await outbox(T2), s.body.document_id));
    expect((await getDoc(h, 't2-citizen', s.body.document_id, '/access')).statusCode).toBe(200);
    let leakage = 0;
    for (const res of [
      await getDoc(h, 't1-citizen', s.body.document_id),
      await getDoc(h, 't1-officer', s.body.document_id, '/access'),
      await complete(h, 't1-officer', s.body.document_id),
    ]) {
      if (res.statusCode !== 404) leakage += 1;
      if (res.body.includes(CANARY) || res.body.includes(T2)) leakage += 1;
    }
    const t1Rows = await db.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sf_upload.outbox_event
        WHERE tenant_id = $1 AND envelope::text LIKE '%' || $2 || '%'`,
      [T1, T2],
    );
    leakage += t1Rows.rows[0]?.n ?? 0;
    expect(leakage).toBe(0);
  });
});
