/**
 * Domain invariants for CMP-059 Migration & Legacy Onboarding Workbench.
 *
 * Architecture Constitution §39: dry_run_required_before_execute = true.
 * Lifecycle statuses match FROZEN SF-CON-MIGRATION-PROJECT.
 */

import type { ProjectStatus } from '../repo/migration-repo.js';

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const STATUS_TRANSITIONS: Partial<Record<ProjectStatus, ProjectStatus[]>> = {
  CREATED: ['PROFILED', 'FAILED'],
  PROFILED: ['MAPPED', 'FAILED'],
  MAPPED: ['DRY_RUN', 'FAILED'],
  DRY_RUN: ['DRY_RUN', 'EXECUTED', 'FAILED'],
  EXECUTED: ['RECONCILED', 'FAILED', 'ROLLED_BACK'],
  RECONCILED: ['ROLLED_BACK'],
  FAILED: ['ROLLED_BACK'],
};

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

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

export function validateDisplayName(name: string): boolean {
  return typeof name === 'string' && name.length >= 1 && name.length <= 200;
}

export function validateSourceSystemRef(ref: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(ref);
}

export function validateMappingVersionRef(ref: string): boolean {
  return typeof ref === 'string' && ref.length >= 1 && ref.length <= 128;
}

export function validateIdempotencyKey(key: string): boolean {
  return typeof key === 'string' && key.length >= 8 && key.length <= 128;
}
