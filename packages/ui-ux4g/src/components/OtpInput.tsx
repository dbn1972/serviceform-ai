'use client';

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';

export type OtpState = 'default' | 'error' | 'success' | 'locked';

export type OtpInputProps = {
  id: string;
  label: ReactNode;
  /** Digits entered so far; empty slots are spaces so positions are preserved. */
  value: string;
  onChange: (value: string) => void;
  length?: number;
  state?: OtpState;
  /** Live status line under the slots (error, success or lock-out copy). */
  status?: ReactNode;
  /** Non-live meta row (countdowns, resend) so ticking timers are not announced. */
  meta?: ReactNode;
  /** Change to replay the UX4G error shake for a repeated failure. */
  errorKey?: number;
  autoFocus?: boolean;
  disabled?: boolean;
};

const STATUS_ICON = { error: 'alert', success: 'check-circle', locked: 'lock' } as const;

function toSlots(value: string, length: number): string[] {
  return Array.from({ length }, (_, i) => {
    const ch = value[i] ?? '';
    return /\d/.test(ch) ? ch : '';
  });
}

function fromSlots(slots: readonly string[]): string {
  return slots
    .map((d) => d || ' ')
    .join('')
    .trimEnd();
}

/**
 * UX4G 3.0 OTP input (`ux4g-otp` / `ux4g-otp-slot`): one labelled box per digit, paste and
 * SMS autofill distribution, arrow/backspace navigation and error/success/locked states.
 */
export function OtpInput({
  id,
  label,
  value,
  onChange,
  length = 6,
  state = 'default',
  status,
  meta,
  errorKey = 0,
  autoFocus,
  disabled,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const [shake, setShake] = useState(false);
  const slots = toSlots(value, length);
  const statusId = `${id}-status`;
  const locked = state === 'locked' || Boolean(disabled);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (state !== 'error') return undefined;
    setShake(true);
    const timer = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(timer);
  }, [state, errorKey]);

  const focusSlot = (index: number) => {
    const target = refs.current[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  };

  const distribute = (start: number, digits: string) => {
    const next = [...slots];
    let cursor = start;
    for (const d of digits) {
      if (cursor >= length) break;
      next[cursor] = d;
      cursor += 1;
    }
    onChange(fromSlots(next));
    focusSlot(cursor);
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const next = [...slots];
    if (!digits) {
      next[index] = '';
      onChange(fromSlots(next));
      return;
    }
    const current = next[index];
    if (digits.length === 2 && current && digits.includes(current)) {
      next[index] = digits[0] === current ? (digits[1] ?? current) : (digits[0] ?? current);
      onChange(fromSlots(next));
      focusSlot(index + 1);
      return;
    }
    distribute(index, digits);
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    event.preventDefault();
    distribute(digits.length === length ? 0 : index, digits);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !slots[index] && index > 0) {
      event.preventDefault();
      const next = [...slots];
      next[index - 1] = '';
      onChange(fromSlots(next));
      focusSlot(index - 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusSlot(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusSlot(index + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusSlot(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusSlot(length - 1);
    }
  };

  return (
    <fieldset className={`ux4g-otp sf-otp ux4g-otp-${state}`}>
      <legend className="ux4g-otp-label ux4g-label-m-default">{label}</legend>
      <div className={`ux4g-otp-group${shake ? ' ux4g-otp-shake' : ''}`}>
        {slots.map((digit, index) => (
          <div key={index} className="ux4g-input ux4g-otp-slot">
            <input
              ref={(el) => {
                refs.current[index] = el;
              }}
              id={index === 0 ? id : `${id}-${index + 1}`}
              className={`ux4g-input-input ux4g-otp-input${
                focused === index && !digit && !locked ? ' ux4g-otp-caret' : ''
              }`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              disabled={locked}
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              aria-label={`Digit ${index + 1} of ${length}`}
              aria-invalid={state === 'error' || undefined}
              aria-describedby={statusId}
              placeholder={focused === index ? '' : '–'}
              value={digit}
              onFocus={(e) => {
                setFocused(index);
                e.currentTarget.select();
              }}
              onBlur={() => setFocused((f) => (f === index ? null : f))}
              onChange={(e) => handleChange(index, e.target.value)}
              onPaste={(e) => handlePaste(index, e)}
              onKeyDown={(e) => handleKeyDown(index, e)}
            />
          </div>
        ))}
      </div>
      <p id={statusId} className="ux4g-otp-status" aria-live="polite">
        {status && state !== 'default' ? <Icon name={STATUS_ICON[state]} size={18} /> : null}
        {status ? <span>{status}</span> : null}
      </p>
      {meta ? <div className="ux4g-otp-meta ux4g-otp-meta-between">{meta}</div> : null}
    </fieldset>
  );
}
