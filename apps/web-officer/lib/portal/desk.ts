/**
 * SAMPLE_LAB desk labels, role→action mapping, and post-login desk home paths.
 * Client-safe: no Node / platform BFF imports. Branch on role_code only — never
 * officer subject, display_name, or named people.
 */

/** SAMPLE_LAB desk labels — role codes only; not statutory designations. */
export const DESK_LABELS: Record<string, string> = {
  SAMPLE_LAB_SCRUTINY_OFFICER: 'Scrutiny desk',
  SAMPLE_LAB_APPROVING_AUTHORITY: 'Approving desk',
  SAMPLE_LAB_CASE_OFFICER: 'Case desk',
  SAMPLE_LAB_HELPDESK_L1: 'Helpdesk L1',
  SAMPLE_LAB_HELPDESK_L2: 'Helpdesk L2',
  SAMPLE_LAB_HELPDESK_L3: 'Helpdesk L3',
};

const CASE_DESK_ROLE_CODES = [
  'SAMPLE_LAB_SCRUTINY_OFFICER',
  'SAMPLE_LAB_APPROVING_AUTHORITY',
  'SAMPLE_LAB_CASE_OFFICER',
] as const;

export function isHelpdeskRole(roleCode: string): boolean {
  return roleCode.startsWith('SAMPLE_LAB_HELPDESK_');
}

export function deskRoles(roles: readonly string[]): string[] {
  return roles.filter((r) => r in DESK_LABELS || r.startsWith('SAMPLE_LAB_'));
}

/** Desk action implied by the HUMAN_TASK role_code (graph assignment). */
export type DeskAction = 'FORWARD' | 'APPROVE' | 'REJECT';

export function deskActionsForRole(roleCode: string): DeskAction[] {
  if (roleCode === 'SAMPLE_LAB_APPROVING_AUTHORITY') return ['APPROVE', 'REJECT'];
  if (roleCode === 'SAMPLE_LAB_SCRUTINY_OFFICER') return ['FORWARD', 'REJECT'];
  // Combined case desk (golden path): full decide + approve.
  return ['APPROVE', 'REJECT'];
}

/**
 * Post-SIM-login destination from CMP-004 session role codes.
 * Explicit `?next=` still wins via safeNext; this is the fallback only.
 * UX routing does not widen OPA — authz stays fail-closed on role grants.
 */
export function deskHomeForRoles(roles: readonly string[]): string {
  const has = (code: string) => roles.includes(code);
  const helpdesk = roles.filter(isHelpdeskRole);
  const caseDesks = CASE_DESK_ROLE_CODES.filter(has);

  if (helpdesk.length > 0 && caseDesks.length === 0) return '/helpdesk';

  if (caseDesks.length === 1) {
    const only = caseDesks[0]!;
    if (only === 'SAMPLE_LAB_CASE_OFFICER') return '/applications';
    return `/applications?desk=${encodeURIComponent(only)}`;
  }
  if (caseDesks.length > 1) return '/applications';

  // Studio / non-desk roles: officer home (no invented case desk).
  return '/';
}
