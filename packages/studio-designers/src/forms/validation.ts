import {
  allFields,
  isChoice,
  isNumeric,
  type DesignerField,
  type DesignerForm,
  type FieldKind,
} from './model';
import {
  describePattern,
  examplePattern,
  isSupportedPattern,
  outsidePattern,
  patternLength,
  PATTERN_PRESETS,
} from './pattern';

/**
 * Plain-language validation, the inputs that probe it and synthetic sample answers. Nothing here
 * decides whether an answer passes: Studio runs these through the same UX4G runtime mirror as the
 * citizen wizard, and `tests/cdc/studio-forms-preview-parity.cdc.test.ts` proves CMP-009 agrees.
 */

/** Issue codes whose citizen copy an author can override per field. */
export const MESSAGE_CODES = [
  'REQUIRED',
  'MIN_LENGTH',
  'MAX_LENGTH',
  'PATTERN',
  'FORMAT_EMAIL',
  'FORMAT_DATE',
  'TYPE_NUMBER',
  'MINIMUM',
  'MAXIMUM',
  'CONST_MISMATCH',
] as const;

export type MessageCode = (typeof MESSAGE_CODES)[number];

function textual(kind: FieldKind): boolean {
  return kind === 'text' || kind === 'textarea' || kind === 'email';
}

function patterned(f: DesignerField): f is DesignerField & { pattern: string } {
  return (f.kind === 'text' || f.kind === 'textarea') && (f.pattern ?? '') !== '';
}

/** Issue codes an applicant can actually meet on this field, so their copy can ever show. */
export function reachableCodes(f: DesignerField): Set<MessageCode> {
  const out = new Set<MessageCode>();
  if (f.required || f.requiredWhen) out.add('REQUIRED');
  if (textual(f.kind)) {
    // A non-empty answer is at least one character long, so a minimum of 1 never refuses.
    if ((f.minLength ?? 0) >= 2) out.add('MIN_LENGTH');
    if (f.maxLength !== undefined) out.add('MAX_LENGTH');
  }
  if (patterned(f)) out.add('PATTERN');
  if (f.kind === 'email') out.add('FORMAT_EMAIL');
  if (f.kind === 'date') out.add('FORMAT_DATE');
  if (isNumeric(f.kind)) {
    out.add('TYPE_NUMBER');
    if (f.minimum !== undefined) out.add('MINIMUM');
    if (f.maximum !== undefined) out.add('MAXIMUM');
  }
  if (f.kind === 'declaration') out.add('CONST_MISMATCH');
  return out;
}

function span(min: number | undefined, max: number | undefined, unit: string): string | null {
  if (min !== undefined && max !== undefined) {
    return min === max ? `exactly ${min} ${unit}` : `${min}–${max} ${unit}`;
  }
  if (min !== undefined) return `at least ${min} ${unit}`;
  if (max !== undefined) return `up to ${max} ${unit}`;
  return null;
}

function rangeText(min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && max !== undefined) return `from ${min} to ${max}`;
  if (min !== undefined) return `${min} or more`;
  if (max !== undefined) return `${max} or less`;
  return null;
}

/** What the field accepts, in the words an author would use ("Digits only, 6 characters"). */
export function describeValidation(f: DesignerField): string[] {
  const out: string[] = [];
  if (patterned(f)) {
    const preset = describePattern(f.pattern);
    if (preset) {
      const label = PATTERN_PRESETS.find((p) => p.id === preset.preset)?.label ?? 'Pattern';
      out.push(`${label}, ${span(preset.min, preset.max, 'characters')?.replace(/^exactly /, '')}`);
    } else {
      out.push(isSupportedPattern(f.pattern) ? 'Custom pattern' : 'Unsupported pattern');
    }
  }
  if (textual(f.kind)) {
    const bounds = patterned(f) ? patternLength(f.pattern) : null;
    const minimum = (f.minLength ?? 0) > Math.max(1, bounds?.min ?? 0) ? f.minLength : undefined;
    const maximum =
      f.maxLength !== undefined && f.maxLength < (bounds?.max ?? Infinity)
        ? f.maxLength
        : undefined;
    const length = span(minimum, maximum, 'characters');
    if (length) out.push(length.charAt(0).toUpperCase() + length.slice(1));
  }
  if (f.kind === 'email') out.push('Email address');
  if (f.kind === 'date') out.push('Date');
  if (f.kind === 'integer') out.push('Whole number');
  if (f.kind === 'number') out.push('Number');
  if (isNumeric(f.kind)) {
    const range = rangeText(f.minimum, f.maximum);
    if (range) out.push(range.charAt(0).toUpperCase() + range.slice(1));
  }
  if (isChoice(f.kind)) {
    const n = f.options?.length ?? 0;
    out.push(`${n} ${n === 1 ? 'option' : 'options'}`);
  }
  if (f.kind === 'declaration') out.push('Must be ticked');
  return out;
}

/**
 * What the citizen UX4G renderer stores for typed input: empty is no answer, and the number box
 * converts whole numbers only (decimals stay text and are refused as "Enter a whole number").
 */
export function citizenValue(kind: FieldKind, raw: string): unknown {
  const trimmed = raw.trim();
  if (!isNumeric(kind)) return raw === '' ? undefined : raw;
  if (trimmed === '') return undefined;
  return /^-?[0-9]{1,15}$/.test(trimmed) ? Number(trimmed) : trimmed;
}

export interface ValidationCase {
  id: string;
  /** What the input is, never whether it passes. */
  label: string;
  /** Exactly what the applicant types. */
  input: string;
}

const MAX_CASE_LENGTH = 4096;

function repeatTo(seed: string, length: number): string {
  if (length <= 0) return '';
  return seed.repeat(Math.ceil(length / Math.max(seed.length, 1))).slice(0, length);
}

/** Text that passes the field's pattern (when any) at the given length, else filler text. */
function textOfLength(f: DesignerField, length: number): string {
  const seed = patterned(f) ? (examplePattern(f.pattern, length, length) ?? 'A') : 'A';
  return seed.length === length ? seed : repeatTo(seed.charAt(0) || 'A', length);
}

/**
 * Edge-case inputs for a typed field: empty, each length and range boundary on both sides, a
 * pattern example and a wrong character, and the formats the citizen controls can produce.
 * Choice and tick-box fields have nothing to type and get no cases.
 */
export function validationCases(f: DesignerField): ValidationCase[] {
  const cases: ValidationCase[] = [{ id: 'empty', label: 'Left empty', input: '' }];
  const add = (id: string, label: string, input: string) => {
    if (input.length > MAX_CASE_LENGTH) return;
    if (cases.some((c) => c.input === input)) return;
    cases.push({ id, label, input });
  };
  if (f.kind === 'text' || f.kind === 'textarea') {
    if (patterned(f)) {
      const example = examplePattern(f.pattern, f.minLength, f.maxLength);
      if (example) {
        add('pattern-example', 'Pattern example', example);
        const wrong = outsidePattern(f.pattern);
        if (wrong) add('pattern-wrong', 'Wrong first character', `${wrong}${example.slice(1)}`);
      }
      const lengths = patternLength(f.pattern);
      if (lengths && lengths.min > 1) {
        add('pattern-short', `${lengths.min - 1} characters`, textOfLength(f, lengths.min - 1));
      }
      if (lengths)
        add('pattern-long', `${lengths.max + 1} characters`, textOfLength(f, lengths.max + 1));
    }
    const min = f.minLength ?? 0;
    if (min >= 2) {
      add('min-below', `${min - 1} characters`, textOfLength(f, min - 1));
      add('min', `${min} characters`, textOfLength(f, min));
    }
    if (f.maxLength !== undefined) {
      add('max', `${f.maxLength} characters`, textOfLength(f, f.maxLength));
      add('max-above', `${f.maxLength + 1} characters`, textOfLength(f, f.maxLength + 1));
    }
    if (!patterned(f) && cases.length === 1) add('text', 'Some text', 'Sample answer');
  }
  if (f.kind === 'email') {
    add('email', 'Email address', 'applicant@example.test');
    add('email-no-at', 'Missing @', 'applicant.example.test');
    if (f.maxLength !== undefined) {
      const local = repeatTo('a', Math.max(f.maxLength + 1 - '@example.test'.length, 1));
      add('max-above', `${f.maxLength + 1} characters`, `${local}@example.test`);
    }
  }
  if (f.kind === 'date') {
    add('date', 'Date from the date picker', '2000-01-31');
    add('date-text', 'Day first, typed as text', '31-01-2000');
  }
  if (isNumeric(f.kind)) {
    if (f.minimum !== undefined) {
      const below = Number.isInteger(f.minimum) ? f.minimum - 1 : Math.floor(f.minimum);
      add('min-below', 'Just below the minimum', String(below));
      add('min', 'The minimum', String(f.minimum));
    }
    if (f.maximum !== undefined) {
      const above = Number.isInteger(f.maximum) ? f.maximum + 1 : Math.ceil(f.maximum);
      add('max', 'The maximum', String(f.maximum));
      add('max-above', 'Just above the maximum', String(above));
    }
    if (f.minimum === undefined && f.maximum === undefined) add('number', 'A whole number', '42');
    add('decimal', 'A decimal', '2.5');
    add('words', 'Words instead of digits', 'ten');
  }
  return cases.length > 1 ? cases : [];
}

/** A valid synthetic answer for one field, or undefined when its rules allow none. */
export function sampleValue(f: DesignerField): unknown {
  switch (f.kind) {
    case 'declaration':
    case 'checkbox':
      return true;
    case 'select':
    case 'radio':
      return f.options?.[0]?.value;
    case 'date':
      return '2000-01-31';
    case 'email':
      return 'applicant@example.test';
    case 'integer':
    case 'number': {
      const lo = f.minimum ?? -Infinity;
      const hi = f.maximum ?? Infinity;
      const whole = Math.min(Math.max(1, Math.ceil(lo)), Math.floor(hi));
      if (whole >= lo && whole <= hi) return whole;
      return f.kind === 'number' && lo <= hi ? lo : undefined;
    }
    case 'text':
    case 'textarea': {
      const min = f.minLength ?? 0;
      const max = f.maxLength ?? Infinity;
      if (patterned(f)) return examplePattern(f.pattern, min, max) ?? undefined;
      if (max < Math.max(min, 1)) return undefined;
      const base = 'Sample answer'.slice(0, max);
      return base.length >= min ? base : base.padEnd(min, 'x');
    }
  }
}

/** Synthetic SAMPLE_LAB answers for every field (grouped data nested), for the preview. */
export function sampleAnswers(form: DesignerForm): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const ref of allFields(form)) {
    const value = sampleValue(ref.field);
    if (value === undefined) continue;
    const [head, leaf] = ref.path.split('/') as [string, string | undefined];
    if (leaf === undefined) {
      data[head] = value;
      continue;
    }
    const child = data[head];
    data[head] = {
      ...(typeof child === 'object' && child !== null ? (child as Record<string, unknown>) : {}),
      [leaf]: value,
    };
  }
  return data;
}
