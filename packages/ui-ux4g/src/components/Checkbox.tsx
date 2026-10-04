import type { InputHTMLAttributes, ReactNode } from 'react';

export type CheckboxProps = {
  label: string;
  description?: ReactNode;
  error?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>;

export function Checkbox({ id, label, description, error, ...rest }: CheckboxProps) {
  const fieldId = id ?? rest.name ?? 'sf-checkbox';
  return (
    <label className={`ux4g-checkbox${error ? ' ux4g-checkbox-error' : ''}`} htmlFor={fieldId}>
      <input id={fieldId} type="checkbox" className="ux4g-checkbox-input" {...rest} />
      <span className="ux4g-checkbox-control" aria-hidden="true" />
      <span className="ux4g-checkbox-content">
        <span className="ux4g-label-m-default">{label}</span>
        {description ? <span className="ux4g-checkbox-description">{description}</span> : null}
      </span>
    </label>
  );
}
