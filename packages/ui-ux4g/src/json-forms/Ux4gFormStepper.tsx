import { Icon } from '../components/Icon';
import type { FormProgress } from './form-model';

export type Ux4gFormStepperStep = { label: string; hint?: string };

export type Ux4gFormStepperProps = {
  steps: readonly Ux4gFormStepperStep[];
  current: number;
  /** Furthest step the applicant has reached; steps up to it can be reopened. */
  reachable: number;
  onSelect?: (index: number) => void;
  label?: string;
  /** Required answers given so far (see `formProgress`); shown as a bar above the steps. */
  progress?: FormProgress | undefined;
  /** Steps holding an answer that still needs attention, e.g. after a refused submit. */
  attention?: readonly number[] | undefined;
  /** Reached steps whose answers no longer pass their checks; never shown as completed. */
  incomplete?: readonly number[] | undefined;
};

type StepState = 'done' | 'current' | 'todo' | 'open';

const STATE_TEXT: Record<StepState, string> = {
  done: 'Completed',
  current: 'Current step',
  todo: 'Not started',
  open: 'Not complete',
};

/**
 * Wizard progress for a metadata FORM (registered extension of the UX4G stepper). Steps after the
 * furthest reached one are disabled; each step names its state for assistive technology.
 */
export function Ux4gFormStepper({
  steps,
  current,
  reachable,
  onSelect,
  label = 'Application steps',
  progress,
  attention,
  incomplete,
}: Ux4gFormStepperProps) {
  return (
    <nav className="sf-stepper" aria-label={label}>
      {progress ? (
        <div className="sf-form-progress" data-testid="form-progress">
          <p className="sf-form-progress-text">
            <span className="ux4g-label-m-strong">{progress.percent}% complete</span>
            <span className="ux4g-body-s-default">
              {progress.answered} of {progress.total} required answers
            </span>
          </p>
          <progress
            className="sf-form-progress-bar"
            max={Math.max(progress.total, 1)}
            value={progress.total === 0 ? 1 : progress.answered}
            aria-label="Required answers given"
          />
        </div>
      ) : null}
      <ol className="sf-stepper-list">
        {steps.map((s, i) => {
          const reached = i < reachable || i < current;
          const state: StepState =
            i === current
              ? 'current'
              : !reached
                ? 'todo'
                : incomplete?.includes(i) === true
                  ? 'open'
                  : 'done';
          const flagged = state !== 'current' && attention?.includes(i) === true;
          return (
            <li
              key={`${s.label}-${i}`}
              className={`sf-stepper-item sf-stepper-${state === 'open' ? 'todo' : state}${flagged ? ' sf-stepper-attention' : ''}`}
            >
              <button
                type="button"
                className="sf-stepper-btn"
                aria-current={state === 'current' ? 'step' : undefined}
                disabled={i > Math.max(reachable, current)}
                onClick={() => {
                  if (i !== current) onSelect?.(i);
                }}
              >
                <span className="sf-stepper-index" aria-hidden="true">
                  {flagged ? (
                    <Icon name="alert" size={16} />
                  ) : state === 'done' ? (
                    <Icon name="check" size={14} />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="sf-stepper-copy">
                  <span className="ux4g-label-l-strong">{s.label}</span>
                  {flagged ? (
                    <span className="ux4g-body-s-default sf-stepper-flag">Needs attention</span>
                  ) : s.hint ? (
                    <span className="ux4g-body-s-default">{s.hint}</span>
                  ) : null}
                  <span className="ux4g-sr-only">
                    {`, step ${i + 1} of ${steps.length}${flagged ? '' : `, ${STATE_TEXT[state]}`}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
