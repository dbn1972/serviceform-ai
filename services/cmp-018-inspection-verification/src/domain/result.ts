import { Cmp018Error, detail } from '../errors.js';
import { assertOnlyKeys, codeField, requireRecord } from './validate.js';

/** Non-statutory site/evidence verification outcomes. Never case approval or eligibility. */
export const VERIFICATION_RESULTS = [
  'VERIFIED',
  'NOT_VERIFIED',
  'INCONCLUSIVE',
  'DEFICIENCY_NOTED',
] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

const STATUTORY_FORBIDDEN =
  /^(APPROVED|REJECTED|ELIGIBLE|INELIGIBLE|APPROVE|REJECT|GRANT|DENY|RECORD_APPROVED|RECORD_REJECTED)$/;

export const STATUTORY_CASE_COMMANDS = new Set(['RECORD_APPROVED', 'RECORD_REJECTED']);

export function parseVerificationResult(body: unknown): VerificationResult {
  const obj = requireRecord(body, '');
  if ('tenant_id' in obj) throw new Cmp018Error('SF-TEN-002');
  assertOnlyKeys(obj, ['verification_result'], '');
  const value = codeField(obj, 'verification_result', '');
  if (STATUTORY_FORBIDDEN.test(value) || value === 'AI_DECISION') {
    throw new Cmp018Error(
      'SF-AUTH-002',
      detail('STATUTORY_RESULT_FORBIDDEN', '/verification_result'),
    );
  }
  if (!(VERIFICATION_RESULTS as readonly string[]).includes(value)) {
    throw new Cmp018Error(
      'SF-SYS-003',
      detail('INVALID_VERIFICATION_RESULT', '/verification_result'),
    );
  }
  return value as VerificationResult;
}

export function assertNotStatutoryCaseCommand(commandType: string): void {
  if (STATUTORY_CASE_COMMANDS.has(commandType) || STATUTORY_FORBIDDEN.test(commandType)) {
    throw new Cmp018Error('SF-AUTH-002', detail('STATUTORY_CASE_COMMAND_FORBIDDEN'));
  }
}

export function assertNotAiFinal(actorType: string, decisionMaker?: string): void {
  if (decisionMaker === 'AI' || actorType === 'INTEGRATION') {
    throw new Cmp018Error('SF-AUTH-002', detail('AI_FINAL_DECISION_FORBIDDEN'));
  }
}
