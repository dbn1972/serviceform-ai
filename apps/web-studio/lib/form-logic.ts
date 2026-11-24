import {
  isRequired,
  visibleScopes,
  type FormData,
  type FormPackageView,
} from '@serviceform/ui-ux4g';
import {
  allFields,
  logicRules,
  scopeOf,
  type DesignerForm,
  type LogicScenario,
  type LogicScenarioSet,
} from '@serviceform/studio-designers/forms';

export interface LogicColumn {
  fieldId: string;
  label: string;
  path: string;
  stepIndex: number;
}

export interface LogicCell {
  shown: boolean;
  required: boolean;
}

export interface LogicRow {
  scenario: LogicScenario;
  cells: LogicCell[];
}

/** Fields whose visibility or requirement a rule can change, in applicant order. */
export function affectedFields(form: DesignerForm): LogicColumn[] {
  const rules = logicRules(form);
  const fieldTargets = new Set(
    rules.filter((r) => r.target.kind === 'field').map((r) => r.target.id),
  );
  const sectionTargets = new Set(
    rules.filter((r) => r.target.kind === 'section').map((r) => r.target.id),
  );
  return allFields(form)
    .filter((r) => fieldTargets.has(r.field.id) || sectionTargets.has(r.section.id))
    .map((r) => ({
      fieldId: r.field.id,
      label: r.field.label.trim() || r.path,
      path: r.path,
      stepIndex: r.stepIndex,
    }));
}

/**
 * Evaluates each scenario with the UX4G runtime mirror the citizen wizard and the preview use;
 * `tests/cdc/studio-forms-preview-parity.cdc.test.ts` proves it matches the CMP-009 runtime.
 */
export function logicMatrix(
  form: DesignerForm,
  pkg: FormPackageView,
  set: LogicScenarioSet,
): { columns: LogicColumn[]; rows: LogicRow[] } {
  const columns = affectedFields(form);
  const rows = set.scenarios.map((scenario) => {
    const data = scenario.data as FormData;
    const visible = visibleScopes(pkg.ui_schema, data);
    return {
      scenario,
      cells: columns.map((c) => {
        const shown = visible.has(scopeOf(c.path));
        return { shown, required: shown && isRequired(pkg.json_schema, `/${c.path}`, data) };
      }),
    };
  });
  return { columns, rows };
}
