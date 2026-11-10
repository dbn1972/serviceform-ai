import type { ReactNode, SelectHTMLAttributes } from 'react';
import type { InputSize } from './TextInput';

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = {
  label: string;
  options: readonly SelectOption[];
  hint?: ReactNode;
  error?: ReactNode;
  size?: InputSize;
  /** Leading empty option, e.g. "Select". */
  placeholder?: string;
  optional?: boolean;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'size'>;

/** UX4G input-container select (same field box, label and helper as `TextInput`). */
export function Select({
  id,
  label,
  options,
  hint,
  error,
  size = 'm',
  placeholder,
  optional,
  disabled,
  ...rest
}: SelectProps) {
  const fieldId = id ?? rest.name ?? 'sf-select';
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div
      className={`ux4g-input-container ux4g-input-${size} ${error ? 'ux4g-input-error' : 'ux4g-input-default'}${disabled ? ' ux4g-input-is-disabled' : ''}`}
    >
      <label className="ux4g-label-m-default" htmlFor={fieldId}>
        {label}
        {optional ? <span className="sf-label-optional"> (optional)</span> : null}
      </label>
      <div className={`ux4g-input${disabled ? ' ux4g-input-is-disabled' : ''}`}>
        <select
          id={fieldId}
          className="ux4g-input-input"
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={messageId}
          {...rest}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {messageId ? (
        <p id={messageId} className="ux4g-input-helper ux4g-input-helper-text">
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
