/**
 * SAMPLE_LAB assisted-service / CSC channel catalogue (Constitution #36 / INT-015).
 * Opaque refs only — no invented representation statute. CERTIFIED=false · G6=false.
 */

export const SAMPLE_LAB_ASSISTED_CHANNELS = [
  {
    code: 'CSC',
    label: 'CSC / common service centre',
    description: 'Operator assists the citizen at a CSC counter; never logs in as the citizen.',
    requires_representation_authority: false,
  },
  {
    code: 'COUNTER',
    label: 'Department counter',
    description: 'In-office assisted filing; applied_by remains the operator.',
    requires_representation_authority: false,
  },
  {
    code: 'KIOSK',
    label: 'Assisted kiosk',
    description: 'Staffed kiosk channel with the same applied_by / applied_for separation.',
    requires_representation_authority: false,
  },
  {
    code: 'CALL_CENTRE',
    label: 'Call centre',
    description: 'Remote assisted filing; consent read-back still required.',
    requires_representation_authority: false,
  },
  {
    code: 'AUTHORIZED_REPRESENTATIVE',
    label: 'Authorized representative',
    description:
      'Third-party representation; opaque authority ref + independent verifier required.',
    requires_representation_authority: true,
  },
  {
    code: 'GUARDIAN',
    label: 'Guardian',
    description: 'Guardian channel; opaque authority ref only — no statute invented here.',
    requires_representation_authority: true,
  },
  {
    code: 'INSTITUTIONAL',
    label: 'Institutional operator',
    description: 'Institutional filing; opaque authority ref + independent verifier required.',
    requires_representation_authority: true,
  },
] as const;

export type SampleLabAssistedChannelCode = (typeof SAMPLE_LAB_ASSISTED_CHANNELS)[number]['code'];

/** Lab opaque consent purpose for assisted read-back (not CMP-030 profile prefill). */
export const SAMPLE_LAB_ASSISTED_CONSENT = {
  purpose_code: 'SAMPLE_LAB_ASSISTED_APPLY',
  consent_ref_prefix: 'consent:assisted-readback',
  label:
    'SAMPLE_LAB: the operator may file this application for me; my identity stays applied_for and the operator stays applied_by',
  read_back_required: true as const,
} as const;

/** Lab opaque applicant assurance refs — identity proof recorded as opaque strings only. */
export const SAMPLE_LAB_ASSISTED_ASSURANCE = {
  default_ref: 'assurance:sample-lab/citizen-present',
  label: 'Citizen present at assisted channel (lab assurance label)',
} as const;

export function channelRequiresAuthority(code: string): boolean {
  const row = SAMPLE_LAB_ASSISTED_CHANNELS.find((c) => c.code === code);
  return row?.requires_representation_authority === true;
}

export function isSampleLabAssistedChannel(code: string): code is SampleLabAssistedChannelCode {
  return SAMPLE_LAB_ASSISTED_CHANNELS.some((c) => c.code === code);
}
