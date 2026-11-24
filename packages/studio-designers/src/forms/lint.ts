import { isSupportedPattern } from './pattern';
import {
  allFields,
  conditionValues,
  FIELD_KEY_RE,
  FORM_KEY_RE,
  isBoolean,
  isChoice,
  isNumeric,
  isSemanticId,
  SEMVER_RE,
  STEP_KEY_RE,
  type Condition,
  type DesignerField,
  type DesignerForm,
  type FieldRef,
  type RequiredWhen,
  type Scalar,
  type VisibilityRule,
} from './model';

export type IssueSeverity = 'error' | 'warning';

export type IssueTarget =
  | { kind: 'form' }
  | { kind: 'step'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'field'; id: string };

export interface DesignIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  target: IssueTarget;
}

/** CMP-009 refuses UI schemas above this many nodes (`UI_SCHEMA_TOO_LARGE`). */
export const MAX_UI_NODES = 256;

export function documentKey(form: DesignerForm): string {
  return `${form.formId}.v${form.version}`;
}

function uiNodeCount(form: DesignerForm): number {
  let n = 1;
  for (const step of form.steps) {
    n += 1;
    for (const section of step.sections) {
      if (section.label !== undefined || section.visibleWhen) n += 1;
      n += section.fields.length;
    }
  }
  return n;
}

function valueFits(target: DesignerField, value: Scalar): boolean {
  if (isBoolean(target.kind)) return typeof value === 'boolean';
  if (isNumeric(target.kind)) return typeof value === 'number';
  if (isChoice(target.kind)) {
    return typeof value === 'string' && (target.options ?? []).some((o) => o.value === value);
  }
  return typeof value === 'string';
}

function checkCondition(
  out: DesignIssue[],
  refs: FieldRef[],
  self: { id: string; label: string; order: number; target: IssueTarget },
  field: string,
  values: Scalar[],
  what: 'Visibility' | 'Requirement',
) {
  const targetRef = refs.find((r) => r.path === field);
  if (!targetRef) {
    out.push({
      code: 'RULE_TARGET_MISSING',
      severity: 'error',
      message: `${what} rule on "${self.label}" refers to a field that no longer exists (${field || 'none'}).`,
      target: self.target,
    });
    return;
  }
  if (targetRef.field.id === self.id) {
    out.push({
      code: 'RULE_SELF_REFERENCE',
      severity: 'error',
      message: `${what} rule on "${self.label}" cannot depend on the field itself.`,
      target: self.target,
    });
    return;
  }
  if (values.length === 0) {
    out.push({
      code: 'RULE_VALUE_MISSING',
      severity: 'error',
      message: `${what} rule on "${self.label}" needs a value to compare with.`,
      target: self.target,
    });
  } else if (!values.every((v) => valueFits(targetRef.field, v))) {
    out.push({
      code: 'RULE_VALUE_TYPE',
      severity: 'warning',
      message: `${what} rule on "${self.label}" compares "${targetRef.field.label}" with a value it cannot hold.`,
      target: self.target,
    });
  }
  if (refs.indexOf(targetRef) > self.order) {
    out.push({
      code: 'RULE_TARGET_LATER',
      severity: 'warning',
      message: `"${self.label}" depends on "${targetRef.field.label}", which the applicant only reaches later.`,
      target: self.target,
    });
  }
}

function sameCondition(a: RequiredWhen, b: RequiredWhen): boolean {
  const av = conditionValues(a);
  const bv = conditionValues(b);
  return (
    a.field === b.field &&
    (a.oneOf === undefined) === (b.oneOf === undefined) &&
    av.length === bv.length &&
    av.every((v, i) => v === bv[i])
  );
}

function sameRule(a: VisibilityRule, b: VisibilityRule): boolean {
  return a.effect === b.effect && sameCondition(a, b);
}

/** Rules that can hide a field: its own and its section's. */
function hidingRules(ref: FieldRef): VisibilityRule[] {
  return [ref.field.visibleWhen, ref.section.visibleWhen].filter(
    (r): r is VisibilityRule => r !== undefined,
  );
}

/**
 * The citizen form evaluates rules on every answer given, but submits only the answers that are
 * shown, and CMP-009 evaluates the same rules again on that submission. A rule that reads an answer
 * which can itself be hidden therefore needs its target hidden at least as often as that answer;
 * otherwise the submitted form behaves differently. A HIDE rule can then make a required field
 * reappear on submit and block it, so that case is an error; the others are advice.
 */
function checkHiddenSources(out: DesignIssue[], refs: FieldRef[]) {
  const byPath = new Map(refs.map((r) => [r.path, r]));
  const check = (
    target: IssueTarget,
    label: string,
    targetRules: VisibilityRule[],
    condition: Condition,
    blocks: boolean,
  ) => {
    const source = byPath.get(condition.field);
    if (!source) return;
    const missing = hidingRules(source).filter((r) => !targetRules.some((t) => sameRule(r, t)));
    if (missing.length === 0) return;
    const sourceLabel = source.field.label.trim() || source.field.key;
    const fix = `Put "${label}" in the same conditional section as "${sourceLabel}", or base the rule on an answer that is always shown.`;
    out.push(
      blocks
        ? {
            code: 'RULE_HIDDEN_SOURCE_BLOCKS',
            severity: 'error',
            message: `"${label}" is hidden by an answer to "${sourceLabel}", which is itself only shown sometimes. When "${sourceLabel}" is hidden its answer is not submitted, so "${label}" reappears on submit and its required answer blocks the application. ${fix}`,
            target,
          }
        : {
            code: 'RULE_HIDDEN_SOURCE',
            severity: 'warning',
            message: `"${label}" depends on "${sourceLabel}", which is only shown sometimes. When "${sourceLabel}" is hidden its answer is not submitted, so the form engine may treat "${label}" differently on submit. ${fix}`,
            target,
          },
    );
  };
  const sections = new Map<string, FieldRef[]>();
  for (const r of refs) sections.set(r.section.id, [...(sections.get(r.section.id) ?? []), r]);
  for (const [, members] of sections) {
    const section = members[0]?.section;
    const rule = section?.visibleWhen;
    if (!section || !rule) continue;
    if (members.some((m) => m.path === rule.field)) continue;
    const name = section.label ?? section.object?.title ?? 'section';
    const requires = members.some((m) => m.field.required || m.field.requiredWhen !== undefined);
    check(
      { kind: 'section', id: section.id },
      name,
      [rule],
      rule,
      rule.effect === 'HIDE' && requires,
    );
  }
  for (const r of refs) {
    const label = r.field.label.trim() || r.field.key;
    const target: IssueTarget = { kind: 'field', id: r.field.id };
    const own = hidingRules(r);
    const rule = r.field.visibleWhen;
    if (rule && rule.field !== r.path) {
      const requires = r.field.required || r.field.requiredWhen !== undefined;
      check(target, label, own, rule, rule.effect === 'HIDE' && requires);
    }
    if (r.field.requiredWhen && r.field.requiredWhen.field !== r.path) {
      check(target, label, own, r.field.requiredWhen, false);
    }
  }
}

interface VisibilityEdge {
  to: string;
  effect: VisibilityRule['effect'];
}

/**
 * A field is shown only while its own rule and its section's rule hold, so it waits on the fields
 * those rules read. A loop of SHOW waits can never open: every field in it stays hidden.
 */
function checkVisibilityLoops(out: DesignIssue[], refs: FieldRef[]) {
  const byPath = new Map(refs.map((r) => [r.path, r]));
  const edges = new Map<string, VisibilityEdge[]>();
  for (const r of refs) {
    const own: VisibilityEdge[] = [];
    const rule = r.field.visibleWhen;
    if (rule && rule.field !== r.path && byPath.has(rule.field)) {
      own.push({ to: rule.field, effect: rule.effect });
    }
    const sectionRule = r.section.visibleWhen;
    if (sectionRule && byPath.has(sectionRule.field)) {
      own.push({ to: sectionRule.field, effect: sectionRule.effect });
    }
    edges.set(r.path, own);
  }
  const state = new Map<string, 'open' | 'done'>();
  const stack: { path: string; effect: VisibilityEdge['effect'] | null }[] = [];
  const reported = new Set<string>();
  const visit = (path: string) => {
    state.set(path, 'open');
    for (const edge of edges.get(path) ?? []) {
      if (state.get(edge.to) === 'open') {
        const start = stack.findIndex((s) => s.path === edge.to);
        const loop = [...stack.slice(start + 1).map((s) => s.effect), edge.effect];
        const members = [...stack.slice(start).map((s) => s.path), path].filter(
          (p, i, all) => all.indexOf(p) === i,
        );
        const key = [...members].sort().join('|');
        if (reported.has(key)) continue;
        reported.add(key);
        const ordered = refs.filter((r) => members.includes(r.path));
        const first = ordered[0];
        if (!first) continue;
        const names = ordered.map((r) => `"${r.field.label.trim() || r.field.key}"`);
        const target: IssueTarget = { kind: 'field', id: first.field.id };
        if (loop.every((e) => e === 'SHOW')) {
          out.push({
            code: 'RULE_UNREACHABLE',
            severity: 'error',
            message:
              members.length === 1
                ? `${names[0]} can never be shown: its section is shown only once ${names[0]} itself is answered.`
                : `${names.join(' and ')} each wait for the other to be answered, so the applicant can never see them.`,
            target,
          });
        } else {
          out.push({
            code: 'RULE_CYCLE',
            severity: 'warning',
            message: `${names.join(' and ')} hide or show each other; check in Logic that the applicant can still reach every answer.`,
            target,
          });
        }
        continue;
      }
      if (state.has(edge.to)) continue;
      stack.push({ path: edge.to, effect: edge.effect });
      visit(edge.to);
      stack.pop();
    }
    state.set(path, 'done');
  };
  for (const r of refs) {
    if (state.has(r.path)) continue;
    stack.push({ path: r.path, effect: null });
    visit(r.path);
    stack.pop();
  }
}

/**
 * Author-time checks that mirror what CMP-033 and CMP-009 will refuse, in plain language.
 * Errors block saving and publication; warnings are advice. CMP-009 remains authoritative.
 */
export function lintForm(form: DesignerForm): DesignIssue[] {
  const out: DesignIssue[] = [];
  const formTarget: IssueTarget = { kind: 'form' };
  const err = (code: string, message: string, target: IssueTarget = formTarget) =>
    out.push({ code, severity: 'error', message, target });
  const warn = (code: string, message: string, target: IssueTarget = formTarget) =>
    out.push({ code, severity: 'warning', message, target });

  if (!FORM_KEY_RE.test(form.formId)) {
    err(
      'FORM_ID_INVALID',
      'Form key must start with a lowercase letter and use only a–z, 0–9, ".", "_" or "-" (2–128 characters).',
    );
  }
  if (form.title.trim().length === 0) err('TITLE_REQUIRED', 'Give the form a title.');
  if (!SEMVER_RE.test(form.version)) {
    err('VERSION_INVALID', 'Version must look like 1.0.0 (major.minor.patch).');
  }
  if (documentKey(form).length > 128) {
    err('DOCUMENT_KEY_TOO_LONG', 'Form key and version together must fit in 128 characters.');
  }
  if (form.steps.length === 0) err('NO_STEPS', 'Add at least one step.');

  const refs = allFields(form);
  if (form.steps.length > 0 && refs.length === 0) err('NO_FIELDS', 'Add at least one field.');
  if (uiNodeCount(form) > MAX_UI_NODES) {
    err('UI_TOO_LARGE', `The form has more than ${MAX_UI_NODES} layout nodes; split it up.`);
  }

  const stepKeys = new Set<string>();
  const reviewSteps = form.steps.filter((s) => s.review);
  if (reviewSteps.length > 1) {
    warn('REVIEW_STEP_MULTIPLE', 'Only one review step is shown before submit.');
  }
  const last = form.steps[form.steps.length - 1];
  if (reviewSteps.length > 0 && last && !last.review) {
    warn('REVIEW_STEP_NOT_LAST', 'Put the review step last so applicants check everything once.');
  }

  const topKeys = new Map<string, string>();
  for (const step of form.steps) {
    const stepTarget: IssueTarget = { kind: 'step', id: step.id };
    if (step.label.trim().length === 0)
      err('STEP_LABEL_REQUIRED', 'Every step needs a name.', stepTarget);
    if (!STEP_KEY_RE.test(step.key)) {
      err('STEP_KEY_INVALID', `Step "${step.label}" has an invalid page id.`, stepTarget);
    } else if (stepKeys.has(step.key)) {
      err('STEP_KEY_DUPLICATE', `Step "${step.label}" repeats page id "${step.key}".`, stepTarget);
    }
    stepKeys.add(step.key);
    if (step.sections.every((s) => s.fields.length === 0)) {
      err('STEP_EMPTY', `Step "${step.label || 'untitled'}" has no fields.`, stepTarget);
    }
    for (const section of step.sections) {
      const sectionTarget: IssueTarget = { kind: 'section', id: section.id };
      const name = section.label ?? section.object?.title ?? step.label;
      if (section.fields.length === 0) {
        warn('SECTION_EMPTY', `Section "${name}" has no fields yet.`, sectionTarget);
      }
      if (section.object) {
        if (!FIELD_KEY_RE.test(section.object.key)) {
          err(
            'OBJECT_KEY_INVALID',
            `Grouped data key "${section.object.key}" must be lowercase letters, digits and "_".`,
            sectionTarget,
          );
        }
        if (section.object.title.trim().length === 0) {
          err('OBJECT_TITLE_REQUIRED', `Section "${name}" needs a data title.`, sectionTarget);
        }
        if (topKeys.has(section.object.key)) {
          err(
            'FIELD_KEY_DUPLICATE',
            `Key "${section.object.key}" is used more than once.`,
            sectionTarget,
          );
        }
        topKeys.set(section.object.key, section.id);
        const requiredFields = section.fields.filter((f) => f.required);
        if (requiredFields.length > 0 && section.visibleWhen) {
          err(
            'OBJECT_SECTION_HIDDEN',
            `Section "${name}" stores its answers together and can be hidden. The form engine still requires grouped data while it is hidden, so applicants who never see it could not submit. Switch off "Store these answers together", or remove the section's rule.`,
            sectionTarget,
          );
        } else if (requiredFields.length > 0 && requiredFields.every((f) => f.visibleWhen)) {
          warn(
            'OBJECT_FIELDS_HIDDEN',
            `Every required answer in "${name}" can be hidden. If they are all hidden at once, the form engine still requires the grouped data and blocks the application; check this in Logic, or switch off "Store these answers together".`,
            sectionTarget,
          );
        }
      }
      if (section.visibleWhen) {
        const order = refs.findIndex((r) => r.section.id === section.id);
        checkCondition(
          out,
          refs,
          {
            id: section.id,
            label: name,
            order: order < 0 ? refs.length : order,
            target: sectionTarget,
          },
          section.visibleWhen.field,
          conditionValues(section.visibleWhen),
          'Visibility',
        );
      }
      const local = new Set<string>();
      for (const f of section.fields) {
        const fieldTarget: IssueTarget = { kind: 'field', id: f.id };
        const label = f.label.trim() || f.key;
        if (f.label.trim().length === 0) {
          err('FIELD_LABEL_REQUIRED', `Field "${f.key}" needs a label.`, fieldTarget);
        }
        if (!FIELD_KEY_RE.test(f.key)) {
          err(
            'FIELD_KEY_INVALID',
            `Key "${f.key}" must start with a lowercase letter and use a–z, 0–9 or "_" (2–64 characters).`,
            fieldTarget,
          );
        }
        const scope = section.object ? local : topKeys;
        if (scope.has(f.key)) {
          err('FIELD_KEY_DUPLICATE', `Key "${f.key}" is used more than once.`, fieldTarget);
        }
        if (section.object) local.add(f.key);
        else topKeys.set(f.key, f.id);
        lintField(f, label, fieldTarget, err, warn);
        const order = refs.findIndex((r) => r.field.id === f.id);
        if (f.visibleWhen) {
          checkCondition(
            out,
            refs,
            { id: f.id, label, order, target: fieldTarget },
            f.visibleWhen.field,
            conditionValues(f.visibleWhen),
            'Visibility',
          );
        }
        if (f.requiredWhen) {
          if (section.object) {
            err(
              'CONDITIONAL_NESTED',
              `"${label}" sits inside grouped data; "required when" applies to top-level fields only.`,
              fieldTarget,
            );
          }
          if (f.requiredWhen.field.includes('/')) {
            err(
              'CONDITION_NESTED_TARGET',
              `"${label}" can only depend on a top-level field for "required when".`,
              fieldTarget,
            );
          }
          checkCondition(
            out,
            refs,
            { id: f.id, label, order, target: fieldTarget },
            f.requiredWhen.field,
            conditionValues(f.requiredWhen),
            'Requirement',
          );
          if (f.required) {
            warn(
              'REQUIRED_CONFLICT',
              `"${label}" is always required, so its "required when" condition has no effect.`,
              fieldTarget,
            );
          }
        }
      }
    }
  }

  const conditions = refs.flatMap((r) => (r.field.requiredWhen ? [r.field.requiredWhen] : []));
  const first = conditions[0];
  if (first && conditions.some((c) => !sameCondition(c, first))) {
    err(
      'CONDITIONAL_MULTIPLE',
      'All "required when" rules must share one condition (the form runtime evaluates a single root condition).',
    );
  }
  checkVisibilityLoops(out, refs);
  checkHiddenSources(out, refs);
  return out;
}

function lintField(
  f: DesignerField,
  label: string,
  target: IssueTarget,
  err: (code: string, message: string, target?: IssueTarget) => void,
  warn: (code: string, message: string, target?: IssueTarget) => void,
) {
  if (isChoice(f.kind)) {
    const options = f.options ?? [];
    if (options.length === 0)
      err('OPTIONS_REQUIRED', `"${label}" needs at least one option.`, target);
    else if (options.length === 1) warn('OPTIONS_FEW', `"${label}" has only one option.`, target);
    const seen = new Set<string>();
    for (const o of options) {
      if (o.value.trim().length === 0) {
        err('OPTION_VALUE_EMPTY', `"${label}" has an option without a stored value.`, target);
      } else if (seen.has(o.value)) {
        err('OPTION_VALUE_DUPLICATE', `"${label}" repeats option value "${o.value}".`, target);
      }
      seen.add(o.value);
      if (o.label.trim().length === 0) {
        warn('OPTION_LABEL_EMPTY', `"${label}" has an option without a visible label.`, target);
      }
    }
  }
  if (f.pattern !== undefined && f.pattern.length > 0 && !isSupportedPattern(f.pattern)) {
    err(
      'PATTERN_UNSUPPORTED',
      `"${label}" uses a pattern the form runtime cannot check. Use the pattern builder.`,
      target,
    );
  }
  const negative = [f.minLength, f.maxLength].some(
    (n) => n !== undefined && (n < 0 || !Number.isInteger(n)),
  );
  if (negative) err('LENGTH_INVALID', `"${label}" lengths must be whole numbers ≥ 0.`, target);
  if (f.minLength !== undefined && f.maxLength !== undefined && f.minLength > f.maxLength) {
    err('LENGTH_RANGE', `"${label}" minimum length is above its maximum.`, target);
  }
  if (f.minimum !== undefined && f.maximum !== undefined && f.minimum > f.maximum) {
    err('NUMBER_RANGE', `"${label}" minimum is above its maximum.`, target);
  }
  if (f.kind === 'declaration' && !f.required) {
    warn('DECLARATION_OPTIONAL', `Declaration "${label}" is usually required.`, target);
  }
  if (f.semanticElementId !== undefined && !isSemanticId(f.semanticElementId)) {
    warn(
      'SEMANTIC_ID_FORMAT',
      `"${label}" is bound to "${f.semanticElementId}", which is not a canonical SF-SEM id.`,
      target,
    );
  }
}

export function hasErrors(issues: readonly DesignIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
