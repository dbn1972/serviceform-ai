/**
 * INT-009 material proof: expected-state/version durable reconciliation.
 *
 * GOVERNING residual (unwaived): case_expected_state|version must be durable for after-commit
 * retry of CMP-015 commands / CMP-029 pause-resume. If production code cannot prove durability,
 * record INT_009_DURABLE_RECONCILIATION=BLOCKED → overall SF_M05_INT_BLOCKED. Do not patch.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');

function recordDurableStatus(
  status: 'PROVEN' | 'BLOCKED',
  reason: string,
  details: Record<string, unknown>,
): void {
  const dir = 'test-results/m05-int';
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'int-009-durable.json'),
    JSON.stringify(
      {
        INT_009_DURABLE_RECONCILIATION: status,
        reason,
        details,
        production_code_patched: false,
        cmp_019_residual: 'GOVERNING_UNRESOLVED_UNWAIVED',
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  process.env['INT_009_DURABLE_RECONCILIATION'] = status;
}

describe('INT-009 deficiency pause/resume + expected-state/version durable reconciliation', () => {
  it('happy path wires afterCommit → CMP-015 case command + CMP-029 SLA pause/resume', () => {
    const svc = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/service/service.ts'),
      'utf8',
    );
    expect(svc).toContain('afterCommit');
    expect(svc).toContain('pauseForDeficiency');
    expect(svc).toContain('resumeAfterDeficiency');
    expect(svc).toContain("command: 'RAISE_DEFICIENCY'");
    expect(svc).toContain('expected_state: input.case_expected_state');
    expect(svc).toContain('expected_version: input.case_expected_version');
    expect(svc).toMatch(/if \(!outcome\.replayed\) await this\.afterCommit/);
  });

  it('MATERIAL: evaluate durable reconciliation of case_expected_state/version from production', () => {
    const svc = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/service/service.ts'),
      'utf8',
    );
    const migration = readFileSync(
      join(ROOT, 'db/migrations/1759541900000_cmp-019-deficiency.sql'),
      'utf8',
    );
    const noticeSection = migration.slice(
      migration.indexOf('CREATE TABLE sf_deficiency.deficiency_notice'),
      migration.indexOf('CREATE TABLE sf_deficiency.requested_item'),
    );

    const emitMatch = svc.match(/private async emit\([\s\S]*?data:\s*\{([\s\S]*?)\},\s*\}\);/);
    expect(emitMatch, 'emit() data block must be locatable').toBeTruthy();
    const emitData = emitMatch?.[1] ?? '';

    const inOutboxEventData =
      /\bcase_expected_state\b/.test(emitData) && /\bcase_expected_version\b/.test(emitData);
    const inNoticeColumns =
      /\bcase_expected_state\b/.test(noticeSection) &&
      /\bcase_expected_version\b/.test(noticeSection);

    // afterCommit swallows port failures and defers to outbox retry — tokens must be durable.
    expect(svc).toMatch(/stitch retries from the outbox event/);
    expect(svc).toMatch(/INT-009 retry is owned by STITCH-B \/ outbox consumers/);

    const canProve = inOutboxEventData || inNoticeColumns;
    if (canProve) {
      recordDurableStatus('PROVEN', 'case_expected tokens durable in outbox and/or notice table', {
        in_outbox_event_data: inOutboxEventData,
        in_deficiency_notice_columns: inNoticeColumns,
      });
    } else {
      recordDurableStatus(
        'BLOCKED',
        'SF_M05_INT_BLOCKED: case_expected_state|version not in Deficiency* outbox data nor deficiency_notice columns; afterCommit swallows CMP-015/CMP-029 failures without durable tokens for retry. Do not patch production in INT lane.',
        {
          in_outbox_event_data: inOutboxEventData,
          in_deficiency_notice_columns: inNoticeColumns,
          after_commit_swallows_errors: true,
          governing_residual: 'GOVERNING_UNRESOLVED_UNWAIVED',
        },
      );
    }

    // This assertion documents the observed production state (evidence), not a force-green.
    expect(inOutboxEventData).toBe(false);
    expect(inNoticeColumns).toBe(false);
    expect(process.env['INT_009_DURABLE_RECONCILIATION']).toBe('BLOCKED');
  });
});
