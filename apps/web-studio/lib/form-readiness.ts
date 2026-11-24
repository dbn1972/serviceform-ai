import {
  stepErrors,
  visibleScopes,
  type FormData,
  type FormPackageView,
} from '@serviceform/ui-ux4g';
import {
  allFields,
  logicScenarios,
  sampleAnswers,
  type DesignerForm,
  type DesignIssue,
} from '@serviceform/studio-designers/forms';

export type ReadinessState = 'ready' | 'advice' | 'fix';

export interface ReadinessItem {
  id: string;
  title: string;
  state: ReadinessState;
  detail: string;
}

/**
 * What an author should confirm before freezing a version. Advisory except where a check would
 * also refuse it; CMP-033 and CMP-009 check again on save, freeze and every submission.
 */
export function formReadiness(
  form: DesignerForm,
  pkg: FormPackageView,
  issues: readonly DesignIssue[],
): ReadinessItem[] {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const refs = allFields(form);
  const data = sampleAnswers(form) as FormData;
  const refused = Object.values(
    stepErrors(pkg.json_schema, pkg.ui_schema, data, visibleScopes(pkg.ui_schema, data)),
  );
  const logic = logicScenarios(form);
  const bound = refs.filter((r) => r.field.semanticElementId !== undefined).length;
  const unusedMessages = issues.filter((i) => i.code === 'ERROR_MESSAGE_UNUSED').length;
  return [
    {
      id: 'checks',
      title: 'No blocking checks',
      state: errors > 0 ? 'fix' : 'ready',
      detail:
        errors > 0
          ? `${errors} ${errors === 1 ? 'problem' : 'problems'} to fix; see Checks.`
          : 'CMP-033 and CMP-009 check again when you save and freeze.',
    },
    {
      id: 'sample',
      title: 'Sample answers pass the citizen checks',
      state: refused.length > 0 ? 'fix' : 'ready',
      detail:
        refused.length > 0
          ? `${refused.length} synthetic ${refused.length === 1 ? 'answer is' : 'answers are'} refused, for example “${refused[0]}”.`
          : 'A synthetic answer for every field passes; try them with “Fill with sample answers” in Preview.',
    },
    {
      id: 'logic',
      title: 'Every answer combination is listed in Logic',
      state: logic.complete ? 'ready' : 'advice',
      detail:
        logic.drivers.length === 0
          ? 'The form has no conditional rules.'
          : logic.complete
            ? `${logic.scenarios.length} combinations of ${logic.drivers.length} driving ${logic.drivers.length === 1 ? 'answer' : 'answers'}.`
            : `Too many combinations; ${logic.scenarios.length} cases vary one answer at a time.`,
    },
    {
      id: 'review',
      title: 'Applicants review their answers before submitting',
      state: form.steps.some((s) => s.review) ? 'ready' : 'advice',
      detail: form.steps.some((s) => s.review)
        ? 'The form ends with a review step.'
        : 'Add a review step so applicants check every answer once.',
    },
    {
      id: 'declaration',
      title: 'Applicants confirm a declaration',
      state: refs.some((r) => r.field.kind === 'declaration') ? 'ready' : 'advice',
      detail: refs.some((r) => r.field.kind === 'declaration')
        ? 'A declaration must be ticked before submit.'
        : 'Add “Applicant declaration” from the palette if the service needs one.',
    },
    {
      id: 'semantic',
      title: 'Answers reuse canonical government elements',
      state: bound > 0 ? 'ready' : 'advice',
      detail: `${bound} of ${refs.length} ${refs.length === 1 ? 'field is' : 'fields are'} bound to an SF-SEM element.`,
    },
    {
      id: 'messages',
      title: 'Every custom error message can be shown',
      state: unusedMessages > 0 ? 'advice' : 'ready',
      detail:
        unusedMessages > 0
          ? `${unusedMessages} custom ${unusedMessages === 1 ? 'message is' : 'messages are'} never shown with the current rules.`
          : 'No unused custom messages.',
    },
  ];
}
