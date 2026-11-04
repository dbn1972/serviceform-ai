import type { InputHTMLAttributes, ReactNode } from 'react';

export type FieldState = 'default' | 'error' | 'success' | 'warning';
export type InputSize = 's' | 'm' | 'l' | 'xl';

export type TextInputProps = {
  label: string;
  hint?: ReactNode;
  /** Replaces the hint and forces the error state when present. */
  error?: ReactNode;
  state?: FieldState;
  size?: InputSize;
  /** Fixed lead-in such as a country code, rendered as `ux4g-input-prefix`. */
  prefix?: ReactNode;
  /** Trailing control inside the field box (`ux4g-input-actions`). */
  action?: ReactNode;
  optional?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'size' | 'prefix'>;

export function TextInput({
  id,
  label,
  hint,
  error,
  state = 'default',
  size = 'm',
  prefix,
  action,
  optional,
  disabled,
  ...rest
}: TextInputProps) {
  const fieldId = id ?? rest.name ?? 'sf-field';
  const effective: FieldState = error ? 'error' : state;
  const prefixId = prefix ? `${fieldId}-prefix` : undefined;
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const describedBy = [prefixId, messageId].filter(Boolean).join(' ') || undefined;
  const stateClass = effective === 'default' ? 'ux4g-input-default' : `ux4g-input-${effective}`;
  return (
    <div
      className={`ux4g-input-container ux4g-input-${size} ${stateClass}${disabled ? ' ux4g-input-is-disabled' : ''}`}
    >
      <label className="ux4g-label-m-default" htmlFor={fieldId}>
        {label}
        {optional ? <span className="sf-label-optional"> (optional)</span> : null}
      </label>
      <div className={`ux4g-input${disabled ? ' ux4g-input-is-disabled' : ''}`}>
        {prefix ? (
          <span className="ux4g-input-prefix" id={prefixId}>
            {prefix}
          </span>
        ) : null}
        <input
          id={fieldId}
          className="ux4g-input-input"
          disabled={disabled}
          aria-invalid={effective === 'error'}
          aria-describedby={describedBy}
          {...rest}
        />
        {action ? <div className="ux4g-input-actions">{action}</div> : null}
      </div>
      {messageId ? (
        <p id={messageId} className="ux4g-input-helper ux4g-input-helper-text">
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
