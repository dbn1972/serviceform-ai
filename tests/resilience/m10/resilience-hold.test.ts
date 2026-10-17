/**
 * M10 resilience / backup-restore / rollback hold — fail-closed.
 * Does not invent RTO/RPO or restore procedures. Does not claim resilience PASS.
 * Set SF_M10_RESILIENCE_READY=1 only when ops runbook + restore cell are authorized.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RESILIENCE_READY = process.env['SF_M10_RESILIENCE_READY'] === '1';
const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKLIST = join(HERE, 'resilience-checklist.yaml');

describe('M10 resilience hold (fail-closed)', () => {
  it('refuses to claim resilience PASS when SF_M10_RESILIENCE_READY is unset', () => {
    expect(RESILIENCE_READY).toBe(false);
  });

  it('resilience-checklist.yaml exists as schema-only with OWNER_REQUIRED null targets', () => {
    const text = readFileSync(CHECKLIST, 'utf8');
    expect(text).toContain('status: OWNER_REQUIRED');
    expect(text).toContain('resilience_pass_claimed: false');
    for (const key of [
      'rto_minutes: null',
      'rpo_minutes: null',
      'restore_cell: null',
      'backup_scope: null',
      'rollback_against_published_tsb: null',
    ]) {
      expect(text, `expected schema key ${key}`).toContain(key);
    }
    expect(text).not.toMatch(/rto_minutes:\s*\d/);
    expect(text).not.toMatch(/rpo_minutes:\s*\d/);
  });

  it('documents required resilience artifacts before a restore drill may run', () => {
    const required = [
      'ops runbook: backup/restore/rollback for Aurora PostgreSQL + Temporal + object store',
      'evidence pack with executed restore drill logs (not simulated-only for G6)',
      'rollback drill against a published TSB pin (immutability preserved)',
    ] as const;
    expect(required.length).toBe(3);
    // No invented RTO/RPO — must come from owner ops plan.
    expect(process.env['SF_M10_RTO_MINUTES']).toBeUndefined();
    expect(process.env['SF_M10_RPO_MINUTES']).toBeUndefined();
  });

  it.skipIf(!RESILIENCE_READY)(
    'Resilience drill placeholder — only runs when SF_M10_RESILIENCE_READY=1',
    () => {
      expect(RESILIENCE_READY).toBe(true);
    },
  );

  it.todo(
    'Backup/restore/rollback drill evidence — blocked until ops runbook + restore cell authorized',
  );
});
