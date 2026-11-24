'use client';

import { Button, Select } from '@serviceform/ui-ux4g';
import {
  allFields,
  conditionCandidates,
  conditionText,
  hasComparison,
  isBoolean,
  isChoice,
  lintForm,
  logicRules,
  setRequirementRule,
  setVisibilityRule,
  sharedRequirement,
  type Condition,
  type DesignerForm,
  type RequiredWhen,
  type RuleTarget,
  type VisibilityRule,
} from '@serviceform/studio-designers/forms';
import { useState, type FormEvent } from 'react';
import { ConditionValueEditor, defaultValue } from './ConditionEditor';

type Effect = 'SHOW' | 'HIDE' | 'REQUIRE' | 'REQUIRE_UNLESS';

const EFFECTS: { value: Effect; label: string }[] = [
  { value: 'SHOW', label: 'Show only when' },
  { value: 'HIDE', label: 'Hide when' },
  { value: 'REQUIRE', label: 'Require when' },
  { value: 'REQUIRE_UNLESS', label: 'Require unless' },
];

interface TargetOption {
  key: string;
  target: RuleTarget;
  label: string;
  /** Top-level field: can carry "required when / unless". */
  requirable: boolean;
  /** Paths inside the target, which its rule cannot read. */
  own: Set<string>;
}

function targetOptions(form: DesignerForm): TargetOption[] {
  const out: TargetOption[] = [];
  form.steps.forEach((step, i) => {
    for (const section of step.sections) {
      const sectionLabel = section.label ?? section.object?.title;
      const paths = allFields(form)
        .filter((r) => r.section.id === section.id)
        .map((r) => r.path);
      if (sectionLabel !== undefined && section.fields.length > 0) {
        out.push({
          key: `section:${section.id}`,
          target: { kind: 'section', id: section.id },
          label: `Step ${i + 1} · section “${sectionLabel}”`,
          requirable: false,
          own: new Set(paths),
        });
      }
      for (const f of section.fields) {
        const path = section.object ? `${section.object.key}/${f.key}` : f.key;
        out.push({
          key: `field:${f.id}`,
          target: { kind: 'field', id: f.id },
          label: `Step ${i + 1} · “${f.label.trim() || f.key}”`,
          requirable: !section.object,
          own: new Set([path]),
        });
      }
    }
  });
  return out;
}

function currentRule(form: DesignerForm, option: TargetOption, effect: Effect) {
  if (option.target.kind === 'section') {
    for (const step of form.steps) {
      const found = step.sections.find((s) => s.id === option.target.id);
      if (found) return found.visibleWhen;
    }
    return undefined;
  }
  const ref = allFields(form).find((r) => r.field.id === option.target.id);
  return effect === 'REQUIRE' || effect === 'REQUIRE_UNLESS'
    ? ref?.field.requiredWhen
    : ref?.field.visibleWhen;
}

function isRequirement(effect: Effect): boolean {
  return effect === 'REQUIRE' || effect === 'REQUIRE_UNLESS';
}

/** Answers a rule on `option` may read: never its own, and top-level only for requirements. */
function candidatesFor(form: DesignerForm, option: TargetOption | undefined, effect: Effect) {
  const selfId = option?.target.kind === 'field' ? option.target.id : undefined;
  return conditionCandidates(form, selfId).filter(
    (c) => !option?.own.has(c.path) && (!isRequirement(effect) || !c.path.includes('/')),
  );
}

/** The form as it would be with the draft rule saved, to read back its sentence and checks. */
function withRule(
  form: DesignerForm,
  option: TargetOption,
  effect: Effect,
  condition: Condition,
): DesignerForm {
  if (effect === 'SHOW' || effect === 'HIDE') {
    const rule: VisibilityRule = { ...condition, effect };
    return setVisibilityRule(form, option.target, rule);
  }
  const { answered: _answered, ...compare } = condition;
  const when: RequiredWhen = effect === 'REQUIRE_UNLESS' ? { ...compare, unless: true } : compare;
  return setRequirementRule(form, option.target.id, when);
}

/**
 * Authors a rule on any field or section from the Logic view: choose what it affects, what it
 * does and which answer drives it. Requirement rules start from the form's shared root condition,
 * because CMP-009 evaluates one. Saving goes through the same editing operations as the Inspector.
 */
export function RuleBuilder({
  form,
  onSave,
}: {
  form: DesignerForm;
  onSave: (next: DesignerForm, sentence: string) => void;
}) {
  const options = targetOptions(form);
  const [targetKey, setTargetKey] = useState('');
  const [effect, setEffect] = useState<Effect>('SHOW');
  const [condition, setCondition] = useState<Condition>({ field: '' });
  const option = options.find((o) => o.key === targetKey);
  const requirement = isRequirement(effect);
  const candidates = candidatesFor(form, option, effect);
  const source = candidates.find((c) => c.path === condition.field)?.field;

  const start = (next: TargetOption | undefined, nextEffect: Effect) => {
    const existing = next ? currentRule(form, next, nextEffect) : undefined;
    const shared = isRequirement(nextEffect) ? sharedRequirement(form, next?.target.id) : null;
    if (existing) {
      const { effect: _e, unless: _u, ...rest } = existing as VisibilityRule & RequiredWhen;
      setCondition(rest);
      return;
    }
    if (shared) {
      setCondition(shared);
      return;
    }
    const nextCandidates = candidatesFor(form, next, nextEffect);
    const first =
      nextCandidates.find((c) => isBoolean(c.field.kind) || isChoice(c.field.kind)) ??
      nextCandidates[0];
    setCondition({ field: first?.path ?? '', equals: defaultValue(first?.field) });
  };

  const ready =
    option !== undefined &&
    candidates.some((c) => c.path === condition.field) &&
    hasComparison(condition) &&
    (!requirement || (option.requirable && condition.answered !== true));
  const draft = ready && option ? withRule(form, option, effect, condition) : null;
  const ruleId = option ? `${requirement ? 'required' : 'visible'}:${option.target.id}` : '';
  const sentence = draft ? logicRules(draft).find((r) => r.id === ruleId)?.sentence : undefined;
  const existing = option ? currentRule(form, option, effect) : undefined;
  const shared = requirement ? sharedRequirement(form, option?.target.id) : null;
  const before = new Set(lintForm(form).map((i) => `${i.code}:${i.message}`));
  const problems = draft
    ? lintForm(draft).filter((i) => i.severity === 'error' && !before.has(`${i.code}:${i.message}`))
    : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !sentence) return;
    onSave(draft, sentence);
  };

  return (
    <section className="sf-designer-checks" aria-labelledby="rule-builder-title">
      <h2 id="rule-builder-title" className="ux4g-heading-xs-strong">
        Add or change a rule
      </h2>
      <form className="sf-designer-stack" onSubmit={submit} data-testid="rule-builder">
        <div className="sf-designer-row">
          <Select
            id="rule-target"
            label="Rule for"
            value={targetKey}
            placeholder="Choose a field or section"
            options={options.map((o) => ({ value: o.key, label: o.label }))}
            onChange={(e) => {
              const next = options.find((o) => o.key === e.target.value);
              const nextEffect = next?.requirable || !requirement ? effect : 'SHOW';
              setTargetKey(e.target.value);
              setEffect(nextEffect);
              start(next, nextEffect);
            }}
          />
          <Select
            id="rule-effect"
            label="It should"
            value={effect}
            options={EFFECTS.filter(
              (x) =>
                option === undefined ||
                option.requirable ||
                (x.value !== 'REQUIRE' && x.value !== 'REQUIRE_UNLESS'),
            )}
            onChange={(e) => {
              const next = e.target.value as Effect;
              setEffect(next);
              start(option, next);
            }}
          />
          <Select
            id="rule-source"
            label="Answer to"
            value={condition.field}
            placeholder="Select a field"
            disabled={option === undefined}
            options={candidates.map((c) => ({ value: c.path, label: c.label }))}
            onChange={(e) => {
              const next = candidates.find((c) => c.path === e.target.value)?.field;
              setCondition({
                field: e.target.value,
                ...(condition.answered ? { answered: true } : { equals: defaultValue(next) }),
              });
            }}
          />
          {option ? (
            <ConditionValueEditor
              idPrefix="rule"
              target={source}
              condition={condition}
              allowAnswered={!requirement}
              onChange={(v) => setCondition({ field: condition.field, ...v })}
            />
          ) : null}
        </div>
        {shared ? (
          <p className="ux4g-body-s-default sf-designer-muted">
            Every &ldquo;required when / unless&rdquo; rule shares one condition, because the form
            runtime checks one: {conditionText(form, shared)}.
          </p>
        ) : null}
        {sentence ? (
          <p className="ux4g-body-m-default" data-testid="rule-builder-sentence">
            <span className="ux4g-tag-tonal-info">
              {existing ? 'Replaces the current rule' : 'New rule'}
            </span>{' '}
            {sentence}
          </p>
        ) : null}
        {problems.map((p) => (
          <p key={`${p.code}:${p.message}`} className="ux4g-body-s-default">
            <span className="ux4g-tag-tonal-error">Fix</span> {p.message}
          </p>
        ))}
        <div className="sf-actions">
          <Button type="submit" size="s" disabled={!sentence}>
            {existing ? 'Replace rule' : 'Add rule'}
          </Button>
        </div>
      </form>
    </section>
  );
}
