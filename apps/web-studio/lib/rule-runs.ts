import {
  caseInputs,
  type RuleDesign,
  type RuleTestCase,
} from '@serviceform/studio-designers/rules';
import type { RuleTestCaseInput, RuleTestResult, RuleTestRun } from './studio-api';

/** Last CMP-008 run and the exact pack hash + case inputs it ran against. */
export interface TestRunState {
  key: string;
  body: RuleTestRun;
}

export type Verdict = 'passed' | 'failed' | 'unchecked';

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

/**
 * The engine output depends only on the pack and the inputs, so expectations are compared here:
 * editing an expected result never invalidates a run. A case without expectations is unchecked.
 */
export function verdictOf(test: RuleTestCase, result: RuleTestResult | undefined): Verdict | null {
  if (!result) return null;
  if (result.error) return 'failed';
  const reasons = test.expectReasons ?? [];
  if (!test.expectOutcome && reasons.length === 0) return 'unchecked';
  const outcomeOk = !test.expectOutcome || test.expectOutcome === result.outcome;
  const reasonsOk = reasons.length === 0 || sameSet(reasons, result.reason_codes ?? []);
  return outcomeOk && reasonsOk ? 'passed' : 'failed';
}

export function tally(design: RuleDesign, run: RuleTestRun) {
  const byId = new Map(run.results.map((r) => [r.id, r]));
  const verdicts = design.tests.map((t) => verdictOf(t, byId.get(t.id)));
  return {
    total: design.tests.length,
    passed: verdicts.filter((v) => v === 'passed').length,
    failed: verdicts.filter((v) => v === 'failed').length,
    unchecked: verdicts.filter((v) => v === 'unchecked' || v === null).length,
  };
}

export function testCases(design: RuleDesign): RuleTestCaseInput[] {
  return design.tests.map((t) => ({
    id: t.id,
    inputs: caseInputs(design, t.inputs),
    ...(t.expectOutcome ? { expect_outcome: t.expectOutcome } : {}),
    ...(t.expectReasons?.length ? { expect_reasons: t.expectReasons } : {}),
  }));
}
