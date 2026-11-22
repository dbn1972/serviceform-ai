import { describe, expect, it } from 'vitest';
import { parsePrivacyCatalogue } from '../src/platform/privacy-centre.js';

describe('SAMPLE_LAB privacy centre catalogue', () => {
  it('parses request types, scope templates and fail-closed retention posture', () => {
    const catalogue = parsePrivacyCatalogue({
      simulation: 'SIMULATED',
      request_types: [
        { code: 'ACCESS', label: 'Access', description: 'x' },
        { code: 'CONSENT_WITHDRAWAL', label: 'Withdraw', description: 'y' },
      ],
      scope_templates: [
        {
          owner_component: 'CMP-030',
          scope_ref: 'consent.purpose.SAMPLE_LAB_PROFILE_PREFILL',
          label: 'Profile consent',
        },
      ],
      retention: {
        visibility: 'POLICY_INPUT_REQUIRED',
        invented_statutory_period_forbidden: true,
        citizen_archive_delete_forbidden: true,
        note: 'Owner period refs only',
        entries: [
          {
            owner_component: 'CMP-015',
            resource_kind: 'ApplicationCase',
            period_ref_status: 'UNBOUND',
            eligibility: 'ACTIVE_ONLY_UNTIL_OWNER_PERIOD',
          },
        ],
      },
    });

    expect(catalogue.simulation).toBe('SIMULATED');
    expect(catalogue.request_types.map((t) => t.code)).toContain('ACCESS');
    expect(catalogue.scope_templates[0]?.owner_component).toBe('CMP-030');
    expect(catalogue.retention.visibility).toBe('POLICY_INPUT_REQUIRED');
    expect(catalogue.retention.invented_statutory_period_forbidden).toBe(true);
    expect(catalogue.retention.citizen_archive_delete_forbidden).toBe(true);
    expect(catalogue.retention.entries[0]?.period_ref_status).toBe('UNBOUND');
  });

  it('falls back safely on empty input without inventing periods', () => {
    const catalogue = parsePrivacyCatalogue(null);
    expect(catalogue.simulation).toBe('SIMULATED');
    expect(catalogue.retention.invented_statutory_period_forbidden).toBe(true);
    expect(catalogue.request_types.length).toBeGreaterThan(0);
  });
});
