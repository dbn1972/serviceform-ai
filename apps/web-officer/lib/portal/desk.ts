/**
 * SAMPLE_LAB desk labels and role→action mapping for the officer workbench UI.
 * Client-safe: no Node / platform BFF imports (CMP-017 role_code desks only).
 */

/** SAMPLE_LAB desk labels — role codes only; not statutory designations. */
export const DESK_LABELS: Record<string, string> = {
  SAMPLE_LAB_SCRUTINY_OFFICER: 'Scrutiny desk',
  SAMPLE_LAB_APPROVING_AUTHORITY: 'Approving desk',
  SAMPLE_LAB_CASE_OFFICER: 'Case desk',
};

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
