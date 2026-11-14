import type {
  FormPackage,
  FormSchemaNode,
  UiControl,
  UiElement,
  UiLayout,
  UiRule,
} from '@serviceform/service-templates';
import { pathOfScope } from './compile';
import type {
  ChoiceOption,
  DesignerField,
  DesignerForm,
  DesignerSection,
  DesignerStep,
  FieldKind,
  RequiredWhen,
  Scalar,
  VisibilityRule,
} from './model';

export interface ImportWarning {
  code: string;
  message: string;
  path?: string;
}

export interface ImportResult {
  form: DesignerForm;
  warnings: ImportWarning[];
}

let counter = 0;

/** Editor identity for steps, sections and fields. Never emitted into metadata. */
export function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  counter += 1;
  return `${prefix}-${uuid ?? counter.toString(36)}`;
}

/** Removes leading and trailing `ch` in linear time (no backtracking regex). */
export function trimChar(value: string, ch: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ch) start += 1;
  while (end > start && value[end - 1] === ch) end -= 1;
  return value.slice(start, end);
}

export function slugKey(label: string, fallback: string): string {
  const words = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  let slug = trimChar(words, '_');
  let i = 0;
  while (i < slug.length && !((slug[i] ?? '') >= 'a' && (slug[i] ?? '') <= 'z')) i += 1;
  slug = slug.slice(i, i + 48);
  return slug.length >= 2 ? slug : fallback;
}

export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 58)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 50)}_${Date.now().toString(36)}`;
}

function kindOf(node: FormSchemaNode, format: string | undefined): FieldKind {
  if (node.type === 'boolean') return node.const === true ? 'declaration' : 'checkbox';
  if (node.enum && node.enum.length > 0) return format === 'radio' ? 'radio' : 'select';
  if (node.type === 'integer') return 'integer';
  if (node.type === 'number') return 'number';
  if (node.format === 'date') return 'date';
  if (node.format === 'email') return 'email';
  return format === 'textarea' ? 'textarea' : 'text';
}

/**
 * Designer field for one JSON Schema property. Used by template import and by the palette's
 * semantic presets, so presets keep their canonical shape and semantic element id.
 */
export function fieldFromSchema(
  key: string,
  node: FormSchemaNode,
  opts: { format?: string; required: boolean; rule?: UiRule },
): DesignerField {
  const kind = kindOf(node, opts.format);
  const hints = node['x-ux4g'] ?? {};
  const field: DesignerField = {
    id: newId('field'),
    key,
    kind,
    label: node.title ?? key,
    required: opts.required,
  };
  if (node.description) field.description = node.description;
  if (hints.hint) field.hint = hints.hint;
  if (node.minLength !== undefined) field.minLength = node.minLength;
  if (node.maxLength !== undefined) field.maxLength = node.maxLength;
  if (node.pattern !== undefined) field.pattern = node.pattern;
  if (node.minimum !== undefined) field.minimum = node.minimum;
  if (node.maximum !== undefined) field.maximum = node.maximum;
  if (kind === 'select' || kind === 'radio') {
    const labels = hints.enum_labels;
    field.options = (node.enum ?? []).map((v): ChoiceOption => ({
      value: String(v),
      label: labels?.[String(v)] ?? String(v),
    }));
    if (labels && (field.options ?? []).every((o) => o.label === o.value)) {
      field.keepOptionLabels = true;
    }
    const offered = new Set((node.enum ?? []).map(String));
    const extra = Object.entries(labels ?? {}).filter(([k]) => !offered.has(k));
    if (extra.length > 0) field.extraOptionLabels = Object.fromEntries(extra);
  }
  if (hints.span === 2) field.wide = true;
  if (hints.inputMode) field.inputMode = hints.inputMode;
  if (hints.autocomplete) field.autocomplete = hints.autocomplete;
  if (hints.error_messages) field.errorMessages = { ...hints.error_messages };
  if (node.semanticElementId) field.semanticElementId = node.semanticElementId;
  if (opts.rule) {
    const rule = visibilityOf(opts.rule);
    if (rule) field.visibleWhen = rule;
  }
  return field;
}

function visibilityOf(rule: UiRule): VisibilityRule | null {
  if (rule.effect !== 'SHOW' && rule.effect !== 'HIDE') return null;
  const field = pathOfScope(rule.condition.scope);
  const { const: c, enum: e } = rule.condition.schema;
  if (e !== undefined) return { effect: rule.effect, field, oneOf: [...e] };
  if (c !== undefined) return { effect: rule.effect, field, equals: c };
  return null;
}

/** Reads a root `if: {properties: {a: {properties: {b: {const}}}}}` condition. */
function conditionOf(node: FormSchemaNode | undefined): RequiredWhen | null {
  const path: string[] = [];
  let cur = node;
  while (cur?.properties) {
    const entries = Object.entries(cur.properties);
    if (entries.length !== 1) return null;
    const [name, child] = entries[0] as [string, FormSchemaNode];
    path.push(name);
    cur = child;
  }
  if (!cur || cur.const === undefined || path.length === 0) return null;
  return { field: path.join('/'), equals: cur.const as Scalar };
}

function controlsOf(node: UiElement, warnings: ImportWarning[]): UiControl[] {
  if (node.type === 'Control') return [node];
  if (node.type !== 'Group') {
    warnings.push({
      code: 'LAYOUT_FLATTENED',
      message: `${node.type} inside a step is flattened into its section.`,
    });
  }
  return node.elements.flatMap((child) => controlsOf(child, warnings));
}

interface ImportContext {
  schema: FormSchemaNode;
  conditional: { when: RequiredWhen; keys: Set<string> } | null;
  warnings: ImportWarning[];
}

function sectionFromControls(
  controls: UiControl[],
  ctx: ImportContext,
  layout?: UiLayout,
): DesignerSection | null {
  const paths = controls.map((c) => pathOfScope(c.scope).split('/'));
  const section: DesignerSection = { id: newId('section'), fields: [] };
  if (layout?.label !== undefined) section.label = layout.label;
  if (layout?.rule) {
    const rule = visibilityOf(layout.rule);
    if (rule) section.visibleWhen = rule;
  }
  const head = paths[0]?.[0];
  const nested =
    paths.length > 0 && paths.every((p) => p.length === 2 && p[0] === head) && head !== undefined;
  if (nested) {
    const objectNode = ctx.schema.properties?.[head];
    if (!objectNode || objectNode.type !== 'object') {
      ctx.warnings.push({ code: 'OBJECT_MISSING', message: `No object property ${head}.` });
      return null;
    }
    section.object = { key: head, title: objectNode.title ?? head };
    if (objectNode.semanticElementId) {
      section.object.semanticElementId = objectNode.semanticElementId;
    }
    if (objectNode.required) section.object.requiredOrder = [...objectNode.required];
    const required = new Set(objectNode.required ?? []);
    controls.forEach((c, i) => {
      const key = paths[i]?.[1] ?? '';
      const node = objectNode.properties?.[key];
      if (!node) {
        ctx.warnings.push({ code: 'PROPERTY_MISSING', message: `No property ${head}/${key}.` });
        return;
      }
      section.fields.push(
        fieldFromSchema(key, node, {
          ...(c.options?.format ? { format: c.options.format } : {}),
          required: required.has(key),
          ...(c.rule ? { rule: c.rule } : {}),
        }),
      );
    });
    return section;
  }
  const rootRequired = new Set(ctx.schema.required ?? []);
  controls.forEach((c, i) => {
    const parts = paths[i] ?? [];
    if (parts.length !== 1) {
      ctx.warnings.push({
        code: 'MIXED_SECTION',
        message: `Control ${parts.join('/')} mixes nested and top-level fields; it was skipped.`,
        path: parts.join('/'),
      });
      return;
    }
    const key = parts[0] ?? '';
    const node = ctx.schema.properties?.[key];
    if (!node) {
      ctx.warnings.push({ code: 'PROPERTY_MISSING', message: `No property ${key}.`, path: key });
      return;
    }
    const field = fieldFromSchema(key, node, {
      ...(c.options?.format ? { format: c.options.format } : {}),
      required: rootRequired.has(key),
      ...(c.rule ? { rule: c.rule } : {}),
    });
    if (ctx.conditional?.keys.has(key)) field.requiredWhen = { ...ctx.conditional.when };
    section.fields.push(field);
  });
  return section;
}

function stepFrom(category: UiLayout, index: number, taken: Set<string>, ctx: ImportContext) {
  const label = category.label ?? `Step ${index + 1}`;
  const key = uniqueKey(slugKey(label, `step_${index + 1}`), taken);
  taken.add(key);
  const step: DesignerStep = {
    id: newId('step'),
    key,
    label,
    review: category.options?.review === true,
    sections: [],
  };
  if (category.options?.title) step.title = category.options.title;
  if (category.options?.hint) step.hint = category.options.hint;
  let inline: UiControl[] = [];
  const flush = () => {
    if (inline.length === 0) return;
    const section = sectionFromControls(inline, ctx);
    if (section) step.sections.push(section);
    inline = [];
  };
  for (const el of category.elements) {
    if (el.type === 'Control') {
      inline.push(el);
      continue;
    }
    flush();
    const section = sectionFromControls(controlsOf(el, ctx.warnings), ctx, el);
    if (section) step.sections.push(section);
  }
  flush();
  return step;
}

/**
 * Opens a CMP-009 FORM package in the designer. Forms produced by `compileForm` and the Studio
 * template catalogue round-trip to the same content hash; anything else is reported.
 */
export function importForm(pkg: FormPackage, version: string): ImportResult {
  const warnings: ImportWarning[] = [];
  const schema = pkg.json_schema;
  let conditional: ImportContext['conditional'] = null;
  if (schema.if || schema.then || schema.else) {
    const when = conditionOf(schema.if);
    if (!when || !schema.then?.required || schema.else) {
      warnings.push({
        code: 'CONDITION_UNSUPPORTED',
        message: 'Only a single root "required when" condition is supported; it was dropped.',
      });
    } else {
      conditional = { when, keys: new Set(schema.then.required) };
    }
  }
  const ctx: ImportContext = { schema, conditional, warnings };
  const ui = pkg.ui_schema;
  const categories: UiLayout[] =
    ui.type === 'Categorization'
      ? ui.elements.filter((e): e is UiLayout => e.type === 'Category')
      : [{ ...ui, type: 'Category', label: ui.label ?? 'Form' }];
  const taken = new Set<string>();
  const steps = categories.map((c, i) => stepFrom(c, i, taken, ctx));
  const form: DesignerForm = {
    formId: pkg.form_id,
    title: schema.title ?? pkg.form_id,
    version,
    steps,
  };
  if (schema.required) form.requiredOrder = [...schema.required];
  return { form, warnings };
}
