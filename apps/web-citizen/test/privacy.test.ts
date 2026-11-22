import { describe, expect, it } from 'vitest';
import {
  parseRequestType,
  parseScope,
  toPortalConsent,
  toPortalPrivacyRequest,
  type PlatformConsent,
  type PlatformPrivacyRequest,
  type PlatformPurpose,
} from '../lib/portal/privacy';

describe('citizen privacy portal helpers', () => {
  it('accepts published request types and rejects unknown codes', () => {
    expect(parseRequestType('ACCESS')).toBe('ACCESS');
    expect(parseRequestType('CONSENT_WITHDRAWAL')).toBe('CONSENT_WITHDRAWAL');
    expect(parseRequestType('DELETE_EVERYTHING')).toBeNull();
  });

  it('accepts only published scope templates', () => {
    expect(
      parseScope([
        {
          owner_component: 'CMP-030',
          scope_ref: 'consent.purpose.SAMPLE_LAB_PROFILE_PREFILL',
        },
      ]),
    ).toHaveLength(1);
    expect(
      parseScope([{ owner_component: 'CMP-030', scope_ref: 'invented.statute.period' }]),
    ).toBeNull();
    expect(parseScope([])).toBeNull();
  });

  it('maps privacy request portal view and withdrawability', () => {
    const row: PlatformPrivacyRequest = {
      request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      request_type: 'ACCESS',
      lifecycle_status: 'SUBMITTED',
      scope_count: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const view = toPortalPrivacyRequest(row);
    expect(view.request_type_label).toMatch(/access/i);
    expect(view.can_withdraw).toBe(true);
    expect(toPortalPrivacyRequest({ ...row, lifecycle_status: 'COMPLETED' }).can_withdraw).toBe(
      false,
    );
  });

  it('joins consent rows to purpose labels without inventing statute', () => {
    const purpose: PlatformPurpose = {
      purpose_id: 'pppppppp-pppp-4ppp-8ppp-pppppppppppp',
      code: 'SAMPLE_LAB_PROFILE_PREFILL',
      label: 'SAMPLE_LAB profile prefill',
      status: 'ACTIVE',
      requires_consent: true,
    };
    const consent: PlatformConsent = {
      consent_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      subject_id: 'ssssssss-ssss-4sss-8sss-ssssssssssss',
      purpose_id: purpose.purpose_id,
      status: 'GRANTED',
      granted_at: '2026-01-01T00:00:00.000Z',
      withdrawn_at: null,
      representation_basis: 'SELF',
      channel: 'WEB',
    };
    const view = toPortalConsent(consent, new Map([[purpose.purpose_id, purpose]]));
    expect(view.purpose_code).toBe('SAMPLE_LAB_PROFILE_PREFILL');
    expect(view.status_label).toBe('Granted');
  });
});
