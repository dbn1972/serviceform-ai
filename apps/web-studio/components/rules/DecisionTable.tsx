'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import {
  addInput,
  addOutput,
  addRow,
  describeCondition,
  moveRow,
  removeRow,
  type RuleDesign,
  type RuleIssue,
  type RuleOutput,
} from '@serviceform/studio-designers/rules';
import type { RuleSelection } from './RuleInspector';
import type { TestRunState } from '../../lib/rule-runs';

function ResultCell({
  output,
  value,
}: {
  output: RuleOutput;
  value: string | string[] | undefined;
}) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return <span className="sf-rules-muted">—</span>;
  if (output.kind === 'value') return <code className="sf-hash">{list.join(', ')}</code>;
  return (
    <span className="sf-rules-codes">
      {list.map((code) => (
        <span
          key={code}
          className={
            output.kind === 'outcome' ? 'ux4g-tag-tonal-primary' : 'ux4g-tag-outline-neutral'
          }
        >
          {code}
        </span>
      ))}
    </span>
  );
}

/**
 * The decision table: rows are checked top to bottom and the first row whose conditions all hold
 * sets the results (GoRules hit policy "first"). Cells read in plain language; the inspector edits.
 */
export function DecisionTable({
  design,
  issues,
  selection,
  readOnly,
  run,
  apply,
  select,
}: {
  design: RuleDesign;
  issues: readonly RuleIssue[];
  selection: RuleSelection;
  readOnly: boolean;
  run: TestRunState | null;
  apply: (next: RuleDesign, coalesce?: string) => void;
  select: (s: RuleSelection) => void;
}) {
  const rowIssues = (id: string) =>
    issues.filter((i) => i.target.kind === 'row' && i.target.id === id);
  const columnHasError = (id: string) =>
    issues.some((i) => i.target.kind === 'column' && i.target.id === id && i.severity === 'error');
  const hits = (id: string) =>
    run?.body.results.filter((r) => r.matched_rules?.includes(id)).length ?? 0;

  const newRow = () => {
    const res = addRow(design);
    apply(res.design);
    select({ kind: 'row', id: res.id });
  };

  return (
    <section className="sf-designer-pane sf-rules-table-pane" aria-labelledby="rules-table-title">
      <div className="sf-rules-toolbar">
        <h2 id="rules-table-title" className="ux4g-heading-s-strong">
          Decision table
        </h2>
        <span className="ux4g-tag-tonal-info">First matching row wins</span>
        <div className="sf-rules-toolbar-actions">
          <Button variant="outline-neutral" size="s" disabled={readOnly} onClick={newRow}>
            <Icon name="plus" size={16} /> Add row
          </Button>
          <Button
            variant="outline-neutral"
            size="s"
            disabled={readOnly}
            onClick={() => {
              const n = design.inputs.length + 1;
              const res = addInput(design, {
                label: `Input ${n}`,
                field: `input_${n}`,
                type: 'number',
              });
              apply(res.design);
              select({ kind: 'column', id: res.id });
            }}
          >
            <Icon name="plus" size={16} /> Add input
          </Button>
          <Button
            variant="outline-neutral"
            size="s"
            disabled={readOnly}
            onClick={() => {
              const n = design.outputs.length + 1;
              const kind = design.outputs.some((o) => o.kind === 'outcome')
                ? design.outputs.some((o) => o.kind === 'reasons')
                  ? 'value'
                  : 'reasons'
                : 'outcome';
              const res = addOutput(design, { label: `Result ${n}`, field: `result_${n}`, kind });
              apply(res.design);
              select({ kind: 'column', id: res.id });
            }}
          >
            <Icon name="plus" size={16} /> Add result
          </Button>
        </div>
      </div>
      <div className="sf-table-wrap">
        <table className="sf-table sf-rules-table">
          <caption>
            Rows are checked from the top. An empty condition matches any value. Results are
            advisory codes for officers and the workflow.
          </caption>
          <thead>
            <tr>
              <th scope="col">Row</th>
              {design.inputs.map((input) => (
                <th
                  key={input.id}
                  scope="col"
                  className={`sf-rules-col-when${columnHasError(input.id) ? ' sf-rules-col-error' : ''}`}
                >
                  <button
                    type="button"
                    className="sf-rules-colhead"
                    aria-label={`Edit input column ${input.label || input.field}`}
                    aria-pressed={selection.kind === 'column' && selection.id === input.id}
                    onClick={() => select({ kind: 'column', id: input.id })}
                  >
                    <span className="sf-rules-colkind">When</span>
                    <span>{input.label || 'Unnamed input'}</span>
                    <code className="sf-hash">
                      {input.field} · {input.type}
                    </code>
                  </button>
                </th>
              ))}
              {design.outputs.map((output) => (
                <th
                  key={output.id}
                  scope="col"
                  className={`sf-rules-col-then${columnHasError(output.id) ? ' sf-rules-col-error' : ''}`}
                >
                  <button
                    type="button"
                    className="sf-rules-colhead"
                    aria-label={`Edit result column ${output.label || output.field}`}
                    aria-pressed={selection.kind === 'column' && selection.id === output.id}
                    onClick={() => select({ kind: 'column', id: output.id })}
                  >
                    <span className="sf-rules-colkind">Then</span>
                    <span>{output.label || 'Unnamed result'}</span>
                    <code className="sf-hash">
                      {output.field} · {output.kind}
                    </code>
                  </button>
                </th>
              ))}
              <th scope="col">Description</th>
              <th scope="col">
                <span className="ux4g-sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {design.rows.length === 0 ? (
              <tr>
                <td colSpan={design.inputs.length + design.outputs.length + 3}>
                  <span className="sf-rules-muted">No rows yet. Add a row to start.</span>
                </td>
              </tr>
            ) : null}
            {design.rows.map((row, index) => {
              const found = rowIssues(row.id);
              const error = found.some((i) => i.severity === 'error');
              const selected = selection.kind === 'row' && selection.id === row.id;
              const hit = hits(row.id);
              return (
                <tr
                  key={row.id}
                  aria-current={selected ? 'true' : undefined}
                  className={
                    error
                      ? 'sf-rules-row-error'
                      : found.length > 0
                        ? 'sf-rules-row-warn'
                        : undefined
                  }
                  onClick={() => select({ kind: 'row', id: row.id })}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="sf-rules-rowhead"
                      aria-label={`Edit row ${index + 1}${row.description ? `: ${row.description}` : ''}`}
                      aria-pressed={selected}
                      onClick={(e) => {
                        e.stopPropagation();
                        select({ kind: 'row', id: row.id });
                      }}
                    >
                      {index + 1}
                    </button>
                    {found.length > 0 ? (
                      <Icon
                        name="alert"
                        size={16}
                        label={`${found.length} check${found.length === 1 ? '' : 's'} on this row`}
                      />
                    ) : null}
                  </th>
                  {design.inputs.map((input) => {
                    const c = row.when[input.id];
                    return (
                      <td key={input.id}>
                        <span className={!c || c.op === 'any' ? 'sf-rules-muted' : undefined}>
                          {describeCondition(c)}
                        </span>
                      </td>
                    );
                  })}
                  {design.outputs.map((output) => (
                    <td key={output.id}>
                      <ResultCell output={output} value={row.then[output.id]} />
                    </td>
                  ))}
                  <td>
                    {row.description || <span className="sf-rules-muted">No description</span>}
                    {run ? (
                      <span className="sf-rules-hit">
                        {hit > 0
                          ? `Matched by ${hit} test${hit === 1 ? '' : 's'}`
                          : 'No test reaches this row'}
                      </span>
                    ) : null}
                  </td>
                  <td className="sf-nowrap">
                    <Button
                      variant="text-neutral"
                      size="xs"
                      aria-label={`Move row ${index + 1} up`}
                      disabled={readOnly || index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        apply(moveRow(design, row.id, -1));
                      }}
                    >
                      <Icon name="arrow-up" size={16} />
                    </Button>
                    <Button
                      variant="text-neutral"
                      size="xs"
                      aria-label={`Move row ${index + 1} down`}
                      disabled={readOnly || index === design.rows.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        apply(moveRow(design, row.id, 1));
                      }}
                    >
                      <Icon name="arrow-down" size={16} />
                    </Button>
                    <Button
                      variant="text-neutral"
                      size="xs"
                      aria-label={`Delete row ${index + 1}`}
                      disabled={readOnly}
                      onClick={(e) => {
                        e.stopPropagation();
                        apply(removeRow(design, row.id));
                        if (selected) select({ kind: 'pack' });
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
