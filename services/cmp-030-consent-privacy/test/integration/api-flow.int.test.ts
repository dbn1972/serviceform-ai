import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  bearer,
  buildApp,
  closeHarness,
  key,
  setupHarness,
  SUBJECT,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-030 API flows', () => {
  it('grant → access-check allow → withdraw idempotent → access-check deny', async () => {
    const { app, authorizer } = await buildApp(h);
    try {
      const purposeRes = await app.inject({
        method: 'POST',
        url: '/v1/purposes',
        headers: bearer('officer-t1', { 'idempotency-key': key('purpose') }),
        payload: { code: 'CASE_PROCESSING', label: 'Case processing', requires_consent: true },
      });
      expect(purposeRes.statusCode).toBe(201);
      const purpose = purposeRes.json() as { purpose_id: string };

      const noticeRes = await app.inject({
        method: 'POST',
        url: '/v1/privacy/notices',
        headers: bearer('officer-t1', { 'idempotency-key': key('notice') }),
        payload: {
          purpose_id: purpose.purpose_id,
          content_ref: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      });
      expect(noticeRes.statusCode).toBe(201);
      const notice = noticeRes.json() as { notice_id: string };

      const publishRes = await app.inject({
        method: 'POST',
        url: `/v1/privacy/notices/${notice.notice_id}/publish`,
        headers: bearer('officer-t1', { 'idempotency-key': key('publish') }),
        payload: {},
      });
      expect(publishRes.statusCode).toBe(200);

      const denyCheck = await app.inject({
        method: 'POST',
        url: '/v1/privacy/access-check',
        headers: bearer('officer-t1'),
        payload: { subject_id: SUBJECT, purpose_code: 'CASE_PROCESSING' },
      });
      expect(denyCheck.statusCode).toBe(200);
      expect(denyCheck.json()).toMatchObject({
        allowed: false,
        reason_code: 'MISSING_CONSENT',
      });

      const grantKey = key('grant');
      const grantBody = {
        subject_id: SUBJECT,
        purpose_id: purpose.purpose_id,
        notice_id: notice.notice_id,
        channel: 'COUNTER',
        representation_basis: 'ASSISTED',
        applied_for: SUBJECT,
      };
      const grant1 = await app.inject({
        method: 'POST',
        url: '/v1/consents',
        headers: bearer('officer-t1', { 'idempotency-key': grantKey }),
        payload: grantBody,
      });
      expect(grant1.statusCode).toBe(201);
      const consent = grant1.json() as { consent_id: string; status: string };
      expect(consent.status).toBe('GRANTED');

      const grant2 = await app.inject({
        method: 'POST',
        url: '/v1/consents',
        headers: bearer('officer-t1', { 'idempotency-key': grantKey }),
        payload: grantBody,
      });
      expect(grant2.statusCode).toBe(201);
      expect(grant2.json()).toEqual(grant1.json());

      const allowCheck = await app.inject({
        method: 'POST',
        url: '/v1/privacy/access-check',
        headers: bearer('officer-t1'),
        payload: { subject_id: SUBJECT, purpose_code: 'CASE_PROCESSING' },
      });
      expect(allowCheck.json()).toMatchObject({ allowed: true, reason_code: 'OK' });

      const withdrawKey = key('withdraw');
      const w1 = await app.inject({
        method: 'POST',
        url: `/v1/consents/${consent.consent_id}/withdraw`,
        headers: bearer('officer-t1', { 'idempotency-key': withdrawKey }),
        payload: { reason_code: 'SUBJECT_REQUEST' },
      });
      expect(w1.statusCode).toBe(200);
      expect(w1.json()).toMatchObject({ status: 'WITHDRAWN' });

      const w2 = await app.inject({
        method: 'POST',
        url: `/v1/consents/${consent.consent_id}/withdraw`,
        headers: bearer('officer-t1', { 'idempotency-key': withdrawKey }),
        payload: { reason_code: 'SUBJECT_REQUEST' },
      });
      expect(w2.statusCode).toBe(200);
      expect(w2.json()).toEqual(w1.json());

      const after = await app.inject({
        method: 'POST',
        url: '/v1/privacy/access-check',
        headers: bearer('officer-t1'),
        payload: { subject_id: SUBJECT, purpose_code: 'CASE_PROCESSING' },
      });
      expect(after.json()).toMatchObject({
        allowed: false,
        reason_code: 'CONSENT_WITHDRAWN',
      });

      const events = await h.admin.query<{ event_type: string }>(
        `SELECT event_type FROM sf_consent_privacy.outbox_event
          WHERE tenant_id = $1 ORDER BY seq`,
        [T1],
      );
      const types = events.rows.map((r) => r.event_type);
      expect(types).toContain('PrivacyNoticeUpdated');
      expect(types).toContain('ConsentGranted');
      expect(types).toContain('ConsentWithdrawn');

      const audits = await h.admin.query(
        `SELECT 1 FROM sf_consent_privacy.outbox_event
          WHERE tenant_id = $1 AND event_type = 'AuditEventSubmitted'`,
        [T1],
      );
      expect((audits.rowCount ?? 0) > 0).toBe(true);

      authorizer.denies.add('CONSENT_GRANT');
      const denied = await app.inject({
        method: 'POST',
        url: '/v1/consents',
        headers: bearer('officer-t1', { 'idempotency-key': key('deny') }),
        payload: {
          subject_id: ACTOR_CITIZEN,
          purpose_id: purpose.purpose_id,
          channel: 'WEB',
          representation_basis: 'SELF',
        },
      });
      expect(denied.statusCode).toBe(403);

      const forged = await app.inject({
        method: 'GET',
        url: `/v1/consents?subject_id=${SUBJECT}`,
        headers: { ...bearer('officer-t1'), 'x-tenant-id': T2 },
      });
      expect(forged.statusCode).toBe(403);

      const list = await app.inject({
        method: 'GET',
        url: `/v1/consents?subject_id=${SUBJECT}`,
        headers: bearer('officer-t2'),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual({ items: [] });
      expect(JSON.stringify(list.json())).not.toContain(SUBJECT);
    } finally {
      await app.close();
    }
  });
});
