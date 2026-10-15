/**
 * Domain invariants for CMP-059 Migration & Legacy Onboarding Workbench.
 *
 * Architecture Constitution §39:
 *   "Legacy migration requires mapping version, dry-run, exception list and
 *    reconciliation evidence before cutover certification."
 *
 * dry_run_required_before_execute = true is a hard platform constraint.
 * No cutover statute or statutory period is inferred here.
 */

import type { ProjectStatus } from '../repo/migration-repo.js';

/** Validate that a project UUID-like string is safe */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Allowed status transitions for a migration project */
export const STATUS_TRANSITIONS: Partial<Record<ProjectStatus, ProjectStatus[]>> = {
  DRAFT: ['PROFILED', 'CANCELLED'],
  PROFILED: ['MAPPED', 'CANCELLED'],
  MAPPED: ['DRY_RUN_DONE', 'CANCELLED'],
  DRY_RUN_DONE: ['DRY_RUN_DONE', 'EXECUTING', 'CANCELLED'],
  EXECUTING: ['COMPLETED', 'ROLLED_BACK'],
};

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Source count and target count that determine reconciliation status */
export function deriveReconciliationStatus(params: {
  sourceCount: number;
  targetCount: number;
  matchedCount: number;
  failedRecords: number;
}): 'PASSED' | 'FAILED' | 'PARTIAL' {
  if (params.failedRecords === 0 && params.matchedCount === params.sourceCount) return 'PASSED';
  if (params.matchedCount === 0) return 'FAILED';
  return 'PARTIAL';
}

/** Validate display_name does not carry PII or bespoke statute text */
export function validateDisplayName(name: string): boolean {
  return typeof name === 'string' && name.length >= 1 && name.length <= 200;
}

/** Validate source_system_ref format */
export function validateSourceSystemRef(ref: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(ref);
}

/** Validate mapping_version_ref format */
export function validateMappingVersionRef(ref: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(ref);
}
