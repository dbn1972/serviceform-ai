import { describe, expect, it } from 'vitest';
import {
  issuanceApplies,
  toPortalApplication,
  type CaseState,
  type IssuanceProjection,
  type PlatformApplication,
} from '../lib/portal/applications';

const app = (state: CaseState): PlatformApplication =>
  ({
    application_id: '0d15ba00-0a00-4000-8000-0d15ba000a00',
    state,
    aggregate_version: 9,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    submitted_at: '2026-01-01T00:00:00.000Z',
  }) as PlatformApplication;

const published: IssuanceProjection = {
  credential: { credential_id: '0d15ba00-0c22-4000-8000-0d15ba000c22', lifecycle_status: 'ISSUED' },
  digilocker: {
    mode: 'SIMULATED',
    status: 'PUBLISHED',
    publish_request_id: '0d15ba00-0c12-4000-8000-0d15ba000c99',
    provider_transaction_ref: 'sim-dl-0001',
  },
};

// REQ SF-M10-B-3: the citizen view projects platform issuance instead of a fixed NOT_REQUESTED.
describe('citizen issuance projection', () => {
  it('only cases past a recorded approval carry an issuance projection', () => {
    for (const s of ['APPROVED', 'SIGNING_PENDING', 'ISSUED', 'CLOSED'] as const) {
      expect(issuanceApplies(s)).toBe(true);
    }
    for (const s of ['DRAFT', 'SUBMITTED', 'DECISION_PENDING', 'REJECTED', 'WITHDRAWN'] as const) {
      expect(issuanceApplies(s)).toBe(false);
    }
  });

  it('without a projection the view stays NOT_REQUESTED and has no credential id', () => {
    const view = toPortalApplication(app('APPROVED'), null);
    expect(view.digilocker).toEqual({ mode: 'SIMULATED', status: 'NOT_REQUESTED' });
    expect(view).not.toHaveProperty('credential_id');
  });

  it('a published projection surfaces credential id, status and provider ref only', () => {
    const view = toPortalApplication(app('ISSUED'), null, published);
    expect(view.status).toBe('ISSUED');
    expect(view.credential_id).toBe(published.credential?.credential_id);
    expect(view.digilocker).toEqual({
      mode: 'SIMULATED',
      status: 'PUBLISHED',
      provider_transaction_ref: 'sim-dl-0001',
    });
  });

  it('a failed publish never hides the issued credential', () => {
    const view = toPortalApplication(app('ISSUED'), null, {
      credential: published.credential,
      digilocker: { mode: 'SIMULATED', status: 'FAILED', failure_code: 'SF-INT-001' },
    });
    expect(view.status).toBe('ISSUED');
    expect(view.credential_id).toBe(published.credential?.credential_id);
    expect(view.digilocker).toEqual({ mode: 'SIMULATED', status: 'FAILED' });
  });
});
