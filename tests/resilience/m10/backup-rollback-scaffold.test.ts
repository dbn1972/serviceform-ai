/**
 * M10 backup / restore / rollback harness scaffold — fail-closed.
 * Does not invent RTO/RPO, snapshot IDs, or claim a resilience PASS.
 * Complements resilience-hold.test.ts for Workstream 5 / SF-2 G6 prep.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RESILIENCE_READY = process.env['SF_M10_RESILIENCE_READY'] === '1';
const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKLIST = join(HERE, 'backup-rollback-checklist.yaml');

describe('M10 backup/rollback harness scaffold (fail-closed)', () => {
  it('refuses to claim backup/rollback PASS when SF_M10_RESILIENCE_READY is unset', () => {
    expect(RESILIENCE_READY).toBe(false);
  });

  it('backup-rollback-checklist.yaml is schema-only with OWNER_REQUIRED null fields', () => {
    const text = readFileSync(CHECKLIST, 'utf8');
    expect(text).toContain('status: OWNER_REQUIRED');
    expect(text).toContain('backup_rollback_pass_claimed: false');
    for (const key of [
      'backup_taken_at: null',
      'restore_started_at: null',
      'restore_verified_at: null',
      'rollback_of_unpublished_change: null',
      'published_tsb_pin_preserved: null',
      'aurora_postgresql: null',
      'temporal_namespace: null',
      'object_store: null',
    ]) {
      expect(text, `expected schema key ${key}`).toContain(key);
    }
  });

  it('documents required drill artifacts before G6 resilience may be considered', () => {
    const required = [
      'ops runbook covering Aurora PostgreSQL + Temporal + object store',
      'executed restore drill log (not simulated-only for G6)',
      'rollback drill that preserves published TSB immutability',
      'evidence pack under evidence/ with commit SHA + run identifiers',
    ] as const;
    expect(required.length).toBe(4);
  });

  it.skipIf(!RESILIENCE_READY)(
    'Backup/restore/rollback drill placeholder — only runs when SF_M10_RESILIENCE_READY=1',
    () => {
      expect(RESILIENCE_READY).toBe(true);
    },
  );

  it.todo(
    'Executed restore + rollback drill evidence — blocked until ops cell + runbook authorized',
  );
});
