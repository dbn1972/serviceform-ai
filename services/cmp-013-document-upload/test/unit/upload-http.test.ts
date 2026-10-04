import { beforeEach, describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { SIMULATED_MALWARE_SIGNATURE } from '../../src/adapters/simulated-scanner.js';
import { buildUploadService } from '../../src/plugin.js';
import {
  CANARY,
  PDF_POLICY,
  T1,
  T2,
  auth,
  buildHarness,
  idem,
  pdfBytes,
  pngBytes,
  sha256,
  type Harness,
} from '../doubles/fixtures.js';
import {
  complete,
  createPolicy,
  getDoc,
  openSession,
  putBytes,
  scanRequestFor,
} from '../doubles/flow.js';
import { MemoryUploadRepository } from '../doubles/memory-repo.js';

let repo: MemoryUploadRepository;
let h: Harness;

beforeEach(async () => {
  repo = new MemoryUploadRepository();
  h = await buildHarness(repo);
  expect((await createPolicy(h)).statusCode).toBe(201);
});

async function uploadAndComplete(bytes = pdfBytes(), token = 't1-citizen') {
  const { res, body } = await openSession(h, token, bytes);
  expect(res.statusCode).toBe(201);
  await putBytes(h, body.upload, bytes);
  const done = await complete(h, token, body.document_id);
  return { body, done };
}

describe('CMP-013 happy path (direct upload -> quarantine -> scan -> available)', () => {
  it('issues a short-lived direct upload target and never proxies bytes', async () => {
    const bytes = pdfBytes();
    const { res, body } = await openSession(h, 't1-citizen', bytes);
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(body.session_status).toBe('OPEN');
    expect(body.document_status).toBe('PENDING_UPLOAD');
    expect(body.upload?.method).toBe('PUT');
    expect(body.upload?.url.startsWith('sim://upload/')).toBe(true);
    expect(Date.parse(body.upload?.expires_at ?? '')).toBe(Date.parse(body.expires_at));
    expect(body.upload?.simulation?.simulation).toBe(true);
    expect(validate('simulation-marker', body.upload?.simulation).valid).toBe(true);
    expect(JSON.stringify(body)).not.toContain('test-only-hmac-key');
    const doc = repo.state.documents[0];
    expect(doc?.object_ref).toBe(
      `t/${T1}/c/cell-01/o/${body.document_id}/${sha256(bytes).slice(0, 12)}`,
    );
    expect(Object.keys(doc ?? {})).not.toContain('bytes');
  });

  it('runs integrity + policy + scan, then grants download only when AVAILABLE', async () => {
    const { body, done } = await uploadAndComplete();
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      status: 'SCAN_PENDING',
      technically_accepted: false,
      content_type: 'application/pdf',
    });
    const blocked = await getDoc(h, 't1-citizen', body.document_id, '/access');
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json()).toMatchObject({
      error_code: 'SF-EVD-002',
      details: [{ code: 'DOCUMENT_NOT_AVAILABLE' }],
    });
    expect(h.probe.calls.some((c) => c.op === 'download')).toBe(false);

    const result = await h.service.processScanRequest(
      scanRequestFor(repo.events(), body.document_id),
    );
    expect(result).toBe('AVAILABLE');
    const doc = await getDoc(h, 't1-citizen', body.document_id);
    expect(doc.json()).toMatchObject({ status: 'AVAILABLE', technically_accepted: true });
    expect(Object.keys(doc.json() as object)).not.toContain('object_ref');
    const access = await getDoc(h, 't1-citizen', body.document_id, '/access');
    expect(access.statusCode).toBe(200);
    expect(access.json().access.method).toBe('GET');
    expect(access.json().access.url.startsWith('sim://storage/')).toBe(true);
    expect(repo.events().map((e) => e.event_type)).toEqual([
      'DocumentUploaded',
      'DocumentScanRequested',
      'DocumentScanned',
      'DocumentAvailable',
    ]);
    expect(repo.state.scans).toHaveLength(1);
    expect(repo.state.scans[0]?.simulation?.simulation).toBe(true);
  });

  it('never calls OPA, storage or scanner inside an open authoritative transaction', async () => {
    h.authorizer.decide = new Proxy(h.authorizer.decide, {
      apply(target, self, args) {
        if (repo.inTransaction()) throw new Error('PDP called inside transaction');
        return Reflect.apply(target, self, args);
      },
    });
    const { body } = await uploadAndComplete();
    await h.service.processScanRequest(scanRequestFor(repo.events(), body.document_id));
    await getDoc(h, 't1-citizen', body.document_id, '/access');
    expect(h.probe.calls.length).toBeGreaterThanOrEqual(5);
    expect(h.probe.calls.filter((c) => c.inTx)).toEqual([]);
  });

  it('emits audit events and contract-valid envelopes for material actions', async () => {
    await uploadAndComplete();
    const audits = repo.state.outbox.filter((o) => o.topic === 'sf.audit.ingest.v1');
    expect(audits.length).toBeGreaterThanOrEqual(3);
    for (const o of repo.state.outbox) {
      expect(validate('event-envelope', o.envelope).valid).toBe(true);
      expect(o.envelope.tenant_id).toBe(T1);
    }
    for (const a of audits) expect(validate('audit-event', a.envelope.data).valid).toBe(true);
  });
});

describe('CMP-013 size/type/checksum policy fails closed', () => {
  it('refuses session when no policy, retired policy, disallowed type or oversize', async () => {
    const bytes = pdfBytes();
    const none = await openSession(h, 't1-citizen', bytes, { policy_code: 'UNKNOWN_POLICY' });
    expect(none.res.statusCode).toBe(400);
    expect(none.body).toMatchObject({ details: [{ code: 'UPLOAD_POLICY_UNAVAILABLE' }] });
    const type = await openSession(h, 't1-citizen', bytes, { content_type: 'image/jpeg' });
    expect(type.body).toMatchObject({ details: [{ code: 'CONTENT_TYPE_NOT_ALLOWED' }] });
    const big = await openSession(h, 't1-citizen', bytes, { byte_size: PDF_POLICY.max_bytes + 1 });
    expect(big.body).toMatchObject({ details: [{ code: 'SIZE_EXCEEDS_POLICY' }] });
    expect(
      (await createPolicy(h, 't1-officer', { ...PDF_POLICY, status: 'RETIRED' })).statusCode,
    ).toBe(201);
    const retired = await openSession(h, 't1-citizen', bytes);
    expect(retired.body).toMatchObject({ details: [{ code: 'UPLOAD_POLICY_UNAVAILABLE' }] });
    expect(repo.state.documents).toHaveLength(0);
    expect(h.probe.calls).toHaveLength(0);
  });

  it('refuses policies naming content types that cannot be verified by signature', async () => {
    const res = await createPolicy(h, 't1-officer', {
      ...PDF_POLICY,
      allowed_content_types: ['text/html'],
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a checksum mismatch and discards the quarantined object', async () => {
    const declared = pdfBytes('declared');
    const { body } = await openSession(h, 't1-citizen', declared);
    const tampered = pdfBytes('tampered');
    expect(tampered.byteLength).toBe(declared.byteLength);
    await putBytes(h, body.upload, tampered);
    const res = await complete(h, 't1-citizen', body.document_id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error_code: 'SF-EVD-002',
      details: [{ code: 'CHECKSUM_MISMATCH' }],
    });
    expect(repo.state.documents[0]).toMatchObject({
      status: 'REJECTED',
      rejection_code: 'CHECKSUM_MISMATCH',
    });
    expect(repo.state.sessions[0]?.status).toBe('REJECTED');
    expect(repo.events('DocumentRejected')).toHaveLength(1);
    expect(repo.events('DocumentScanRequested')).toHaveLength(0);
    expect(h.probe.calls.some((c) => c.op === 'discard')).toBe(true);
  });

  it('rejects size mismatch and sniffed type mismatch (declared pdf, actual png)', async () => {
    const declared = pdfBytes();
    const s1 = await openSession(h, 't1-citizen', declared);
    const longer = pdfBytes('synthetic test document plus');
    await putBytes(h, s1.body.upload, longer);
    expect((await complete(h, 't1-citizen', s1.body.document_id)).json()).toMatchObject({
      details: [{ code: 'SIZE_MISMATCH' }],
    });

    const png = pngBytes();
    const s2 = await openSession(h, 't1-citizen', png, { content_type: 'application/pdf' });
    await putBytes(h, s2.body.upload, png);
    expect((await complete(h, 't1-citizen', s2.body.document_id)).json()).toMatchObject({
      details: [{ code: 'CONTENT_TYPE_MISMATCH' }],
    });

    const unknown = new TextEncoder().encode('plain text pretending');
    const s3 = await openSession(h, 't1-citizen', unknown);
    await putBytes(h, s3.body.upload, unknown);
    expect((await complete(h, 't1-citizen', s3.body.document_id)).json()).toMatchObject({
      details: [{ code: 'CONTENT_TYPE_UNRECOGNISED' }],
    });
  });

  it('completing before the object exists keeps the session open (no state change)', async () => {
    const { body } = await openSession(h, 't1-citizen', pdfBytes());
    const res = await complete(h, 't1-citizen', body.document_id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: [{ code: 'OBJECT_NOT_UPLOADED' }] });
    expect(repo.state.documents[0]?.status).toBe('PENDING_UPLOAD');
    expect(repo.state.sessions[0]?.status).toBe('OPEN');
  });

  it('expired session is abandoned on complete and by the sweeper', async () => {
    const a = await openSession(h, 't1-citizen', pdfBytes('a'));
    const b = await openSession(h, 't1-citizen', pdfBytes('b'));
    await putBytes(h, a.body.upload, pdfBytes('a'));
    h.clock.advance(PDF_POLICY.session_ttl_seconds + 1);
    const res = await complete(h, 't1-citizen', a.body.document_id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: [{ code: 'UPLOAD_SESSION_EXPIRED' }] });
    const sweepCtx = h.service.workerContext(repo.events('DocumentRejected')[0] ?? fail());
    expect(await h.service.expireAbandonedSessions(sweepCtx)).toBe(1);
    expect(repo.state.documents.map((d) => d.rejection_code)).toEqual([
      'UPLOAD_ABANDONED',
      'UPLOAD_ABANDONED',
    ]);
    expect(repo.state.sessions.map((s) => s.status)).toEqual(['EXPIRED', 'EXPIRED']);
    expect(b.body.document_id).not.toBe(a.body.document_id);
    await expect(
      h.storage.inspectObject({
        tenantId: T1,
        objectKey: repo.state.documents[0]?.object_ref ?? '',
      }),
    ).resolves.toBeNull();
  });
});

function fail(): never {
  throw new Error('missing event');
}

describe('CMP-013 malware scan fails closed', () => {
  it('infected object is rejected, discarded and never downloadable', async () => {
    const bytes = pdfBytes(SIMULATED_MALWARE_SIGNATURE);
    const { body } = await uploadAndComplete(bytes);
    expect(
      await h.service.processScanRequest(scanRequestFor(repo.events(), body.document_id)),
    ).toBe('REJECTED');
    expect(repo.state.documents[0]).toMatchObject({
      status: 'REJECTED',
      rejection_code: 'MALWARE_DETECTED',
    });
    const access = await getDoc(h, 't1-citizen', body.document_id, '/access');
    expect(access.statusCode).toBe(422);
    expect(repo.events('DocumentAvailable')).toHaveLength(0);
    expect(h.storage.isReleased(repo.state.documents[0]?.object_ref ?? '')).toBe(false);
  });

  it('scanner outage keeps SCAN_PENDING, retries via outbox, then rejects SCAN_FAILED', async () => {
    const { body } = await uploadAndComplete();
    h.probe.faults.add('scan');
    const first = scanRequestFor(repo.events(), body.document_id);
    expect(await h.service.processScanRequest(first)).toBe('RETRY');
    expect(repo.state.documents[0]).toMatchObject({ status: 'SCAN_PENDING', scan_attempts: 1 });
    const retry = scanRequestFor(repo.events(), body.document_id);
    expect(retry.event_id).not.toBe(first.event_id);
    expect(retry.data).toMatchObject({ attempt_no: 2 });
    expect(await h.service.processScanRequest(retry)).toBe('REJECTED');
    expect(repo.state.documents[0]).toMatchObject({
      status: 'REJECTED',
      rejection_code: 'SCAN_FAILED',
    });
    expect(repo.state.scans.map((s) => s.verdict)).toEqual(['ERROR', 'ERROR']);
  });

  it('quarantine release failure is not treated as CLEAN', async () => {
    const { body } = await uploadAndComplete();
    h.probe.faults.add('release');
    expect(
      await h.service.processScanRequest(scanRequestFor(repo.events(), body.document_id)),
    ).toBe('RETRY');
    expect(repo.state.documents[0]?.status).toBe('SCAN_PENDING');
    expect(repo.state.scans[0]).toMatchObject({
      verdict: 'ERROR',
      engine_ref: 'quarantine-release-failed',
    });
  });

  it('duplicate scan event does not duplicate effects; non-pending is skipped', async () => {
    const { body } = await uploadAndComplete();
    const evt = scanRequestFor(repo.events(), body.document_id);
    expect(await h.service.processScanRequest(evt)).toBe('AVAILABLE');
    expect(await h.service.processScanRequest(evt)).toBe('DUPLICATE');
    expect(repo.state.scans).toHaveLength(1);
    expect(repo.events('DocumentAvailable')).toHaveLength(1);
    expect(
      await h.service.processScanRequest({
        ...evt,
        event_id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
      }),
    ).toBe('SKIPPED');
  });

  it('rejects malformed scan requests', async () => {
    const { body } = await uploadAndComplete();
    const evt = scanRequestFor(repo.events(), body.document_id);
    await expect(
      h.service.processScanRequest({ ...evt, event_type: 'DocumentUploaded' }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      h.service.processScanRequest({ ...evt, data: { document_id: '../etc' } }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('a document can never be marked AVAILABLE without a CLEAN scan row', async () => {
    const { body } = await uploadAndComplete();
    const fakeCtx = h.service.workerContext(scanRequestFor(repo.events(), body.document_id));
    await expect(
      repo.withTx(fakeCtx, (tx) =>
        tx.updateDocument(body.document_id, { status: 'AVAILABLE', now: new Date().toISOString() }),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('CMP-013 tenant isolation and authorization (INT-011)', () => {
  it('wrong-tenant read, complete and access are denied with no leakage', async () => {
    expect((await createPolicy(h, 't2-officer')).statusCode).toBe(201);
    const canary = pdfBytes(CANARY);
    const t2 = await openSession(h, 't2-citizen', canary);
    expect(t2.res.statusCode).toBe(201);
    await putBytes(h, t2.body.upload, canary);
    await complete(h, 't2-citizen', t2.body.document_id);
    await h.service.processScanRequest(scanRequestFor(repo.events(), t2.body.document_id));

    for (const suffix of ['', '/access']) {
      const res = await getDoc(h, 't1-citizen', t2.body.document_id, suffix);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(CANARY);
      expect(res.body).not.toContain(T2);
    }
    const res = await complete(h, 't1-officer', t2.body.document_id);
    expect(res.statusCode).toBe(404);
    const crossTenantLeakage = repo.state.outbox.filter(
      (o) => o.envelope.tenant_id === T1 && JSON.stringify(o.envelope).includes(T2),
    ).length;
    expect(crossTenantLeakage).toBe(0);
  });

  it('storage port refuses another tenant object key (defense in depth)', async () => {
    const { body } = await openSession(h, 't1-citizen', pdfBytes());
    const key = repo.state.documents.find((d) => d.document_id === body.document_id)?.object_ref;
    await expect(
      h.storage.inspectObject({ tenantId: T2, objectKey: key ?? '' }),
    ).rejects.toMatchObject({
      code: 'OBJECT_NOT_OWNED',
    });
  });

  it('refuses client tenant headers, forwarded tenant, missing context and tenant-less actors', async () => {
    const bytes = pdfBytes();
    for (const extra of [
      { 'x-tenant-id': T2 },
      { 'x-sf-tenant': T2 },
      { forwarded: `for=1.2.3.4;tenant=${T2}` },
    ]) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/documents/upload-sessions',
        headers: auth('t1-citizen', { ...idem('hdr'), ...extra }),
        payload: {
          policy_code: PDF_POLICY.policy_code,
          content_type: 'application/pdf',
          byte_size: bytes.byteLength,
          checksum_sha256: sha256(bytes),
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error_code).toBe('SF-TEN-002');
    }
    const anon = await h.app.inject({ method: 'GET', url: `/v1/documents/${T1}` });
    expect(anon.statusCode).toBe(401);
    const noTenant = await getDoc(h, 'no-tenant', T1);
    expect(noTenant.statusCode).toBe(401);
    expect(noTenant.json().error_code).toBe('SF-TEN-001');
  });

  it('rejects client-supplied tenant_id, filename and object key in the body', async () => {
    const bytes = pdfBytes();
    for (const extra of [{ tenant_id: T2 }, { file_name: '../../x.pdf' }, { object_key: 't/x' }]) {
      const { res } = await openSession(h, 't1-citizen', bytes, extra);
      expect(res.statusCode).toBe(400);
    }
  });

  it('OPA deny is 403, PDP outage is 503, and OPA receives owner/classification', async () => {
    const { body } = await uploadAndComplete();
    await getDoc(h, 't1-citizen-b', body.document_id);
    expect(h.authorizer.lastInput?.resource).toMatchObject({
      resource_type: 'Document',
      tenant_id: T1,
      owner_id: repo.state.documents[0]?.owner_actor_id,
      classification: 'CITIZEN_PRIVATE',
    });
    h.authorizer.denies.add('DOCUMENT_ACCESS');
    expect((await getDoc(h, 't1-citizen-b', body.document_id, '/access')).statusCode).toBe(403);
    h.authorizer.throws = true;
    const down = await getDoc(h, 't1-citizen', body.document_id);
    expect(down.statusCode).toBe(503);
    expect(down.json().error_code).toBe('SF-SYS-004');
  });
});

describe('CMP-013 idempotency and dependency failure', () => {
  it('replays the same session for the same key and refuses a different body', async () => {
    const bytes = pdfBytes();
    const headers = idem('replay');
    const first = await openSession(h, 't1-citizen', bytes, {}, headers);
    const again = await openSession(h, 't1-citizen', bytes, {}, headers);
    expect(again.res.statusCode).toBe(201);
    expect(again.body.document_id).toBe(first.body.document_id);
    expect(again.body.upload?.method).toBe('PUT');
    expect(repo.state.documents).toHaveLength(1);
    const conflict = await openSession(h, 't1-citizen', bytes, { byte_size: 99 }, headers);
    expect(conflict.res.statusCode).toBe(409);
    expect(conflict.body).toMatchObject({ error_code: 'SF-APP-002' });
    const missing = await openSession(h, 't1-citizen', bytes, {}, {});
    expect(missing.res.statusCode).toBe(400);
  });

  it('storage outage on target issue is 503 and a retry with the same key recovers', async () => {
    const bytes = pdfBytes();
    const headers = idem('outage');
    h.probe.faults.add('issue');
    const down = await openSession(h, 't1-citizen', bytes, {}, headers);
    expect(down.res.statusCode).toBe(503);
    expect(down.body).toMatchObject({ error_code: 'SF-INT-001' });
    h.probe.faults.delete('issue');
    const ok = await openSession(h, 't1-citizen', bytes, {}, headers);
    expect(ok.res.statusCode).toBe(201);
    expect(repo.state.documents).toHaveLength(1);
  });

  it('storage outage on complete leaves state unchanged; duplicate complete is idempotent', async () => {
    const bytes = pdfBytes();
    const { body } = await openSession(h, 't1-citizen', bytes);
    await putBytes(h, body.upload, bytes);
    h.probe.faults.add('inspect');
    expect((await complete(h, 't1-citizen', body.document_id)).statusCode).toBe(503);
    expect(repo.state.documents[0]?.status).toBe('PENDING_UPLOAD');
    h.probe.faults.delete('inspect');
    expect((await complete(h, 't1-citizen', body.document_id)).statusCode).toBe(200);
    expect((await complete(h, 't1-citizen', body.document_id)).statusCode).toBe(200);
    expect(repo.events('DocumentUploaded')).toHaveLength(1);
    expect(repo.events('DocumentScanRequested')).toHaveLength(1);
  });

  it('download presign secret outage is 503 (fail closed)', async () => {
    const { body } = await uploadAndComplete();
    await h.service.processScanRequest(scanRequestFor(repo.events(), body.document_id));
    h.secrets.fail = true;
    expect((await getDoc(h, 't1-citizen', body.document_id, '/access')).statusCode).toBe(503);
  });

  it('reads the active policy and validates ids', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/upload-policies/${PDF_POLICY.policy_code}`,
      headers: auth('t1-officer'),
    });
    expect(res.json()).toMatchObject({ version_no: 1, max_bytes: PDF_POLICY.max_bytes });
    const other = await h.app.inject({
      method: 'GET',
      url: `/v1/upload-policies/${PDF_POLICY.policy_code}`,
      headers: auth('t2-officer'),
    });
    expect(other.statusCode).toBe(404);
    expect((await getDoc(h, 't1-citizen', 'not-a-uuid')).statusCode).toBe(400);
  });
});

describe('CMP-013 INT-013 mode policy', () => {
  it('refuses SIMULATED adapters in PRODUCTION and non-simulation environments', async () => {
    for (const environment of ['PRODUCTION', 'UAT', 'PREPROD'] as const) {
      await expect(buildHarness(new MemoryUploadRepository(), { environment })).rejects.toThrow();
    }
  });

  it('refuses SIMULATED adapters lacking a marker and a missing repository', () => {
    const base = {
      environment: 'CI' as const,
      repository: repo,
      resolveContext: async () => null,
      authorizer: h.authorizer,
      workerActorId: '00000000-0000-4000-8000-000000000000',
    };
    const unmarked = {
      mode: 'SIMULATED' as const,
      connectorBindingId: '01301301-3013-4013-8013-013013013099',
      simulation: undefined,
    };
    expect(() =>
      buildUploadService({
        ...base,
        storage: { ...h.storage, ...unmarked } as never,
        scanner: h.scanner,
      }),
    ).toThrow(expect.objectContaining({ code: 'SF-INT-001' }));
    const { repository: _r, ...noRepo } = base;
    expect(() => buildUploadService({ ...noRepo, storage: h.storage, scanner: h.scanner })).toThrow(
      expect.objectContaining({ details: [{ code: 'REPOSITORY_REQUIRED' }] }),
    );
    expect(() =>
      buildUploadService({
        ...base,
        storage: h.storage,
        scanner: h.scanner,
        downloadTtlSeconds: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'SF-SYS-003' }));
  });

  it('refuses a SIMULATED critical binding declared for PRODUCTION', () => {
    expect(() =>
      buildUploadService({
        environment: 'CI',
        repository: repo,
        resolveContext: async () => null,
        authorizer: h.authorizer,
        storage: h.storage,
        scanner: h.scanner,
        workerActorId: '00000000-0000-4000-8000-000000000000',
        connectorBindings: [{ critical: true, mode: 'SIMULATED', environment: 'PRODUCTION' }],
      }),
    ).toThrow(expect.objectContaining({ details: [{ code: 'CRITICAL_SIMULATED_IN_PRODUCTION' }] }));
  });
});

describe('CMP-013 tenant isolation of a second tenant policy', () => {
  it('T2 cannot use T1 policy metadata', async () => {
    const { res, body } = await openSession(h, 't2-citizen', pdfBytes());
    expect(res.statusCode).toBe(400);
    expect(body).toMatchObject({ details: [{ code: 'UPLOAD_POLICY_UNAVAILABLE' }] });
    expect(T1).not.toBe(T2);
  });
});
