/**
 * Client-side model for rendering a published CMP-009 FORM package with UX4G controls.
 * Validation here is a non-authoritative mirror for step-by-step feedback only: CMP-009
 * `POST /v1/executions` is authoritative, and its issues map back onto fields with
 * `issuesToErrors`. Supported keywords match the CMP-009 runtime (including its bounded
 * `pattern` subset) so the two cannot disagree on a field a citizen can fix.
 */

export interface FormHints {
  hint?: string;
  inputMode?: 'numeric' | 'email' | 'tel' | 'text';
  autocomplete?: string;
  enum_labels?: Record<string, string>;
  error_messages?: Record<string, string>;
  span?: 2;
}

export interface FormSchemaView {
  type?: string;
  title?: string;
  format?: string;
  enum?: readonly unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  properties?: Record<string, FormSchemaView>;
  required?: readonly string[];
  if?: FormSchemaView;
  then?: FormSchemaView;
  else?: FormSchemaView;
  'x-ux4g'?: FormHints;
}

export interface FormRuleView {
  effect: string;
  condition: { scope: string; schema: { const?: unknown; enum?: readonly unknown[] } };
}

export interface FormUiView {
  type: string;
  scope?: string;
  label?: string;
  options?: { format?: string; title?: string; hint?: string; review?: boolean };
  rule?: FormRuleView;
  elements?: readonly FormUiView[];
}

export interface FormPackageView {
  form_id: string;
  json_schema: FormSchemaView;
  ui_schema: FormUiView;
}

/** CMP-009 interpretation control (subset used by the renderer). */
export interface InterpretedControl {
  scope: string;
  field: string;
  visible: boolean;
  enabled: boolean;
  required: boolean;
  renderer_id: string;
  label?: string;
}

export type FormData = Record<string, unknown>;
export type FieldErrors = Record<string, string>;

export function scopeToPointer(scope: string): string {
  return scope.replace('#/properties/', '/').replaceAll('/properties/', '/');
}

const SAFE_SEGMENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RESERVED = new Set(['constructor', 'prototype']);

function safeSegments(pointer: string): string[] | null {
  const parts = pointer.split('/').filter(Boolean);
  return parts.every((p) => SAFE_SEGMENT.test(p) && !RESERVED.has(p)) ? parts : null;
}

function segments(pointer: string): string[] {
  return safeSegments(pointer) ?? [];
}

function ownValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/** Reads own properties only along a validated pointer. */
export function getAt(data: unknown, pointer: string): unknown {
  const parts = safeSegments(pointer);
  return parts ? parts.reduce<unknown>(ownValue, data) : undefined;
}

/** Immutable set; `undefined` removes the key. */
export function setAt(data: FormData, pointer: string, value: unknown): FormData {
  const parts = segments(pointer);
  if (parts.length === 0) return data;
  const [head, ...rest] = parts as [string, ...string[]];
  const others = Object.fromEntries(Object.entries(data).filter(([k]) => k !== head));
  if (rest.length === 0) return value === undefined ? others : { ...others, [head]: value };
  const child = data[head];
  const next = setAt(
    typeof child === 'object' && child !== null && !Array.isArray(child) ? (child as FormData) : {},
    `/${rest.join('/')}`,
    value,
  );
  return Object.keys(next).length === 0 ? others : { ...others, [head]: next };
}

export function schemaAt(root: FormSchemaView, pointer: string): FormSchemaView | undefined {
  let cur: FormSchemaView | undefined = root;
  for (const p of segments(pointer)) {
    cur = cur?.properties?.[p];
    if (!cur) return undefined;
  }
  return cur;
}

function conditionHolds(schema: FormSchemaView, data: unknown): boolean {
  if (schema.const !== undefined) return data === schema.const;
  if (schema.enum) return schema.enum.includes(data);
  if (schema.properties) {
    const rec = (typeof data === 'object' && data !== null ? data : {}) as FormData;
    return Object.entries(schema.properties).every(([k, c]) => conditionHolds(c, rec[k]));
  }
  return true;
}

/** Required names of an object node, including the active root `if/then/else` branch. */
function requiredNames(node: FormSchemaView, data: unknown): Set<string> {
  const names = new Set(node.required ?? []);
  if (node.if) {
    const branch = conditionHolds(node.if, data) ? node.then : node.else;
    for (const n of branch?.required ?? []) names.add(n);
  }
  return names;
}

export function isRequired(root: FormSchemaView, pointer: string, data: FormData): boolean {
  const parts = segments(pointer);
  let node: FormSchemaView | undefined = root;
  let value: unknown = data;
  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i] as string;
    if (!node || !requiredNames(node, value).has(name)) return false;
    node = node.properties?.[name];
    value = getAt(value, `/${name}`);
  }
  return true;
}

export interface WizardStep {
  label: string;
  title: string;
  hint: string;
  review: boolean;
  node: FormUiView;
}

export function wizardSteps(ui: FormUiView): WizardStep[] {
  const categories =
    ui.type === 'Categorization'
      ? (ui.elements ?? []).filter((e) => e.type === 'Category')
      : [{ ...ui, label: ui.label ?? 'Application' }];
  return categories.map((c) => ({
    label: c.label ?? '',
    title: c.options?.title ?? c.label ?? '',
    hint: c.options?.hint ?? '',
    review: c.options?.review === true,
    node: c,
  }));
}

export function controlScopes(node: FormUiView): string[] {
  if (node.type === 'Control') return node.scope ? [node.scope] : [];
  return (node.elements ?? []).flatMap(controlScopes);
}

/** Scopes whose value can change visibility; re-interpret only when one of these changes. */
export function ruleConditionScopes(node: FormUiView): string[] {
  const own = node.rule ? [node.rule.condition.scope] : [];
  return [...new Set([...own, ...(node.elements ?? []).flatMap(ruleConditionScopes)])];
}

/** Local mirror of CMP-009 SHOW/HIDE evaluation, used until an interpretation arrives. */
export function visibleScopes(ui: FormUiView, data: FormData): Set<string> {
  const out = new Set<string>();
  const visit = (node: FormUiView, parentVisible: boolean) => {
    let visible = parentVisible;
    if (node.rule && (node.rule.effect === 'SHOW' || node.rule.effect === 'HIDE')) {
      const value = getAt(data, scopeToPointer(node.rule.condition.scope));
      const { const: c, enum: e } = node.rule.condition.schema;
      const match = c !== undefined ? value === c : e ? e.includes(value) : value !== undefined;
      visible = parentVisible && (node.rule.effect === 'SHOW' ? match : !match);
    }
    if (node.type === 'Control' && node.scope && visible) out.add(node.scope);
    for (const child of node.elements ?? []) visit(child, visible);
  };
  visit(ui, true);
  return out;
}

/** Drops values of controls that are hidden, so they are neither validated nor stored. */
export function withoutHidden(ui: FormUiView, data: FormData, visible: Set<string>): FormData {
  let out = data;
  for (const scope of controlScopes(ui)) {
    if (!visible.has(scope)) out = setAt(out, scopeToPointer(scope), undefined);
  }
  return out;
}

const COUNT = /^[0-9]{1,2}$/;

/** `{n}` or `{n,m}` body; n and m are one or two digits. */
function repeatBounds(body: string): { min: number; max: number } | null {
  const parts = body.split(',');
  if (parts.length > 2 || !parts.every((p) => COUNT.test(p))) return null;
  const min = Number(parts[0]);
  return { min, max: parts.length === 2 ? Number(parts[1]) : min };
}

interface PatternToken {
  ranges: [number, number][];
  min: number;
  max: number;
}

/** Same bounded, anchored subset CMP-009 accepts; anything else is treated as unsupported. */
export function compilePattern(src: string): PatternToken[] | null {
  if (src.length < 3 || src.length > 128 || !src.startsWith('^') || !src.endsWith('$')) return null;
  const body = src.slice(1, -1);
  const tokens: PatternToken[] = [];
  const code = (c: string) => c.codePointAt(0) ?? -1;
  let i = 0;
  while (i < body.length) {
    const c = body[i] ?? '';
    let ranges: [number, number][] = [];
    if (c === '[') {
      const close = body.indexOf(']', i + 1);
      if (close < 0) return null;
      const inner = body.slice(i + 1, close).replaceAll('\\', '');
      if (inner.length === 0 || inner.startsWith('^')) return null;
      for (let j = 0; j < inner.length; j += 1) {
        const a = inner[j] ?? '';
        if (inner[j + 1] === '-' && inner[j + 2] !== undefined) {
          ranges.push([code(a), code(inner[j + 2] ?? '')]);
          j += 2;
        } else {
          ranges.push([code(a), code(a)]);
        }
      }
      i = close + 1;
    } else if (c === '\\') {
      const e = body[i + 1] ?? '';
      if (e === 'd') ranges = [[code('0'), code('9')]];
      else if ('.-/ _'.includes(e) && e !== '') ranges = [[code(e), code(e)]];
      else return null;
      i += 2;
    } else if (/^[A-Za-z0-9 _/-]$/.test(c)) {
      ranges = [[code(c), code(c)]];
      i += 1;
    } else {
      return null;
    }
    let min = 1;
    let max = 1;
    if (body[i] === '?') {
      min = 0;
      i += 1;
    } else if (body[i] === '{') {
      const close = body.indexOf('}', i);
      const bounds = close < 0 ? null : repeatBounds(body.slice(i + 1, close));
      if (!bounds) return null;
      ({ min, max } = bounds);
      if (max < min || max > 64 || max === 0) return null;
      i = close + 1;
    }
    tokens.push({ ranges, min, max });
    if (tokens.length > 32) return null;
  }
  return tokens.length > 0 ? tokens : null;
}

export function matchesPattern(src: string, value: string): boolean {
  const tokens = compilePattern(src);
  if (!tokens) return true;
  const chars = Array.from(value, (c) => c.codePointAt(0) ?? -1);
  let positions = new Set([0]);
  for (const t of tokens) {
    const next = new Set<number>();
    for (const start of positions) {
      for (let k = 0; k <= t.max; k += 1) {
        if (k >= t.min) next.add(start + k);
        const c = chars[start + k];
        if (c === undefined || !t.ranges.some(([lo, hi]) => c >= lo && c <= hi)) break;
      }
    }
    if (next.size === 0) return false;
    positions = next;
  }
  return positions.has(chars.length);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isEmail(v: string): boolean {
  const at = v.indexOf('@');
  return at > 0 && at === v.lastIndexOf('@') && v.indexOf('.', at + 2) > at && !/\s/.test(v);
}

/** First issue code for one control, or null. Mirrors CMP-009 `validateAgainstSchema`. */
export function fieldIssue(node: FormSchemaView, value: unknown, required: boolean): string | null {
  const empty = value === undefined || value === '';
  if (empty) return required ? 'REQUIRED' : null;
  if (node.const !== undefined && value !== node.const) return 'CONST_MISMATCH';
  if (node.enum && !node.enum.includes(value)) return 'ENUM_MISMATCH';
  if (node.type === 'string') {
    if (typeof value !== 'string') return 'TYPE_STRING';
    if (node.minLength !== undefined && value.length < node.minLength) return 'MIN_LENGTH';
    if (node.maxLength !== undefined && value.length > node.maxLength) return 'MAX_LENGTH';
    if (node.pattern && !matchesPattern(node.pattern, value)) return 'PATTERN';
    if (node.format === 'date' && !DATE_RE.test(value)) return 'FORMAT_DATE';
    if (node.format === 'email' && !isEmail(value)) return 'FORMAT_EMAIL';
  }
  if (node.type === 'integer' || node.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'TYPE_NUMBER';
    if (node.type === 'integer' && !Number.isInteger(value)) return 'TYPE_INTEGER';
    if (node.minimum !== undefined && value < node.minimum) return 'MINIMUM';
    if (node.maximum !== undefined && value > node.maximum) return 'MAXIMUM';
  }
  if (node.type === 'boolean' && typeof value !== 'boolean') return 'TYPE_BOOLEAN';
  return null;
}

export function labelOf(node: FormSchemaView | undefined, pointer: string): string {
  return node?.title ?? pointer.split('/').pop() ?? pointer;
}

/** Citizen-facing copy for an issue code; metadata `x-ux4g.error_messages` wins. */
export function issueMessage(node: FormSchemaView | undefined, code: string, pointer: string) {
  const custom = node?.['x-ux4g']?.error_messages?.[code];
  if (custom) return custom;
  const label = labelOf(node, pointer).toLowerCase();
  switch (code) {
    case 'REQUIRED':
      return node?.enum ? `Select ${label}` : `Enter ${label}`;
    case 'MIN_LENGTH':
      return `Enter at least ${node?.minLength ?? 1} characters`;
    case 'MAX_LENGTH':
      return `Use ${node?.maxLength ?? 0} characters or fewer`;
    case 'MINIMUM':
      return `Enter ${node?.minimum ?? 0} or more`;
    case 'MAXIMUM':
      return `Enter ${node?.maximum ?? 0} or less`;
    case 'TYPE_NUMBER':
    case 'TYPE_INTEGER':
      return 'Enter a whole number';
    case 'FORMAT_DATE':
      return 'Enter a valid date';
    case 'FORMAT_EMAIL':
      return 'Enter a valid email address';
    case 'ENUM_MISMATCH':
      return `Select a listed ${label}`;
    default:
      return `Check ${label}`;
  }
}

/** Errors for the visible controls under `node` (one step). */
export function stepErrors(
  root: FormSchemaView,
  node: FormUiView,
  data: FormData,
  visible: Set<string>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const scope of controlScopes(node)) {
    if (!visible.has(scope)) continue;
    const pointer = scopeToPointer(scope);
    const schema = schemaAt(root, pointer);
    if (!schema) continue;
    const code = fieldIssue(schema, getAt(data, pointer), isRequired(root, pointer, data));
    if (code) errors[pointer] = issueMessage(schema, code, pointer);
  }
  return errors;
}

/** Maps authoritative CMP-009 issues (`{code, pointer}`) onto field messages. */
export function issuesToErrors(
  root: FormSchemaView,
  issues: readonly { code: string; pointer: string }[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    if (errors[issue.pointer]) continue;
    errors[issue.pointer] = issueMessage(schemaAt(root, issue.pointer), issue.code, issue.pointer);
  }
  return errors;
}

/** Index of the first step that holds one of the given pointers, or -1. */
export function stepOfPointer(steps: readonly WizardStep[], pointers: readonly string[]): number {
  return steps.findIndex((s) =>
    controlScopes(s.node).some((scope) => pointers.includes(scopeToPointer(scope))),
  );
}

export function displayValue(node: FormSchemaView | undefined, value: unknown): string {
  if (value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const labels = node?.['x-ux4g']?.enum_labels;
  if (labels && typeof value === 'string' && labels[value]) return labels[value];
  return String(value);
}
