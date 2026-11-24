import {
  allFields,
  conditionValues,
  findFieldByPath,
  isBoolean,
  isChoice,
  isNumeric,
  type Condition,
  type DesignerField,
  type DesignerForm,
  type Scalar,
} from './model';

/**
 * Plain-language view of a form's conditional logic, and the answer combinations that exercise
 * it. Nothing here evaluates rules: Studio runs the scenarios through the same UX4G runtime
 * mirror as the citizen form, and CMP-009 stays authoritative on submit.
 */

export type LogicTarget = { kind: 'field' | 'section'; id: string };

export interface LogicRule {
  /** Stable within one form: `visible:<target id>` or `required:<field id>`. */
  id: string;
  kind: 'visibility' | 'requirement';
  effect: 'SHOW' | 'HIDE' | 'REQUIRE';
  target: LogicTarget;
  targetLabel: string;
  stepIndex: number;
  /** Root-relative path of the answer the rule reads. */
  source: string;
  sourceLabel: string;
  sourceMissing: boolean;
  values: Scalar[];
  sentence: string;
}

export interface DriverValue {
  /** `undefined` means the applicant has not answered. */
  value: Scalar | undefined;
  label: string;
}

export interface LogicDriver {
  path: string;
  label: string;
  values: DriverValue[];
}

export interface ScenarioAnswer {
  path: string;
  label: string;
  value: Scalar | undefined;
  valueLabel: string;
}

export interface LogicScenario {
  id: string;
  answers: ScenarioAnswer[];
  /** Form data holding only the driver answers (nested for grouped data). */
  data: Record<string, unknown>;
}

export interface LogicScenarioSet {
  drivers: LogicDriver[];
  scenarios: LogicScenario[];
  /** False when the combinations exceeded the limit and each driver was varied on its own. */
  complete: boolean;
}

export const MAX_SCENARIOS = 64;

const NOT_ANSWERED = 'Not answered';

/** How an author reads one stored value of `field`. */
export function valueLabel(field: DesignerField | undefined, value: Scalar | undefined): string {
  if (value === undefined) return NOT_ANSWERED;
  if (typeof value === 'boolean') return value ? 'Yes (ticked)' : 'No (not ticked)';
  if (field && isChoice(field.kind)) {
    return field.options?.find((o) => o.value === value)?.label || String(value);
  }
  return typeof value === 'string' ? `“${value}”` : String(value);
}

function quoted(label: string): string {
  return `“${label}”`;
}

/** "“Business type” is Shop or Workshop" for a condition. */
export function conditionText(form: DesignerForm, condition: Condition): string {
  const ref = findFieldByPath(form, condition.field);
  const name = ref ? ref.field.label.trim() || ref.path : condition.field || 'a missing field';
  const values = conditionValues(condition).map((v) => valueLabel(ref?.field, v));
  const shown =
    values.length > 1
      ? `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`
      : (values[0] ?? '…');
  return `${quoted(name)} is ${condition.oneOf && values.length > 1 ? `any of ${shown}` : shown}`;
}

function sourceOf(form: DesignerForm, condition: Condition) {
  const ref = findFieldByPath(form, condition.field);
  return {
    source: condition.field,
    sourceLabel: ref ? ref.field.label.trim() || ref.path : condition.field,
    sourceMissing: ref === null,
    values: conditionValues(condition),
  };
}

/** Every visibility and requirement rule in applicant order, as sentences. */
export function logicRules(form: DesignerForm): LogicRule[] {
  const out: LogicRule[] = [];
  form.steps.forEach((step, stepIndex) => {
    for (const section of step.sections) {
      const sectionLabel = section.label ?? section.object?.title ?? step.label;
      if (section.visibleWhen) {
        const rule = section.visibleWhen;
        out.push({
          id: `visible:${section.id}`,
          kind: 'visibility',
          effect: rule.effect,
          target: { kind: 'section', id: section.id },
          targetLabel: sectionLabel,
          stepIndex,
          ...sourceOf(form, rule),
          sentence: `${rule.effect === 'SHOW' ? 'Show' : 'Hide'} the section ${quoted(sectionLabel)} ${rule.effect === 'SHOW' ? 'only when' : 'when'} ${conditionText(form, rule)}.`,
        });
      }
      for (const f of section.fields) {
        const label = f.label.trim() || f.key;
        if (f.visibleWhen) {
          const rule = f.visibleWhen;
          out.push({
            id: `visible:${f.id}`,
            kind: 'visibility',
            effect: rule.effect,
            target: { kind: 'field', id: f.id },
            targetLabel: label,
            stepIndex,
            ...sourceOf(form, rule),
            sentence: `${rule.effect === 'SHOW' ? 'Show' : 'Hide'} ${quoted(label)} ${rule.effect === 'SHOW' ? 'only when' : 'when'} ${conditionText(form, rule)}.`,
          });
        }
        if (f.requiredWhen && !f.required) {
          out.push({
            id: `required:${f.id}`,
            kind: 'requirement',
            effect: 'REQUIRE',
            target: { kind: 'field', id: f.id },
            targetLabel: label,
            stepIndex,
            ...sourceOf(form, f.requiredWhen),
            sentence: `Require ${quoted(label)} when ${conditionText(form, f.requiredWhen)}; otherwise it is optional.`,
          });
        }
      }
    }
  });
  return out;
}

function otherValue(field: DesignerField, used: Scalar[]): Scalar {
  if (isNumeric(field.kind)) {
    const numbers = used.filter((v): v is number => typeof v === 'number');
    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  }
  let candidate = 'something else';
  while (used.includes(candidate)) candidate = `${candidate}!`;
  return candidate;
}

/** The answers that rules read, with every value that changes an outcome plus "not answered". */
export function logicDrivers(form: DesignerForm): LogicDriver[] {
  const rules = logicRules(form);
  const paths = [...new Set(rules.filter((r) => !r.sourceMissing).map((r) => r.source))];
  const order = allFields(form).map((r) => r.path);
  paths.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return paths.flatMap((path) => {
    const ref = findFieldByPath(form, path);
    if (!ref) return [];
    const field = ref.field;
    const used = rules.filter((r) => r.source === path).flatMap((r) => r.values);
    let values: Scalar[];
    if (isBoolean(field.kind)) values = [true, false];
    else if (isChoice(field.kind)) values = (field.options ?? []).map((o) => o.value);
    else values = [...new Set(used), otherValue(field, used)];
    return [
      {
        path,
        label: field.label.trim() || path,
        values: [
          ...values.map((value) => ({ value, label: valueLabel(field, value) })),
          { value: undefined, label: NOT_ANSWERED },
        ],
      },
    ];
  });
}

function dataOf(answers: ScenarioAnswer[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const a of answers) {
    if (a.value === undefined) continue;
    const [head, leaf] = a.path.split('/') as [string, string | undefined];
    if (leaf === undefined) {
      data[head] = a.value;
      continue;
    }
    const child = data[head];
    const object: Record<string, unknown> =
      typeof child === 'object' && child !== null ? (child as Record<string, unknown>) : {};
    object[leaf] = a.value;
    data[head] = object;
  }
  return data;
}

function scenario(drivers: LogicDriver[], picks: number[]): LogicScenario {
  const answers = drivers.map((d, i) => {
    const pick = d.values[picks[i] ?? d.values.length - 1] ?? d.values[d.values.length - 1];
    return {
      path: d.path,
      label: d.label,
      value: pick?.value,
      valueLabel: pick?.label ?? NOT_ANSWERED,
    };
  });
  return { id: picks.join('.'), answers, data: dataOf(answers) };
}

/**
 * Answer combinations for the logic matrix: every combination of driver values while that stays
 * within `max`; otherwise "nothing answered" plus each driver value on its own.
 */
export function logicScenarios(form: DesignerForm, max = MAX_SCENARIOS): LogicScenarioSet {
  const drivers = logicDrivers(form);
  if (drivers.length === 0) return { drivers, scenarios: [], complete: true };
  const total = drivers.reduce((n, d) => n * d.values.length, 1);
  if (total <= max) {
    const scenarios: LogicScenario[] = [];
    const picks = drivers.map(() => 0);
    for (let n = 0; n < total; n += 1) {
      scenarios.push(scenario(drivers, picks));
      for (let i = drivers.length - 1; i >= 0; i -= 1) {
        const size = drivers[i]?.values.length ?? 1;
        picks[i] = ((picks[i] ?? 0) + 1) % size;
        if (picks[i] !== 0) break;
      }
    }
    return { drivers, scenarios, complete: true };
  }
  const unanswered = drivers.map((d) => d.values.length - 1);
  const scenarios = [scenario(drivers, unanswered)];
  drivers.forEach((d, i) => {
    for (let v = 0; v < d.values.length - 1 && scenarios.length < max; v += 1) {
      const picks = [...unanswered];
      picks[i] = v;
      scenarios.push(scenario(drivers, picks));
    }
  });
  return { drivers, scenarios, complete: false };
}
