'use client';

import { Alert, Button, Checkbox, Icon, Select, TextInput } from '@serviceform/ui-ux4g';
import {
  CODE_RE,
  DECISION_WORDS,
  moveRow,
  OPERATOR_LABEL,
  operatorsFor,
  removeColumn,
  removeRow,
  rowsUsingCode,
  setCondition,
  setResult,
  updateInput,
  updateOutput,
  updateRow,
  type Condition,
  type InputType,
  type Operator,
  type OutputKind,
  type RuleDesign,
  type RuleInput,
  type RuleIssue,
  type RuleRow,
} from '@serviceform/studio-designers/rules';
import { useState } from 'react';

export type RuleSelection =
  | { kind: 'pack' }
  | { kind: 'row'; id: string }
  | { kind: 'column'; id: string }
  | { kind: 'test'; id: string };

type Apply = (next: RuleDesign, coalesce?: string) => void;

const INPUT_TYPES: { value: InputType; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'string', label: 'Text code' },
  { value: 'boolean', label: 'Yes / no' },
];

const OUTPUT_KINDS: { value: OutputKind; label: string }[] = [
  { value: 'outcome', label: 'Outcome code (one per row)' },
  { value: 'reasons', label: 'Reason codes (list)' },
  { value: 'value', label: 'Value (ZEN expression)' },
];

function num(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function RuleChecks({
  issues,
  select,
}: {
  issues: readonly RuleIssue[];
  select: (s: RuleSelection) => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <section className="sf-designer-checks" aria-labelledby="rules-checks-title">
      <h3 id="rules-checks-title" className="ux4g-label-l-strong">
        Checks{' '}
        <span className={errors > 0 ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-success'}>
          {errors > 0 ? `${errors} to fix` : 'Ready to save'}
        </span>
      </h3>
      {issues.length === 0 ? (
        <p className="ux4g-body-s-default">
          No problems found. CMP-008 parses the pack again and runs every test on the ZEN engine.
        </p>
      ) : (
        <ul className="sf-designer-check-list">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              <span
                className={
                  issue.severity === 'error' ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-warning'
                }
              >
                {issue.severity === 'error' ? 'Fix' : 'Advice'}
              </span>
              <span className="ux4g-body-s-default">{issue.message}</span>
              {issue.target.kind !== 'pack' ? (
                <Button
                  variant="text-primary"
                  size="xs"
                  onClick={() => select(issue.target as RuleSelection)}
                >
                  Show
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Add/remove declared codes; a code still used by a row cannot be removed. */
function CodeList({
  id,
  label,
  hint,
  codes,
  design,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  codes: string[];
  design: RuleDesign;
  readOnly: boolean;
  onChange: (codes: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const value = draft
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const invalid =
    value.length > 0 && !CODE_RE.test(value)
      ? 'Use CAPITALS, digits and "_" (at least 2 characters).'
      : codes.includes(value)
        ? 'Already declared.'
        : undefined;
  return (
    <fieldset className="sf-designer-fieldset" disabled={readOnly}>
      <legend className="ux4g-label-m-strong">{label}</legend>
      <ul className="sf-rules-code-list">
        {codes.map((code) => {
          const used = rowsUsingCode(design, code);
          return (
            <li key={code}>
              <span
                className={
                  DECISION_WORDS.test(code) ? 'ux4g-tag-tonal-warning' : 'ux4g-tag-outline-neutral'
                }
              >
                {code}
              </span>
              {used.length > 0 ? (
                <span className="ux4g-body-s-default sf-designer-muted">
                  row{used.length === 1 ? '' : 's'} {used.join(', ')}
                </span>
              ) : (
                <Button
                  variant="text-neutral"
                  size="xs"
                  aria-label={`Remove ${code}`}
                  onClick={() => onChange(codes.filter((c) => c !== code))}
                >
                  <Icon name="trash" size={16} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="sf-designer-row sf-designer-row-end">
        <TextInput
          id={id}
          label={`Add ${label.toLowerCase().replace(/s$/, '')}`}
          hint={hint}
          size="s"
          value={draft}
          error={invalid}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value && !invalid) {
              e.preventDefault();
              onChange([...codes, value]);
              setDraft('');
            }
          }}
        />
        <Button
          variant="outline-primary"
          size="s"
          disabled={!value || invalid !== undefined}
          onClick={() => {
            onChange([...codes, value]);
            setDraft('');
          }}
        >
          Add
        </Button>
      </div>
    </fieldset>
  );
}

function ConditionEditor({
  row,
  input,
  readOnly,
  onChange,
}: {
  row: RuleRow;
  input: RuleInput;
  readOnly: boolean;
  onChange: (c: Condition, coalesce: string) => void;
}) {
  const c: Condition = row.when[input.id] ?? { op: 'any' };
  const base = `rules-${row.id}-${input.id}`;
  const ops = operatorsFor(input.type);
  return (
    <fieldset className="sf-designer-fieldset" disabled={readOnly}>
      <legend className="ux4g-label-m-strong">
        When {input.label || input.field} <code className="sf-hash">{input.field}</code>
      </legend>
      <Select
        id={`${base}-op`}
        label="Condition"
        size="s"
        value={c.op}
        options={ops.map((op) => ({ value: op, label: OPERATOR_LABEL[op] }))}
        onChange={(e) => {
          const op = e.target.value as Operator;
          if (op === 'any') return onChange({ op }, `${base}-op`);
          if (op === 'in')
            return onChange(
              { op, values: c.values ?? (c.value ? [String(c.value)] : []) },
              `${base}-op`,
            );
          const value = input.type === 'boolean' ? (c.value ?? true) : c.value;
          onChange(
            op === 'between'
              ? {
                  op,
                  ...(value !== undefined ? { value } : {}),
                  ...(c.to !== undefined ? { to: c.to } : {}),
                }
              : { op, ...(value !== undefined ? { value } : {}) },
            `${base}-op`,
          );
        }}
      />
      {c.op === 'any' ? null : input.type === 'boolean' ? (
        <Select
          id={`${base}-bool`}
          label="Value"
          size="s"
          value={String(c.value === true)}
          options={[
            { value: 'true', label: 'Yes (true)' },
            { value: 'false', label: 'No (false)' },
          ]}
          onChange={(e) => onChange({ op: 'eq', value: e.target.value === 'true' }, `${base}-v`)}
        />
      ) : c.op === 'in' ? (
        <TextInput
          id={`${base}-in`}
          label="Values"
          hint="Separate with commas"
          size="s"
          value={(c.values ?? []).join(', ')}
          onChange={(e) =>
            onChange(
              {
                op: 'in',
                values: e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
              `${base}-in`,
            )
          }
        />
      ) : input.type === 'number' ? (
        <div className="sf-designer-row">
          <TextInput
            id={`${base}-v`}
            label={c.op === 'between' ? 'From (inclusive)' : 'Number'}
            size="s"
            type="number"
            inputMode="decimal"
            value={typeof c.value === 'number' ? String(c.value) : ''}
            onChange={(e) => {
              const next: Condition = { ...c };
              const n = num(e.target.value);
              if (n === undefined) delete next.value;
              else next.value = n;
              onChange(next, `${base}-v`);
            }}
          />
          {c.op === 'between' ? (
            <TextInput
              id={`${base}-to`}
              label="To (inclusive)"
              size="s"
              type="number"
              inputMode="decimal"
              value={typeof c.to === 'number' ? String(c.to) : ''}
              onChange={(e) => {
                const next: Condition = { ...c };
                const n = num(e.target.value);
                if (n === undefined) delete next.to;
                else next.to = n;
                onChange(next, `${base}-to`);
              }}
            />
          ) : null}
        </div>
      ) : (
        <TextInput
          id={`${base}-v`}
          label="Text"
          size="s"
          value={c.value === undefined ? '' : String(c.value)}
          onChange={(e) => onChange({ op: c.op, value: e.target.value }, `${base}-v`)}
        />
      )}
    </fieldset>
  );
}

function RowEditor({
  design,
  row,
  index,
  issues,
  readOnly,
  apply,
  select,
}: {
  design: RuleDesign;
  row: RuleRow;
  index: number;
  issues: readonly RuleIssue[];
  readOnly: boolean;
  apply: Apply;
  select: (s: RuleSelection) => void;
}) {
  const found = issues.filter((i) => i.target.kind === 'row' && i.target.id === row.id);
  return (
    <>
      <div className="sf-designer-inspector-head">
        <h2 className="ux4g-heading-s-strong">Row {index + 1}</h2>
        <span className="ux4g-tag-tonal-info">
          {index === 0 ? 'Checked first' : `Checked after row ${index}`}
        </span>
      </div>
      {found.map((issue, i) => (
        <Alert
          key={`${issue.code}-${i}`}
          variant={issue.severity === 'error' ? 'error' : 'warning'}
          title={issue.severity === 'error' ? 'Fix' : 'Advice'}
        >
          {issue.message}
        </Alert>
      ))}
      <TextInput
        id="rules-row-description"
        label="Description"
        hint="Plain language, shown to officers next to the outcome"
        value={row.description}
        disabled={readOnly}
        maxLength={200}
        onChange={(e) =>
          apply(updateRow(design, row.id, { description: e.target.value }), `${row.id}-desc`)
        }
      />
      {design.inputs.map((input) => (
        <ConditionEditor
          key={input.id}
          row={row}
          input={input}
          readOnly={readOnly}
          onChange={(c, key) => apply(setCondition(design, row.id, input.id, c), key)}
        />
      ))}
      {design.outputs.map((output) => {
        const v = row.then[output.id];
        const base = `rules-${row.id}-${output.id}`;
        if (output.kind === 'outcome') {
          return (
            <Select
              key={output.id}
              id={base}
              label={`Then ${output.label || output.field}`}
              hint="Advisory outcome code; declared under Rule pack"
              value={typeof v === 'string' ? v : ''}
              disabled={readOnly}
              placeholder="No outcome"
              options={design.outcomes.map((code) => ({ value: code, label: code }))}
              onChange={(e) => apply(setResult(design, row.id, output.id, e.target.value))}
            />
          );
        }
        if (output.kind === 'reasons') {
          const list = Array.isArray(v) ? v : v ? [v] : [];
          return (
            <fieldset key={output.id} className="sf-designer-fieldset" disabled={readOnly}>
              <legend className="ux4g-label-m-strong">Then {output.label || output.field}</legend>
              {design.reasonCodes.length === 0 ? (
                <p className="ux4g-body-s-default sf-designer-muted">
                  Declare reason codes under Rule pack first.
                </p>
              ) : null}
              {design.reasonCodes.map((code) => (
                <Checkbox
                  key={code}
                  id={`${base}-${code}`}
                  label={code}
                  checked={list.includes(code)}
                  onChange={(e) =>
                    apply(
                      setResult(
                        design,
                        row.id,
                        output.id,
                        e.target.checked
                          ? design.reasonCodes.filter((c) => c === code || list.includes(c))
                          : list.filter((c) => c !== code),
                      ),
                    )
                  }
                />
              ))}
            </fieldset>
          );
        }
        return (
          <TextInput
            key={output.id}
            id={base}
            label={`Then ${output.label || output.field}`}
            hint="ZEN expression, e.g. months * 2. Clock and random functions are refused."
            value={Array.isArray(v) ? v.join(', ') : (v ?? '')}
            disabled={readOnly}
            maxLength={500}
            onChange={(e) => apply(setResult(design, row.id, output.id, e.target.value), base)}
          />
        );
      })}
      <div className="sf-designer-row">
        <Button
          variant="outline-neutral"
          size="s"
          disabled={readOnly || index === 0}
          onClick={() => apply(moveRow(design, row.id, -1))}
        >
          <Icon name="arrow-up" size={16} /> Move up
        </Button>
        <Button
          variant="outline-neutral"
          size="s"
          disabled={readOnly || index === design.rows.length - 1}
          onClick={() => apply(moveRow(design, row.id, 1))}
        >
          <Icon name="arrow-down" size={16} /> Move down
        </Button>
        <Button
          variant="outline-danger"
          size="s"
          disabled={readOnly}
          onClick={() => {
            apply(removeRow(design, row.id));
            select({ kind: 'pack' });
          }}
        >
          <Icon name="trash" size={16} /> Delete row
        </Button>
      </div>
    </>
  );
}

function ColumnEditor({
  design,
  id,
  issues,
  readOnly,
  apply,
  select,
}: {
  design: RuleDesign;
  id: string;
  issues: readonly RuleIssue[];
  readOnly: boolean;
  apply: Apply;
  select: (s: RuleSelection) => void;
}) {
  const input = design.inputs.find((i) => i.id === id);
  const output = design.outputs.find((o) => o.id === id);
  const col = input ?? output;
  if (!col) return null;
  const found = issues.filter((i) => i.target.kind === 'column' && i.target.id === id);
  const patch = (p: Record<string, string>, key?: string) =>
    apply(input ? updateInput(design, id, p) : updateOutput(design, id, p), key);
  return (
    <>
      <div className="sf-designer-inspector-head">
        <h2 className="ux4g-heading-s-strong">{input ? 'Input column' : 'Result column'}</h2>
        <span className="ux4g-tag-tonal-info">{input ? 'When' : 'Then'}</span>
      </div>
      {found.map((issue, i) => (
        <Alert key={`${issue.code}-${i}`} variant="error" title="Fix">
          {issue.message}
        </Alert>
      ))}
      <TextInput
        id="rules-col-label"
        label="Column label"
        value={col.label}
        disabled={readOnly}
        maxLength={80}
        onChange={(e) => patch({ label: e.target.value }, `${id}-label`)}
      />
      <TextInput
        id="rules-col-field"
        label="Field"
        hint={
          input
            ? 'Path in the evaluation input, e.g. residence_duration_months or applicant.age'
            : 'Field in the rule output'
        }
        value={col.field}
        disabled={readOnly}
        maxLength={160}
        onChange={(e) => patch({ field: e.target.value.trim() }, `${id}-field`)}
      />
      {input ? (
        <Select
          id="rules-col-type"
          label="Value type"
          hint="Changing the type clears this column's conditions and test values."
          value={input.type}
          disabled={readOnly}
          options={INPUT_TYPES}
          onChange={(e) => patch({ type: e.target.value })}
        />
      ) : output ? (
        <Select
          id="rules-col-kind"
          label="Result kind"
          hint="CMP-008 reads one outcome column and one reason-codes column."
          value={output.kind}
          disabled={readOnly}
          options={OUTPUT_KINDS}
          onChange={(e) => patch({ kind: e.target.value })}
        />
      ) : null}
      <Button
        variant="outline-danger"
        size="s"
        disabled={readOnly}
        onClick={() => {
          apply(removeColumn(design, id));
          select({ kind: 'pack' });
        }}
      >
        <Icon name="trash" size={16} /> Remove column
      </Button>
    </>
  );
}

/** Edits the selected row or column; with nothing selected, the rule pack settings and checks. */
export function RuleInspector({
  design,
  issues,
  selection,
  readOnly,
  apply,
  select,
}: {
  design: RuleDesign;
  issues: readonly RuleIssue[];
  selection: RuleSelection;
  readOnly: boolean;
  apply: Apply;
  select: (s: RuleSelection) => void;
}) {
  const rowIndex =
    selection.kind === 'row' ? design.rows.findIndex((r) => r.id === selection.id) : -1;
  const row = rowIndex >= 0 ? design.rows[rowIndex] : undefined;
  const column =
    selection.kind === 'column' &&
    [...design.inputs, ...design.outputs].some((c) => c.id === selection.id);

  return (
    <aside
      className="sf-designer-pane sf-designer-inspector"
      aria-label="Inspector"
      tabIndex={readOnly ? 0 : undefined}
    >
      {row ? (
        <>
          <Button variant="text-primary" size="xs" onClick={() => select({ kind: 'pack' })}>
            <Icon name="arrow-left" size={16} /> Rule pack settings
          </Button>
          <RowEditor
            design={design}
            row={row}
            index={rowIndex}
            issues={issues}
            readOnly={readOnly}
            apply={apply}
            select={select}
          />
        </>
      ) : column && selection.kind === 'column' ? (
        <>
          <Button variant="text-primary" size="xs" onClick={() => select({ kind: 'pack' })}>
            <Icon name="arrow-left" size={16} /> Rule pack settings
          </Button>
          <ColumnEditor
            design={design}
            id={selection.id}
            issues={issues}
            readOnly={readOnly}
            apply={apply}
            select={select}
          />
        </>
      ) : (
        <>
          <div className="sf-designer-inspector-head">
            <h2 className="ux4g-heading-s-strong">Rule pack</h2>
          </div>
          <p className="ux4g-body-s-default">
            <span className="ux4g-tag-tonal-info">Advisory only</span> Rules suggest an outcome and
            reasons for an officer or the workflow. They never approve, reject or issue
            (Constitution §20).
          </p>
          <TextInput
            id="rules-title"
            label="Title"
            value={design.title}
            disabled={readOnly}
            maxLength={120}
            onChange={(e) => apply({ ...design, title: e.target.value }, 'pack-title')}
          />
          <TextInput
            id="rules-key"
            label="Rule pack key"
            hint="Lowercase, e.g. lab.trade-licence.fee-band"
            value={design.packKey}
            disabled={readOnly}
            maxLength={128}
            onChange={(e) =>
              apply({ ...design, packKey: e.target.value.trim().toLowerCase() }, 'pack-key')
            }
          />
          <TextInput
            id="rules-version"
            label="Version"
            value={design.version}
            disabled={readOnly}
            maxLength={32}
            onChange={(e) => apply({ ...design, version: e.target.value.trim() }, 'pack-version')}
          />
          <CodeList
            id="rules-add-outcome"
            label="Outcome codes"
            hint="e.g. MEETS_CRITERIA, REFER_TO_OFFICER"
            codes={design.outcomes}
            design={design}
            readOnly={readOnly}
            onChange={(outcomes) => apply({ ...design, outcomes })}
          />
          <CodeList
            id="rules-add-reason"
            label="Reason codes"
            hint="Why a row matched, e.g. RESIDENCE_PERIOD_MET"
            codes={design.reasonCodes}
            design={design}
            readOnly={readOnly}
            onChange={(reasonCodes) => apply({ ...design, reasonCodes })}
          />
          <RuleChecks issues={issues} select={select} />
        </>
      )}
    </aside>
  );
}
