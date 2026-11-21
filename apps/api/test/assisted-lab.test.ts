import { describe, expect, it } from 'vitest';
import {
  LabAssistedConsentLedger,
  LabAssistedVerificationPort,
  parseAssistedCatalogue,
} from '../src/platform/assisted.js';

describe('SAMPLE_LAB assisted catalogue / consent fail-closed', () => {
  const catalogue = parseAssistedCatalogue({
    default_channel: 'CSC',
    channels: [
      {
        code: 'CSC',
        label: 'CSC',
        description: 'x',
        requires_representation_authority: false,
      },
      {
        code: 'GUARDIAN',
        label: 'Guardian',
        description: 'y',
        requires_representation_authority: true,
      },
    ],
    consent: {
      purpose_code: 'SAMPLE_LAB_ASSISTED_APPLY',
      consent_ref_prefix: 'consent:assisted-readback',
      label: 'lab consent',
      read_back_required: true,
    },
    assurance: { default_ref: 'assurance:sample-lab/citizen-present', label: 'present' },
    default_offering_catalogue_id: 'IND-SOC-002',
  });

  it('defaults CSC and keeps representation flags from published catalogue', () => {
    expect(catalogue.default_channel).toBe('CSC');
    expect(catalogue.channels.find((c) => c.code === 'GUARDIAN')?.requires_representation_authority).toBe(
      true,
    );
    expect(catalogue.consent.read_back_required).toBe(true);
  });

  it('refuses consent capture without read-back (fail-closed)', () => {
    const ledger = new LabAssistedConsentLedger();
    const refused = ledger.capture({
      tenant_id: 't1',
      citizen_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      consent_ref: 'consent:assisted-readback/ref-1',
      session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      read_back_acknowledged: false,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('READ_BACK_ACKNOWLEDGEMENT_REQUIRED');
  });

  it('records consent only after read-back and verifies fail-closed otherwise', async () => {
    const ledger = new LabAssistedConsentLedger();
    const verification = new LabAssistedVerificationPort(
      {
        exists: async () => true,
      },
      ledger,
    );
    const tenant = '0d15ba00-0001-4000-8000-0d15ba0000d1';
    const citizen = '44444444-4444-4444-8444-444444444444';
    const session = '66666666-6666-4666-8666-666666666666';
    const ref = 'consent:assisted-readback/ref-1';

    expect(
      await verification.consentCaptured({ tenant_id: tenant }, {
        citizenId: citizen,
        consentRef: ref,
        sessionId: session,
      }),
    ).toBe(false);

    const ok = ledger.capture({
      tenant_id: tenant,
      citizen_id: citizen,
      consent_ref: ref,
      session_id: session,
      read_back_acknowledged: true,
    });
    expect(ok.ok).toBe(true);
    expect(
      await verification.consentCaptured({ tenant_id: tenant }, {
        citizenId: citizen,
        consentRef: ref,
        sessionId: session,
      }),
    ).toBe(true);
  });

  it('applicant existence is delegated to the identity directory', async () => {
    const seen: string[] = [];
    const verification = new LabAssistedVerificationPort(
      {
        exists: async (input) => {
          seen.push(input.subject_id);
          return input.subject_id === '44444444-4444-4444-8444-444444444444';
        },
      },
      new LabAssistedConsentLedger(),
    );
    expect(
      await verification.applicantInTenant(
        { tenant_id: 't' },
        '44444444-4444-4444-8444-444444444444',
      ),
    ).toBe(true);
    expect(
      await verification.applicantInTenant(
        { tenant_id: 't' },
        '55555555-5555-4555-8555-555555555555',
      ),
    ).toBe(false);
    expect(seen).toHaveLength(2);
  });
});
