import { isSupportedPattern } from './pattern';
import {
  allFields,
  FIELD_KEY_RE,
  FORM_KEY_RE,
  isBoolean,
  isChoice,
  isNumeric,
  isSemanticId,
  SEMVER_RE,
  STEP_KEY_RE,
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

function ruleValues(rule: VisibilityRule): Scalar[] {
  if (rule.oneOf !== undefined) return rule.oneOf;
  return rule.equals !== undefined ? [rule.equals] : [];
}

function sameCondition(a: RequiredWhen, b: RequiredWhen): boolean {
  return a.field === b.field && a.equals === b.equals;
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
          ruleValues(section.visibleWhen),
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
            ruleValues(f.visibleWhen),
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
            [f.requiredWhen.equals],
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
