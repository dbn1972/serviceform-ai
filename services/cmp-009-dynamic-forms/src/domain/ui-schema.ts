import { Cmp009Error } from '../errors.js';
import type { JsonSchemaNode } from './schema.js';

const LAYOUT_TYPES = new Set(['VerticalLayout', 'HorizontalLayout', 'Group', 'Categorization']);
const EFFECTS = new Set(['SHOW', 'HIDE', 'ENABLE', 'DISABLE']);
const MAX_NODES = 256;
function isJsonPointerScope(scope: string): boolean {
  if (!scope.startsWith('#/properties/')) return false;
  const parts = scope.split('/');
  if (parts.length < 3 || parts[0] !== '#' || parts.length % 2 === 0) return false;
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] !== 'properties') return false;
    const name = parts[i + 1];
    if (!name || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) return false;
  }
  return true;
}

export type UiEffect = 'SHOW' | 'HIDE' | 'ENABLE' | 'DISABLE';

export interface UiRule {
  effect: UiEffect;
  scope: string;
  schema: JsonSchemaNode;
}

export interface UiNode {
  type: string;
  scope?: string;
  label?: string;
  i18n?: string;
  options?: { format?: string; multi?: boolean };
  rule?: UiRule;
  elements: UiNode[];
}

function uiFail(code: string): never {
  throw new Cmp009Error('SF-FORM-002', { statusCode: 422, details: [{ code }] });
}

function parseRule(raw: unknown): UiRule | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) uiFail('UI_RULE_INVALID');
  const r = raw as Record<string, unknown>;
  if (typeof r['effect'] !== 'string' || !EFFECTS.has(r['effect']))
    uiFail('UI_RULE_EFFECT_INVALID');
  const condition = r['condition'];
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) {
    uiFail('UI_RULE_CONDITION_INVALID');
  }
  const c = condition as Record<string, unknown>;
  if (typeof c['scope'] !== 'string' || !isJsonPointerScope(c['scope'])) uiFail('UI_RULE_SCOPE_INVALID');
  if (typeof c['schema'] !== 'object' || c['schema'] === null || Array.isArray(c['schema'])) {
    uiFail('UI_RULE_SCHEMA_INVALID');
  }
  return {
    effect: r['effect'] as UiEffect,
    scope: c['scope'],
    schema: c['schema'] as JsonSchemaNode,
  };
}

export function parseUiSchema(raw: unknown, count = { n: 0 }): UiNode {
  count.n += 1;
  if (count.n > MAX_NODES) uiFail('UI_SCHEMA_TOO_LARGE');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) uiFail('UI_SCHEMA_NOT_OBJECT');
  const n = raw as Record<string, unknown>;
  const type = n['type'];
  if (typeof type !== 'string') uiFail('UI_SCHEMA_TYPE_REQUIRED');
  if (type === 'Control') {
    if (typeof n['scope'] !== 'string' || !isJsonPointerScope(n['scope']))
      uiFail('UI_CONTROL_SCOPE_INVALID');
    const options = n['options'];
    let parsedOptions: UiNode['options'];
    if (options !== undefined) {
      if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        uiFail('UI_OPTIONS_INVALID');
      }
      const o = options as Record<string, unknown>;
      parsedOptions = {};
      if (typeof o['format'] === 'string') parsedOptions.format = o['format'];
      if (typeof o['multi'] === 'boolean') parsedOptions.multi = o['multi'];
    }
    const rule = parseRule(n['rule']);
    return {
      type,
      scope: n['scope'],
      ...(typeof n['label'] === 'string' ? { label: n['label'] } : {}),
      ...(typeof n['i18n'] === 'string' ? { i18n: n['i18n'] } : {}),
      ...(parsedOptions ? { options: parsedOptions } : {}),
      ...(rule ? { rule } : {}),
      elements: [],
    };
  }
  if (!LAYOUT_TYPES.has(type) && type !== 'Category') uiFail('UI_SCHEMA_TYPE_UNSUPPORTED');
  const elementsRaw = n['elements'];
  if (!Array.isArray(elementsRaw)) uiFail('UI_ELEMENTS_REQUIRED');
  const layoutRule = parseRule(n['rule']);
  return {
    type,
    ...(typeof n['label'] === 'string' ? { label: n['label'] } : {}),
    ...(typeof n['i18n'] === 'string' ? { i18n: n['i18n'] } : {}),
    ...(layoutRule ? { rule: layoutRule } : {}),
    elements: elementsRaw.map((child) => parseUiSchema(child, count)),
  };
}

export function scopeToPointer(scope: string): string {
  return scope.replace('#/properties/', '/').replaceAll('/properties/', '/');
}

export function scopeToField(scope: string): string {
  const parts = scope.split('/');
  return parts[parts.length - 1] ?? scope;
}

export function walkControls(node: UiNode, visit: (node: UiNode) => void): void {
  if (node.type === 'Control') visit(node);
  for (const child of node.elements) walkControls(child, visit);
}

function readPath(data: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return data;
  const parts = pointer.split('/').filter(Boolean);
  let cur: unknown = data;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function conditionMatches(rule: UiRule, data: unknown): boolean {
  const value = readPath(data, scopeToPointer(rule.scope));
  if (rule.schema.const !== undefined) return value === rule.schema.const;
  if (rule.schema.enum) return rule.schema.enum.includes(value);
  return value !== undefined;
}

export function evaluateVisibility(
  root: UiNode,
  data: unknown,
): { visible: Set<string>; enabled: Set<string> } {
  const visible = new Set<string>();
  const enabled = new Set<string>();
  const visit = (node: UiNode, parentVisible: boolean, parentEnabled: boolean): void => {
    let isVisible = parentVisible;
    let isEnabled = parentEnabled;
    if (node.rule) {
      const match = conditionMatches(node.rule, data);
      if (node.rule.effect === 'SHOW') isVisible = parentVisible && match;
      if (node.rule.effect === 'HIDE') isVisible = parentVisible && !match;
      if (node.rule.effect === 'ENABLE') isEnabled = parentEnabled && match;
      if (node.rule.effect === 'DISABLE') isEnabled = parentEnabled && !match;
    }
    if (node.type === 'Control' && node.scope && isVisible) {
      visible.add(node.scope);
      if (isEnabled) enabled.add(node.scope);
    }
    for (const child of node.elements) visit(child, isVisible, isEnabled);
  };
  visit(root, true, true);
  return { visible, enabled };
}
