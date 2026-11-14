'use client';

import { Alert, Button, Checkbox, Icon, Select, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  addTest,
  removeTest,
  suggestBoundaryTests,
  updateTest,
  type RuleDesign,
  type RuleInput,
  type RuleIssue,
  type RuleTestCase,
  type RuleTestPatch,
  type Scalar,
} from '@serviceform/studio-designers/rules';
import { useState } from 'react';
import type { RuleTestResult } from '../../lib/studio-api';
import type { RuleSelection } from './RuleInspector';
import { tally, verdictOf, type TestRunState, type Verdict } from '../../lib/rule-runs';

const VERDICT: Record<Verdict, { label: string; tag: string }> = {
  passed: { label: 'Passed', tag: 'ux4g-tag-tonal-success' },
  failed: { label: 'Failed', tag: 'ux4g-tag-tonal-error' },
  unchecked: { label: 'No expected result', tag: 'ux4g-tag-tonal-warning' },
};

type Apply = (next: RuleDesign, coalesce?: string) => void;

function shown(value: Scalar | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
}

function rowsOf(design: RuleDesign, result: RuleTestResult | undefined): string {
  const ids = result?.matched_rules ?? [];
  if (ids.length === 0) return 'no row';
  return ids
    .map((id) => {
      const i = design.rows.findIndex((r) => r.id === id);
      return i >= 0 ? `row ${i + 1}` : id;
    })
    .join(', ');
}

function Outcome({ result }: { result: RuleTestResult }) {
  if (result.error) return <span className="ux4g-tag-tonal-error">{result.error}</span>;
  return (
    <span className="sf-rules-codes">
      {result.outcome ? (
        <span className="ux4g-tag-tonal-primary">{result.outcome}</span>
      ) : (
        <span className="sf-rules-muted">no outcome</span>
      )}
      {(result.reason_codes ?? []).map((code) => (
        <span key={code} className="ux4g-tag-outline-neutral">
          {code}
        </span>
      ))}
    </span>
  );
}

function InputValue({
  test,
  input,
  readOnly,
  onChange,
}: {
  test: RuleTestCase;
  input: RuleInput;
  readOnly: boolean;
  onChange: (value: Scalar | null) => void;
}) {
  const id = `rules-test-${test.id}-${input.id}`;
  const value = test.inputs[input.field];
  const label = `${input.label || input.field} (${input.field})`;
  if (input.type === 'boolean') {
    return (
      <Select
        id={id}
        label={label}
        size="s"
        value={value === true ? 'true' : value === false ? 'false' : ''}
        disabled={readOnly}
        placeholder="Not given"
        options={[
          { value: 'true', label: 'Yes (true)' },
          { value: 'false', label: 'No (false)' },
        ]}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
      />
    );
  }
  return (
    <TextInput
      id={id}
      label={label}
      size="s"
      disabled={readOnly}
      {...(input.type === 'number' ? { type: 'number', inputMode: 'decimal' as const } : {})}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw.trim() === '') return onChange(null);
        if (input.type !== 'number') return onChange(raw);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function TestEditor({
  design,
  test,
  result,
  fresh,
  readOnly,
  apply,
  select,
}: {
  design: RuleDesign;
  test: RuleTestCase;
  result: RuleTestResult | undefined;
  fresh: boolean;
  readOnly: boolean;
  apply: Apply;
  select: (s: RuleSelection) => void;
}) {
  const patch = (p: RuleTestPatch, key?: string) => apply(updateTest(design, test.id, p), key);
  const reasons = test.expectReasons ?? [];
  return (
    <>
      <div className="sf-designer-inspector-head">
        <h2 className="ux4g-heading-s-strong">Test case</h2>
        {result && fresh ? (
          <span className={VERDICT[verdictOf(test, result) ?? 'unchecked'].tag}>
            {VERDICT[verdictOf(test, result) ?? 'unchecked'].label}
          </span>
        ) : null}
      </div>
      <TextInput
        id="rules-test-name"
        label="Name"
        value={test.name}
        disabled={readOnly}
        maxLength={120}
        onChange={(e) => patch({ name: e.target.value }, `${test.id}-name`)}
      />
      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Inputs</legend>
        <p className="ux4g-body-s-default sf-designer-muted">
          Synthetic values only. Never paste real applicant data.
        </p>
        {design.inputs.map((input) => (
          <InputValue
            key={input.id}
            test={test}
            input={input}
            readOnly={readOnly}
            onChange={(value) => {
              const rest = Object.entries(test.inputs).filter(([k]) => k !== input.field);
              const inputs = Object.fromEntries(
                value === null ? rest : [...rest, [input.field, value]],
              );
              patch({ inputs }, `${test.id}-${input.id}`);
            }}
          />
        ))}
      </fieldset>
      <fieldset className="sf-designer-fieldset" disabled={readOnly}>
        <legend className="ux4g-label-m-strong">Expected</legend>
        <Select
          id="rules-test-outcome"
          label="Outcome"
          size="s"
          value={test.expectOutcome ?? ''}
          placeholder="Not checked"
          options={design.outcomes.map((c) => ({ value: c, label: c }))}
          onChange={(e) => patch({ expectOutcome: e.target.value || undefined })}
        />
        {design.reasonCodes.map((code) => (
          <Checkbox
            key={code}
            id={`rules-test-reason-${code}`}
            label={code}
            checked={reasons.includes(code)}
            onChange={(e) =>
              patch({
                expectReasons: e.target.checked
                  ? design.reasonCodes.filter((c) => c === code || reasons.includes(c))
                  : reasons.filter((c) => c !== code),
              })
            }
          />
        ))}
      </fieldset>
      {result && fresh ? (
        <section className="sf-designer-stack" aria-labelledby="rules-test-result-title">
          <h3 id="rules-test-result-title" className="ux4g-label-l-strong">
            CMP-008 result
          </h3>
          <Outcome result={result} />
          <p className="ux4g-body-s-default">Matched {rowsOf(design, result)}.</p>
          {!result.error ? (
            <Button
              variant="outline-primary"
              size="s"
              disabled={readOnly}
              onClick={() =>
                patch({
                  expectOutcome: result.outcome ?? undefined,
                  expectReasons: result.reason_codes ?? [],
                })
              }
            >
              Use this result as expected
            </Button>
          ) : null}
          <p className="ux4g-body-s-default sf-designer-muted">
            You decide what is correct; the engine result is only a starting point.
          </p>
        </section>
      ) : null}
      <Button
        variant="outline-danger"
        size="s"
        disabled={readOnly}
        onClick={() => {
          apply(removeTest(design, test.id));
          select({ kind: 'pack' });
        }}
      >
        <Icon name="trash" size={16} /> Delete test
      </Button>
    </>
  );
}

/**
 * Test cases run on CMP-008's ZEN engine through the Studio test bench. Nothing is stored and the
 * results are advisory. Boundary suggestions are deterministic (not AI) and leave the expected
 * result to the author.
 */
export function RuleTests({
  design,
  issues,
  selection,
  readOnly,
  run,
  fresh,
  running,
  runError,
  contentHash,
  onRun,
  apply,
  select,
}: {
  design: RuleDesign;
  issues: readonly RuleIssue[];
  selection: RuleSelection;
  readOnly: boolean;
  run: TestRunState | null;
  fresh: boolean;
  running: boolean;
  runError: string;
  contentHash: string | null;
  onRun: () => void;
  apply: Apply;
  select: (s: RuleSelection) => void;
}) {
  const [notice, setNotice] = useState('');
  const results = new Map(run?.body.results.map((r) => [r.id, r]) ?? []);
  const counts = run && fresh ? tally(design, run.body) : null;
  const selected =
    selection.kind === 'test' ? design.tests.find((t) => t.id === selection.id) : undefined;
  const testIssues = (id: string) =>
    issues.filter((i) => i.target.kind === 'test' && i.target.id === id);

  const suggest = () => {
    const known = new Set(design.tests.map((t) => JSON.stringify(t.inputs)));
    const added = suggestBoundaryTests(design).filter((t) => !known.has(JSON.stringify(t.inputs)));
    if (added.length === 0) return setNotice('No new boundary values to suggest.');
    apply({ ...design, tests: [...design.tests, ...added] });
    setNotice(
      `Added ${added.length} boundary test${added.length === 1 ? '' : 's'}. Run them, then set the expected result for each.`,
    );
  };

  return (
    <div className="sf-rules-grid">
      <section className="sf-designer-pane sf-rules-table-pane" aria-labelledby="rules-tests-title">
        <div className="sf-rules-toolbar">
          <h2 id="rules-tests-title" className="ux4g-heading-s-strong">
            Test cases
          </h2>
          <div className="sf-rules-toolbar-actions">
            <Button
              variant="outline-neutral"
              size="s"
              disabled={readOnly}
              onClick={() => {
                const res = addTest(design);
                apply(res.design);
                select({ kind: 'test', id: res.id });
              }}
            >
              <Icon name="plus" size={16} /> Add test
            </Button>
            <Button variant="outline-neutral" size="s" disabled={readOnly} onClick={suggest}>
              <Icon name="sliders" size={16} /> Suggest boundary tests
            </Button>
            <Button
              size="s"
              disabled={running || design.tests.length === 0 || contentHash === null}
              onClick={onRun}
            >
              <Icon name="check-circle" size={16} />{' '}
              {running ? 'Running…' : `Run ${design.tests.length} on CMP-008`}
            </Button>
          </div>
        </div>
        <p className="ux4g-body-s-default sf-designer-muted">
          CMP-008 runs each case on the same ZEN engine that evaluates published packs. Nothing is
          stored. Results are advisory, never a decision on an application.
        </p>
        {notice ? (
          <Alert variant="info" title="Suggestions">
            {notice}
          </Alert>
        ) : null}
        {runError ? (
          <Alert variant="error" title="CMP-008 test bench">
            {runError}
          </Alert>
        ) : null}
        {run && counts ? (
          <Alert
            variant={counts.failed > 0 ? 'error' : counts.unchecked > 0 ? 'warning' : 'success'}
            title={
              counts.failed > 0
                ? `${counts.failed} of ${counts.total} tests failed`
                : counts.unchecked > 0
                  ? `No expected result for ${counts.unchecked} of ${counts.total} tests`
                  : `All ${counts.total} tests passed`
            }
          >
            <span data-testid="rules-test-summary">
              {run.body.engine.name} {run.body.engine.version} · content_hash{' '}
              <code className="sf-hash">{shortHash(run.body.content_hash)}</code>{' '}
              {run.body.content_hash === contentHash
                ? 'matches the designer'
                : 'DIFFERS from the designer'}{' '}
              · advisory only
            </span>
          </Alert>
        ) : null}
        {run && !fresh ? (
          <Alert variant="warning" title="Results are out of date">
            The table or a test input changed after the last run. Run the tests again.
          </Alert>
        ) : null}
        <div className="sf-table-wrap">
          <table className="sf-table sf-rules-table">
            <caption>
              {design.tests.length} test case{design.tests.length === 1 ? '' : 's'} with synthetic
              inputs
            </caption>
            <thead>
              <tr>
                <th scope="col">Test</th>
                {design.inputs.map((input) => (
                  <th key={input.id} scope="col">
                    {input.label || input.field}
                  </th>
                ))}
                <th scope="col">Expected</th>
                <th scope="col">CMP-008 result</th>
              </tr>
            </thead>
            <tbody>
              {design.tests.length === 0 ? (
                <tr>
                  <td colSpan={design.inputs.length + 3}>
                    <span className="sf-rules-muted">
                      No tests yet. Add one or suggest boundary tests from the table.
                    </span>
                  </td>
                </tr>
              ) : null}
              {design.tests.map((test) => {
                const result = results.get(test.id);
                const isSelected = selected?.id === test.id;
                const found = testIssues(test.id);
                return (
                  <tr
                    key={test.id}
                    aria-current={isSelected ? 'true' : undefined}
                    className={found.length > 0 ? 'sf-rules-row-warn' : undefined}
                    onClick={() => select({ kind: 'test', id: test.id })}
                  >
                    <th scope="row">
                      <button
                        type="button"
                        className="sf-rules-rowhead sf-rules-rowhead-text"
                        aria-pressed={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          select({ kind: 'test', id: test.id });
                        }}
                      >
                        {test.name || 'Unnamed test'}
                      </button>
                      {found.length > 0 ? (
                        <span className="sf-rules-hit">{found[0]?.message}</span>
                      ) : null}
                    </th>
                    {design.inputs.map((input) => (
                      <td key={input.id}>{shown(test.inputs[input.field])}</td>
                    ))}
                    <td>
                      <span className="sf-rules-codes">
                        {test.expectOutcome ? (
                          <span className="ux4g-tag-tonal-primary">{test.expectOutcome}</span>
                        ) : null}
                        {(test.expectReasons ?? []).map((code) => (
                          <span key={code} className="ux4g-tag-outline-neutral">
                            {code}
                          </span>
                        ))}
                        {!test.expectOutcome && !test.expectReasons?.length ? (
                          <span className="sf-rules-muted">not set</span>
                        ) : null}
                      </span>
                    </td>
                    <td data-testid={`rules-result-${test.id}`}>
                      {result ? (
                        <span className="sf-rules-result">
                          <span
                            className={
                              fresh
                                ? VERDICT[verdictOf(test, result) ?? 'unchecked'].tag
                                : 'ux4g-tag-outline-neutral'
                            }
                          >
                            {fresh
                              ? VERDICT[verdictOf(test, result) ?? 'unchecked'].label
                              : 'Out of date'}
                          </span>
                          <Outcome result={result} />
                          <span className="sf-rules-hit">{rowsOf(design, result)}</span>
                        </span>
                      ) : (
                        <span className="sf-rules-muted">not run</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <aside
        className="sf-designer-pane sf-designer-inspector"
        aria-label="Test editor"
        tabIndex={readOnly ? 0 : undefined}
      >
        {selected ? (
          <TestEditor
            design={design}
            test={selected}
            result={results.get(selected.id)}
            fresh={fresh}
            readOnly={readOnly}
            apply={apply}
            select={select}
          />
        ) : (
          <>
            <h2 className="ux4g-heading-s-strong">Test editor</h2>
            <p className="ux4g-body-s-default">
              Select a test to edit its inputs and expected outcome. Every outcome code should have
              at least one test, including the values either side of each threshold.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
