import { Icon } from '../components/Icon';

export type Ux4gFormStepperStep = { label: string; hint?: string };

export type Ux4gFormStepperProps = {
  steps: readonly Ux4gFormStepperStep[];
  current: number;
  /** Furthest step the applicant has reached; steps up to it can be reopened. */
  reachable: number;
  onSelect?: (index: number) => void;
  label?: string;
};

type StepState = 'done' | 'current' | 'todo';

const STATE_TEXT: Record<StepState, string> = {
  done: 'Completed',
  current: 'Current step',
  todo: 'Not started',
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
}: Ux4gFormStepperProps) {
  return (
    <nav className="sf-stepper" aria-label={label}>
      <ol className="sf-stepper-list">
        {steps.map((s, i) => {
          const state: StepState =
            i === current ? 'current' : i < reachable || i < current ? 'done' : 'todo';
          return (
            <li key={`${s.label}-${i}`} className={`sf-stepper-item sf-stepper-${state}`}>
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
                  {state === 'done' ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <span className="sf-stepper-copy">
                  <span className="ux4g-label-l-strong">{s.label}</span>
                  {s.hint ? <span className="ux4g-body-s-default">{s.hint}</span> : null}
                  <span className="ux4g-sr-only">
                    {`, step ${i + 1} of ${steps.length}, ${STATE_TEXT[state]}`}
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
