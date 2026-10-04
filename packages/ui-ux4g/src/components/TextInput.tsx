import type { InputHTMLAttributes, ReactNode } from 'react';

export type FieldState = 'default' | 'error' | 'success' | 'warning';
export type InputSize = 's' | 'm' | 'l' | 'xl';

export type TextInputProps = {
  label: string;
  hint?: ReactNode;
  state?: FieldState;
  size?: InputSize;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'>;

export function TextInput({
  id,
  label,
  hint,
  state = 'default',
  size = 'm',
  disabled,
  ...rest
}: TextInputProps) {
  const fieldId = id ?? rest.name ?? 'sf-field';
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const stateClass = state === 'default' ? 'ux4g-input-default' : `ux4g-input-${state}`;
  return (
    <div
      className={`ux4g-input-container ux4g-input-${size} ${stateClass}${disabled ? ' ux4g-input-is-disabled' : ''}`}
    >
      <label className="ux4g-label-m-default" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className="ux4g-input-input"
        disabled={disabled}
        aria-invalid={state === 'error'}
        aria-describedby={hintId}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="ux4g-input-helper-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
