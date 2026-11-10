import { SEMVER_RE } from '../forms/model';
import {
  CODE_RE,
  DECISION_WORDS,
  isFieldPath,
  operatorsFor,
  PACK_KEY_RE,
  type RuleDesign,
} from './model';

export type RuleIssueTarget =
  | { kind: 'pack' }
  | { kind: 'row'; id: string }
  | { kind: 'column'; id: string }
  | { kind: 'test'; id: string };

export interface RuleIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  target: RuleIssueTarget;
}

/** Same zero-argument clock/entropy screen CMP-008 applies when it parses a pack. */
const NON_DETERMINISTIC_CALL =
  /(?:^|[^A-Za-z0-9_$])(?:d|date|time|now|today|rand|random|uuid)\s*\(\s*\)/i;
const SAFE_TEXT = /^[A-Za-z0-9 _./-]{1,64}$/;

/**
 * Plain-language checks before CMP-008 sees the pack. CMP-008's parser and the ZEN engine stay
 * authoritative: the Tests tab runs every case through them.
 */
export function lintRules(design: RuleDesign): RuleIssue[] {
  const out: RuleIssue[] = [];
  const pack: RuleIssueTarget = { kind: 'pack' };
  const err = (code: string, message: string, target: RuleIssueTarget = pack) =>
    out.push({ code, severity: 'error', message, target });
  const warn = (code: string, message: string, target: RuleIssueTarget = pack) =>
    out.push({ code, severity: 'warning', message, target });

  if (!PACK_KEY_RE.test(design.packKey)) {
    err(
      'PACK_KEY_INVALID',
      'Rule pack key must start with a lowercase letter and use a–z, 0–9, ".", "_" or "-".',
    );
  }
  if (design.title.trim().length === 0) err('TITLE_REQUIRED', 'Give the rule pack a title.');
  if (!SEMVER_RE.test(design.version)) err('VERSION_INVALID', 'Version must look like 1.0.0.');
  if (design.inputs.length === 0) err('INPUTS_REQUIRED', 'Add at least one input column.');
  if (design.outputs.length === 0) err('OUTPUTS_REQUIRED', 'Add at least one result column.');
  if (design.outputs.filter((o) => o.kind === 'outcome').length > 1) {
    err(
      'OUTCOME_COLUMNS_MULTIPLE',
      'Use one outcome column; CMP-008 reads a single outcome field.',
    );
  }
  if (design.outputs.filter((o) => o.kind === 'reasons').length > 1) {
    err('REASON_COLUMNS_MULTIPLE', 'Use one reason-codes column.');
  }
  const fields = new Set<string>();
  const ids = new Set<string>();
  for (const col of [...design.inputs, ...design.outputs]) {
    const target: RuleIssueTarget = { kind: 'column', id: col.id };
    if (!isFieldPath(col.field)) {
      err(
        'FIELD_INVALID',
        `Column "${col.label || col.field}" field must be letters, digits and "_" (dots between parts).`,
        target,
      );
    }
    if (ids.has(col.id)) err('COLUMN_ID_DUPLICATE', `Column id "${col.id}" is used twice.`, target);
    ids.add(col.id);
    const key = `${'kind' in col ? 'out' : 'in'}:${col.field}`;
    if (fields.has(key))
      err('FIELD_DUPLICATE', `Field "${col.field}" is used by two columns.`, target);
    fields.add(key);
    if (col.label.trim().length === 0)
      err('COLUMN_LABEL_REQUIRED', 'Every column needs a label.', target);
  }
  for (const code of design.outcomes) {
    if (!CODE_RE.test(code))
      err('OUTCOME_CODE_INVALID', `Outcome "${code}" must be CAPITALS, digits and "_".`);
    if (DECISION_WORDS.test(code)) {
      warn(
        'OUTCOME_READS_AS_DECISION',
        `"${code}" reads like a final decision. Rules are advisory (Constitution §20): prefer codes such as MEETS_CRITERIA or REFER_TO_OFFICER.`,
      );
    }
  }
  for (const code of design.reasonCodes) {
    if (!CODE_RE.test(code))
      err('REASON_CODE_INVALID', `Reason "${code}" must be CAPITALS, digits and "_".`);
  }
  if (design.rows.length === 0) err('ROWS_REQUIRED', 'Add at least one rule row.');

  const outcomeCol = design.outputs.find((o) => o.kind === 'outcome');
  const reasonsCol = design.outputs.find((o) => o.kind === 'reasons');
  let catchAllAt = -1;
  design.rows.forEach((row, index) => {
    const target: RuleIssueTarget = { kind: 'row', id: row.id };
    const label = `Row ${index + 1}${row.description ? ` (${row.description})` : ''}`;
    if (catchAllAt >= 0) {
      warn(
        'ROW_UNREACHABLE',
        `${label} is never reached: row ${catchAllAt + 1} already matches everything.`,
        target,
      );
    }
    let any = true;
    for (const input of design.inputs) {
      const c = row.when[input.id];
      if (!c || c.op === 'any') continue;
      any = false;
      if (!operatorsFor(input.type).includes(c.op)) {
        err(
          'CONDITION_OPERATOR_INVALID',
          `${label}: "${input.label}" cannot use that comparison.`,
          target,
        );
      }
      if (input.type === 'number') {
        const nums = c.op === 'between' ? [c.value, c.to] : [c.value];
        if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
          err('CONDITION_NUMBER_REQUIRED', `${label}: "${input.label}" needs a number.`, target);
        }
        if (
          c.op === 'between' &&
          typeof c.value === 'number' &&
          typeof c.to === 'number' &&
          c.value > c.to
        ) {
          err(
            'CONDITION_RANGE_INVALID',
            `${label}: "${input.label}" range starts above its end.`,
            target,
          );
        }
      }
      if (input.type === 'string') {
        const texts = c.op === 'in' ? (c.values ?? []) : [String(c.value ?? '')];
        if (texts.length === 0 || texts.some((t) => !SAFE_TEXT.test(t))) {
          err(
            'CONDITION_TEXT_INVALID',
            `${label}: "${input.label}" values must be 1–64 letters, digits, spaces or . _ / -.`,
            target,
          );
        }
      }
    }
    if (any && catchAllAt < 0) catchAllAt = index;
    if (outcomeCol && !row.then[outcomeCol.id]) {
      warn('ROW_OUTCOME_MISSING', `${label} sets no outcome.`, target);
    }
    for (const output of design.outputs) {
      const v = row.then[output.id];
      if (output.kind === 'outcome' && typeof v === 'string' && v && !design.outcomes.includes(v)) {
        err('ROW_OUTCOME_UNDECLARED', `${label} uses outcome "${v}" that is not declared.`, target);
      }
      if (output.kind === 'reasons') {
        const list = Array.isArray(v) ? v : v ? [v] : [];
        if (list.some((r) => !design.reasonCodes.includes(r))) {
          err('ROW_REASON_UNDECLARED', `${label} uses a reason code that is not declared.`, target);
        }
      }
      if (output.kind === 'value' && typeof v === 'string' && NON_DETERMINISTIC_CALL.test(v)) {
        err(
          'NON_DETERMINISTIC',
          `${label}: clock or random functions are refused; pass dates as inputs.`,
          target,
        );
      }
    }
  });
  if (reasonsCol && design.reasonCodes.length === 0) {
    warn('REASON_CODES_NONE', 'Declare reason codes so officers see why a rule matched.');
  }

  if (design.tests.length === 0) {
    warn('TESTS_NONE', 'Add test cases; CMP-008 runs them before you can freeze the pack.');
  }
  const covered = new Set(design.tests.map((t) => t.expectOutcome).filter(Boolean));
  for (const code of design.outcomes) {
    if (design.tests.length > 0 && !covered.has(code)) {
      warn('OUTCOME_UNTESTED', `No test case expects "${code}".`);
    }
  }
  design.tests.forEach((t, i) => {
    const target: RuleIssueTarget = { kind: 'test', id: t.id };
    if (t.name.trim().length === 0)
      err('TEST_NAME_REQUIRED', `Test ${i + 1} needs a name.`, target);
    if (!t.expectOutcome && (t.expectReasons ?? []).length === 0) {
      err(
        'TEST_EXPECTATION_REQUIRED',
        `Test "${t.name || i + 1}" needs an expected outcome or reasons.`,
        target,
      );
    }
  });
  return out;
}

export function rulesHaveErrors(issues: readonly RuleIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export function rulesDocumentKey(design: RuleDesign): string {
  return `${design.packKey}.v${design.version}`;
}
