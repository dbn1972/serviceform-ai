'use client';

import { Checkbox, Select, TextInput } from '@serviceform/ui-ux4g';
import {
  isBoolean,
  isChoice,
  isNumeric,
  type Condition,
  type DesignerField,
  type Scalar,
} from '@serviceform/studio-designers/forms';

function encode(v: Scalar | undefined): string {
  return v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
}

function decodeFor(target: DesignerField | undefined, raw: string): Scalar {
  if (target && isBoolean(target.kind)) return raw === 'true';
  if (target && isNumeric(target.kind)) return Number(raw);
  return raw;
}

function ValueInput({
  id,
  label,
  target,
  value,
  onChange,
}: {
  id: string;
  label: string;
  target: DesignerField | undefined;
  value: Scalar | undefined;
  onChange: (v: Scalar) => void;
}) {
  if (target && isBoolean(target.kind)) {
    return (
      <Select
        id={id}
        label={label}
        value={encode(value)}
        options={[
          { value: 'true', label: 'Yes (ticked)' },
          { value: 'false', label: 'No (not ticked)' },
        ]}
        onChange={(e) => onChange(e.target.value === 'true')}
      />
    );
  }
  if (target && isChoice(target.kind)) {
    return (
      <Select
        id={id}
        label={label}
        value={encode(value)}
        placeholder="Select"
        options={(target.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <TextInput
      id={id}
      label={label}
      type={target && isNumeric(target.kind) ? 'number' : 'text'}
      value={encode(value)}
      onChange={(e) => onChange(decodeFor(target, e.target.value))}
    />
  );
}

/** A value the answer can hold, to start a new condition with. */
export function defaultValue(target: DesignerField | undefined): Scalar {
  if (!target) return '';
  if (isBoolean(target.kind)) return true;
  if (isChoice(target.kind)) return target.options?.[0]?.value ?? '';
  if (isNumeric(target.kind)) return 0;
  return '';
}

export type ConditionValue = Pick<Condition, 'equals' | 'oneOf' | 'answered'>;

type Comparison = 'is' | 'any' | 'answered';

/**
 * "Is" one value, "is any of" several (dropdowns and radio buttons) or, for visibility rules,
 * "has any answer". Each compiles to the CMP-009 rule schema `const`, `enum` or `{}`.
 */
export function ConditionValueEditor({
  idPrefix,
  target,
  condition,
  allowAnswered,
  onChange,
}: {
  idPrefix: string;
  target: DesignerField | undefined;
  condition: Condition;
  allowAnswered: boolean;
  onChange: (value: ConditionValue) => void;
}) {
  const options = target && isChoice(target.kind) ? (target.options ?? []) : [];
  const comparison: Comparison =
    condition.answered === true ? 'answered' : condition.oneOf !== undefined ? 'any' : 'is';
  const choices: { value: Comparison; label: string }[] = [
    { value: 'is', label: 'is' },
    ...(options.length > 1 ? [{ value: 'any' as const, label: 'is any of' }] : []),
    ...(allowAnswered ? [{ value: 'answered' as const, label: 'has any answer' }] : []),
  ];
  return (
    <>
      {choices.length > 1 ? (
        <Select
          id={`${idPrefix}-compare`}
          label="Comparison"
          value={comparison}
          options={choices}
          onChange={(e) => {
            const next = e.target.value as Comparison;
            if (next === 'answered') return onChange({ answered: true });
            if (next === 'any') {
              return onChange({
                oneOf: condition.equals !== undefined ? [String(condition.equals)] : [],
              });
            }
            onChange({ equals: condition.oneOf?.[0] ?? defaultValue(target) });
          }}
        />
      ) : null}
      {comparison === 'answered' ? null : comparison === 'any' ? (
        <fieldset className="sf-designer-fieldset">
          <legend className="ux4g-label-m-default">Any of</legend>
          {options.map((o) => (
            <Checkbox
              key={o.value}
              id={`${idPrefix}-any-${o.value}`}
              label={o.label || o.value}
              checked={condition.oneOf?.includes(o.value) === true}
              onChange={(e) => {
                const chosen = new Set(condition.oneOf ?? []);
                if (e.target.checked) chosen.add(o.value);
                else chosen.delete(o.value);
                onChange({ oneOf: options.map((x) => x.value).filter((v) => chosen.has(v)) });
              }}
            />
          ))}
        </fieldset>
      ) : (
        <ValueInput
          id={`${idPrefix}-value`}
          label="Is"
          target={target}
          value={condition.equals}
          onChange={(v) => onChange({ equals: v })}
        />
      )}
    </>
  );
}
