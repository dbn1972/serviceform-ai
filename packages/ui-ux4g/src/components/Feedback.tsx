import type { ReactNode } from 'react';

export type RadioOption = { value: string; label: string };

export type RadioGroupProps = {
  name: string;
  legend: string;
  options: readonly RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  error?: boolean;
};

export function RadioGroup({ name, legend, options, value, onChange, error }: RadioGroupProps) {
  return (
    <fieldset className={error ? 'ux4g-radio ux4g-radio-error' : 'ux4g-radio'}>
      <legend className="ux4g-label-m-strong">{legend}</legend>
      {options.map((opt) => {
        const id = `${name}-${opt.value}`;
        return (
          <label key={opt.value} className="ux4g-radio" htmlFor={id}>
            <input
              id={id}
              type="radio"
              className="ux4g-radio-input"
              name={name}
              value={opt.value}
              checked={value === undefined ? undefined : value === opt.value}
              onChange={onChange ? () => onChange(opt.value) : undefined}
            />
            <span className="ux4g-radio-control" aria-hidden="true" />
            <span className="ux4g-label-m-default">{opt.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

export type SwitchProps = {
  id?: string;
  name?: string;
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
};

export function Switch({ id, name, label, checked, onChange, disabled }: SwitchProps) {
  const fieldId = id ?? name ?? 'sf-switch';
  return (
    <label className="ux4g-switch" htmlFor={fieldId}>
      <input
        id={fieldId}
        name={name}
        type="checkbox"
        role="switch"
        className="ux4g-switch-input"
        checked={checked}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
      />
      <span className="ux4g-label-m-default">{label}</span>
    </label>
  );
}

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export type AlertProps = {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
};

export function Alert({ variant = 'info', title, children }: AlertProps) {
  return (
    <div
      className={`ux4g-alert ux4g-alert-${variant}`}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {title ? <p className="ux4g-alert-title">{title}</p> : null}
      <div className="ux4g-alert-message">{children}</div>
    </div>
  );
}

export type CardProps = { children: ReactNode; title?: string };

export function Card({ title, children }: CardProps) {
  return (
    <section className="ux4g-card">
      {title ? <h2 className="ux4g-heading-xl-default">{title}</h2> : null}
      <div>{children}</div>
    </section>
  );
}

export type TextLinkProps = {
  href: string;
  children: ReactNode;
};

export function TextLink({ href, children }: TextLinkProps) {
  return (
    <a className="ux4g-text-link-md" href={href}>
      {children}
    </a>
  );
}
