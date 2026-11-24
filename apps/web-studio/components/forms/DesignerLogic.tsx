'use client';

import { Alert, Button, Icon, type FormData, type FormPackageView } from '@serviceform/ui-ux4g';
import {
  logicRules,
  logicScenarios,
  type DesignerForm,
  type DesignIssue,
} from '@serviceform/studio-designers/forms';
import { useMemo } from 'react';
import { logicMatrix, type LogicCell } from '../../lib/form-logic';
import type { Selection } from './DesignerCanvas';

const LOGIC_CODES = new Set([
  'RULE_TARGET_MISSING',
  'RULE_SELF_REFERENCE',
  'RULE_VALUE_MISSING',
  'RULE_VALUE_TYPE',
  'RULE_TARGET_LATER',
  'RULE_UNREACHABLE',
  'RULE_CYCLE',
  'RULE_HIDDEN_SOURCE',
  'RULE_HIDDEN_SOURCE_BLOCKS',
  'CONDITIONAL_MULTIPLE',
  'CONDITIONAL_NESTED',
  'CONDITION_NESTED_TARGET',
  'REQUIRED_CONFLICT',
  'OBJECT_SECTION_HIDDEN',
  'OBJECT_FIELDS_HIDDEN',
]);

function Cell({ cell }: { cell: LogicCell }) {
  if (!cell.shown) return <span className="ux4g-tag-outline-neutral">Hidden</span>;
  return cell.required ? (
    <span className="ux4g-tag-tonal-primary">Shown · required</span>
  ) : (
    <span className="ux4g-tag-tonal-neutral">Shown · optional</span>
  );
}

/**
 * Every conditional rule of the form in plain language, its logic checks, and a matrix of the
 * answer combinations that drive the rules, evaluated by the citizen UX4G runtime mirror.
 */
export function DesignerLogic({
  form,
  formPackage,
  issues,
  onSelect,
  onTry,
}: {
  form: DesignerForm;
  formPackage: FormPackageView;
  issues: readonly DesignIssue[];
  onSelect: (s: Selection) => void;
  onTry: (data: FormData) => void;
}) {
  const rules = useMemo(() => logicRules(form), [form]);
  const set = useMemo(() => logicScenarios(form), [form]);
  const matrix = useMemo(() => logicMatrix(form, formPackage, set), [form, formPackage, set]);
  const logicIssues = issues.filter((i) => LOGIC_CODES.has(i.code));

  return (
    <div className="sf-designer-preview">
      <div className="sf-designer-preview-bar">
        <span className="ux4g-tag-tonal-info" data-testid="logic-rule-count">
          {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
        </span>
        <span className="ux4g-tag-tonal-neutral">
          {set.drivers.length} {set.drivers.length === 1 ? 'answer drives' : 'answers drive'} them
        </span>
        <span className="ux4g-tag-tonal-neutral">
          {set.scenarios.length} {set.complete ? 'combinations' : 'cases (partial)'}
        </span>
        <span className="ux4g-body-s-default sf-designer-muted">
          Evaluated with the citizen form runtime · CMP-009 enforces the same rules on submit
        </span>
      </div>

      {rules.length === 0 ? (
        <Alert variant="info" title="No conditional rules yet">
          Select a field or section and use Visibility or &ldquo;Required when…&rdquo; to make it
          depend on another answer.
        </Alert>
      ) : (
        <section className="sf-designer-checks" aria-labelledby="logic-rules-title">
          <h2 id="logic-rules-title" className="ux4g-heading-xs-strong">
            Rules
          </h2>
          <ol className="sf-designer-check-list" aria-label="Conditional rules">
            {rules.map((rule) => (
              <li key={rule.id}>
                <span
                  className={
                    rule.kind === 'requirement'
                      ? 'ux4g-tag-tonal-primary'
                      : rule.effect === 'SHOW'
                        ? 'ux4g-tag-tonal-success'
                        : 'ux4g-tag-tonal-warning'
                  }
                >
                  {rule.kind === 'requirement'
                    ? 'Required'
                    : rule.effect === 'SHOW'
                      ? 'Show'
                      : 'Hide'}
                </span>
                <span className="ux4g-body-s-default">
                  {rule.sentence}{' '}
                  <span className="sf-designer-muted">Step {rule.stepIndex + 1}.</span>
                </span>
                {rule.sourceMissing ? (
                  <span className="ux4g-tag-tonal-error">Answer removed</span>
                ) : null}
                <Button
                  variant="text-primary"
                  size="xs"
                  aria-label={`Edit the rule on ${rule.targetLabel}`}
                  onClick={() => onSelect(rule.target)}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {logicIssues.length > 0 ? (
        <section className="sf-designer-checks" aria-labelledby="logic-checks-title">
          <h2 id="logic-checks-title" className="ux4g-heading-xs-strong">
            Logic checks
          </h2>
          <ul className="sf-designer-check-list">
            {logicIssues.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>
                <span
                  className={
                    issue.severity === 'error' ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-warning'
                  }
                >
                  {issue.severity === 'error' ? 'Fix' : 'Advice'}
                </span>
                <span className="ux4g-body-s-default">{issue.message}</span>
                {issue.target.kind !== 'form' ? (
                  <Button
                    variant="text-primary"
                    size="xs"
                    onClick={() => onSelect(issue.target as Selection)}
                  >
                    Show
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {matrix.rows.length > 0 && matrix.columns.length > 0 ? (
        <section aria-labelledby="logic-matrix-title" className="sf-designer-stack">
          <h2 id="logic-matrix-title" className="ux4g-heading-xs-strong">
            What the applicant sees
          </h2>
          {set.complete ? null : (
            <Alert variant="info" title="Too many combinations to list">
              Each answer is shown on its own, with every other driving answer left unanswered.
            </Alert>
          )}
          <div className="sf-table-wrap">
            <table className="sf-table" data-testid="logic-matrix">
              <caption>
                One row per combination of the answers that rules read. &ldquo;Not answered&rdquo;
                is what an applicant who skips the question gets.
              </caption>
              <thead>
                <tr>
                  {set.drivers.map((d) => (
                    <th key={d.path} scope="col">
                      {d.label}
                    </th>
                  ))}
                  {matrix.columns.map((c) => (
                    <th key={c.fieldId} scope="col">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="ux4g-sr-only">Preview</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.scenario.id}>
                    {row.scenario.answers.map((a, i) =>
                      i === 0 ? (
                        <th key={a.path} scope="row" className="sf-nowrap">
                          {a.valueLabel}
                        </th>
                      ) : (
                        <td key={a.path} className="sf-nowrap">
                          {a.valueLabel}
                        </td>
                      ),
                    )}
                    {row.cells.map((cell, i) => (
                      <td key={matrix.columns[i]?.fieldId ?? i}>
                        <Cell cell={cell} />
                      </td>
                    ))}
                    <td>
                      <Button
                        variant="text-primary"
                        size="xs"
                        aria-label={`Try ${row.scenario.answers
                          .map((a) => `${a.label}: ${a.valueLabel}`)
                          .join(', ')} in the preview`}
                        onClick={() => onTry(row.scenario.data as FormData)}
                      >
                        <Icon name="eye" size={16} /> Try
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
