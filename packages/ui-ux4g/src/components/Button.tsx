import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant =
  | 'primary'
  | 'outline-primary'
  | 'tonal-primary'
  | 'text-primary'
  | 'danger'
  | 'outline-danger'
  | 'text-danger'
  | 'outline-neutral'
  | 'text-neutral';

export type ButtonSize = 'xs' | 's' | 'm' | 'l' | 'xl';

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

export function Button({
  variant = 'primary',
  size = 'm',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={`ux4g-btn-${variant} ux4g-btn-${size}`} {...rest}>
      {children}
    </button>
  );
}
