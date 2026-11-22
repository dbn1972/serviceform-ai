/**
 * SAMPLE_LAB privacy centre catalogue (CMP-061 rights + CMP-030 consent/purpose visibility
 * + CMP-049 retention posture). Not statute. CERTIFIED=false · G6=false.
 */

export const SAMPLE_LAB_PRIVACY_REQUEST_TYPES = [
  {
    code: 'ACCESS',
    label: 'Access my data',
    description: 'Ask owning components for a copy of data in scope',
  },
  {
    code: 'CORRECTION',
    label: 'Correct my data',
    description: 'Ask owning components to correct scoped records',
  },
  {
    code: 'ERASURE',
    label: 'Erase my data',
    description: 'Ask owning components to erase scoped records when policy allows',
  },
  {
    code: 'PORTABILITY',
    label: 'Port my data',
    description: 'Ask owning components for a portable export of scoped data',
  },
  {
    code: 'CONSENT_WITHDRAWAL',
    label: 'Withdraw consent',
    description:
      'Request withdrawal of a granted purpose consent (orchestrated; not direct CMP-030 withdraw)',
  },
  {
    code: 'RESTRICT',
    label: 'Restrict processing',
    description: 'Ask owning components to restrict processing of scoped data',
  },
] as const;

export type SampleLabPrivacyRequestType = (typeof SAMPLE_LAB_PRIVACY_REQUEST_TYPES)[number]['code'];

export const SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES = [
  {
    owner_component: 'CMP-030',
    scope_ref: 'consent.purpose.SAMPLE_LAB_PROFILE_PREFILL',
    label: 'Profile prefill consent (CMP-030)',
  },
  {
    owner_component: 'CMP-005',
    scope_ref: 'profile.claims.synthetic',
    label: 'Citizen profile claims (CMP-005)',
  },
  {
    owner_component: 'CMP-015',
    scope_ref: 'application.case.owned',
    label: 'Your applications (CMP-015)',
  },
] as const;

export const SAMPLE_LAB_PRIVACY_RETENTION = {
  visibility: 'POLICY_INPUT_REQUIRED' as const,
  invented_statutory_period_forbidden: true as const,
  citizen_archive_delete_forbidden: true as const,
  note: 'Retention periods are owner-supplied opaque refs (CMP-049). ARCHIVE/DELETE eligibility fail closed until bound. This centre never invents statute or purges foreign tables.',
  entries: [
    {
      owner_component: 'CMP-015',
      resource_kind: 'ApplicationCase',
      period_ref_status: 'UNBOUND' as const,
      eligibility: 'ACTIVE_ONLY_UNTIL_OWNER_PERIOD' as const,
    },
    {
      owner_component: 'CMP-005',
      resource_kind: 'CitizenProfile',
      period_ref_status: 'UNBOUND' as const,
      eligibility: 'ACTIVE_ONLY_UNTIL_OWNER_PERIOD' as const,
    },
    {
      owner_component: 'CMP-030',
      resource_kind: 'Consent',
      period_ref_status: 'UNBOUND' as const,
      eligibility: 'ACTIVE_ONLY_UNTIL_OWNER_PERIOD' as const,
    },
  ],
} as const;

export function isSampleLabPrivacyRequestType(
  value: unknown,
): value is SampleLabPrivacyRequestType {
  return (
    typeof value === 'string' &&
    (SAMPLE_LAB_PRIVACY_REQUEST_TYPES as readonly { code: string }[]).some((t) => t.code === value)
  );
}

export function privacyRequestTypeLabel(code: string | null): string | null {
  if (!code) return null;
  return SAMPLE_LAB_PRIVACY_REQUEST_TYPES.find((t) => t.code === code)?.label ?? code;
}

export function scopeTemplateLabel(ownerComponent: string, scopeRef: string): string {
  const hit = SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES.find(
    (s) => s.owner_component === ownerComponent && s.scope_ref === scopeRef,
  );
  return hit?.label ?? `${ownerComponent}:${scopeRef}`;
}
