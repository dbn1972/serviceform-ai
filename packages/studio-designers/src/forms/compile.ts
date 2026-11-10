import type {
  FormPackage,
  FormSchemaNode,
  UiControl,
  UiElement,
  UiLayout,
  UiRule,
  Ux4gHints,
} from '@serviceform/service-templates';
import {
  isChoice,
  isNumeric,
  type DesignerField,
  type DesignerForm,
  type DesignerSection,
  type DesignerStep,
  type RequiredWhen,
  type VisibilityRule,
} from './model';

export function scopeOf(path: string): string {
  return `#/properties/${path.split('/').join('/properties/')}`;
}

export function pathOfScope(scope: string): string {
  return scope.replace('#/properties/', '').split('/properties/').join('/');
}

export function ruleOf(rule: VisibilityRule): UiRule {
  const schema =
    rule.oneOf !== undefined
      ? { enum: rule.oneOf }
      : rule.equals !== undefined
        ? { const: rule.equals }
        : {};
  return { effect: rule.effect, condition: { scope: scopeOf(rule.field), schema } };
}

function hintsOf(f: DesignerField): Ux4gHints | undefined {
  const hints: Ux4gHints = {};
  if (f.hint) hints.hint = f.hint;
  if (f.inputMode) hints.inputMode = f.inputMode;
  if (f.autocomplete) hints.autocomplete = f.autocomplete;
  const options = f.options ?? [];
  if (
    isChoice(f.kind) &&
    options.length > 0 &&
    (f.keepOptionLabels === true || options.some((o) => o.label !== o.value))
  ) {
    hints.enum_labels = {
      ...f.extraOptionLabels,
      ...Object.fromEntries(options.map((o) => [o.value, o.label])),
    };
  }
  const messages = Object.entries(f.errorMessages ?? {}).filter(([, v]) => v.trim().length > 0);
  if (messages.length > 0) hints.error_messages = Object.fromEntries(messages);
  if (f.wide) hints.span = 2;
  return Object.keys(hints).length > 0 ? hints : undefined;
}

/** JSON Schema node for one designer field (standard keywords carry all validation meaning). */
export function fieldSchema(f: DesignerField): FormSchemaNode {
  const node: FormSchemaNode = {};
  switch (f.kind) {
    case 'text':
    case 'textarea':
      node.type = 'string';
      break;
    case 'integer':
      node.type = 'integer';
      break;
    case 'number':
      node.type = 'number';
      break;
    case 'date':
      node.type = 'string';
      node.format = 'date';
      break;
    case 'email':
      node.type = 'string';
      node.format = 'email';
      break;
    case 'select':
    case 'radio':
      node.type = 'string';
      node.enum = (f.options ?? []).map((o) => o.value);
      break;
    case 'checkbox':
      node.type = 'boolean';
      break;
    case 'declaration':
      node.type = 'boolean';
      node.const = true;
      break;
  }
  node.title = f.label;
  if (f.description) node.description = f.description;
  if (f.kind === 'text' || f.kind === 'textarea' || f.kind === 'email') {
    if (f.minLength !== undefined) node.minLength = f.minLength;
    if (f.maxLength !== undefined) node.maxLength = f.maxLength;
  }
  if ((f.kind === 'text' || f.kind === 'textarea') && f.pattern) node.pattern = f.pattern;
  if (isNumeric(f.kind)) {
    if (f.minimum !== undefined) node.minimum = f.minimum;
    if (f.maximum !== undefined) node.maximum = f.maximum;
  }
  if (f.semanticElementId) node.semanticElementId = f.semanticElementId;
  const hints = hintsOf(f);
  if (hints) node['x-ux4g'] = hints;
  return node;
}

function controlOf(section: DesignerSection, f: DesignerField): UiControl {
  const path = section.object ? `${section.object.key}/${f.key}` : f.key;
  const control: UiControl = { type: 'Control', scope: scopeOf(path) };
  if (f.kind === 'radio') control.options = { format: 'radio' };
  if (f.kind === 'textarea') control.options = { format: 'textarea' };
  if (f.visibleWhen) control.rule = ruleOf(f.visibleWhen);
  return control;
}

function sectionElements(section: DesignerSection): UiElement[] {
  const controls = section.fields.map((f) => controlOf(section, f));
  if (section.label === undefined && !section.visibleWhen) return controls;
  const group: UiLayout = { type: 'Group', elements: controls };
  if (section.label !== undefined) group.label = section.label;
  if (section.visibleWhen) group.rule = ruleOf(section.visibleWhen);
  return [group];
}

function categoryOf(step: DesignerStep): UiLayout {
  const category: UiLayout = {
    type: 'Category',
    label: step.label,
    elements: step.sections.flatMap(sectionElements),
  };
  const options: NonNullable<UiLayout['options']> = {};
  if (step.title) options.title = step.title;
  if (step.hint) options.hint = step.hint;
  if (step.review) options.review = true;
  if (Object.keys(options).length > 0) category.options = options;
  return category;
}

/** Required names in declared order first, then any others in layout order. */
function ordered(names: string[], declared: readonly string[] | undefined): string[] {
  if (!declared) return names;
  const set = new Set(names);
  const head = declared.filter((n) => set.has(n));
  const seen = new Set(head);
  return [...head, ...names.filter((n) => !seen.has(n))];
}

function objectNode(section: DesignerSection): FormSchemaNode {
  const object = section.object;
  const properties: Record<string, FormSchemaNode> = {};
  let required: string[] = [];
  for (const f of section.fields) {
    properties[f.key] = fieldSchema(f);
    if (f.required) required.push(f.key);
  }
  required = ordered(required, object?.requiredOrder);
  const node: FormSchemaNode = {
    type: 'object',
    title: object?.title ?? section.label ?? '',
    additionalProperties: false,
    properties,
  };
  if (required.length > 0) node.required = required;
  if (object?.semanticElementId) node.semanticElementId = object.semanticElementId;
  return node;
}

/** `if` schema for a root condition; nested paths nest `properties`. */
export function conditionSchema(when: RequiredWhen): FormSchemaNode {
  const parts = when.field.split('/');
  let node: FormSchemaNode = { const: when.equals };
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    node = { properties: { [parts[i] ?? '']: node } };
  }
  return node;
}

/**
 * Compiles the designer model into a CMP-009 FORM package. Pure and deterministic: the same
 * model always yields the same package and therefore the same content hash.
 */
export function compileForm(form: DesignerForm): FormPackage {
  const properties: Record<string, FormSchemaNode> = {};
  const required: string[] = [];
  const conditional: { when: RequiredWhen; keys: string[] } = {
    when: { field: '', equals: true },
    keys: [],
  };
  for (const step of form.steps) {
    for (const section of step.sections) {
      if (section.object) {
        const node = objectNode(section);
        properties[section.object.key] = node;
        if ((node.required ?? []).length > 0) required.push(section.object.key);
        continue;
      }
      for (const f of section.fields) {
        properties[f.key] = fieldSchema(f);
        if (f.required) required.push(f.key);
        if (f.requiredWhen) {
          if (conditional.keys.length === 0) conditional.when = f.requiredWhen;
          conditional.keys.push(f.key);
        }
      }
    }
  }
  const jsonSchema: FormSchemaNode = {
    type: 'object',
    title: form.title,
    additionalProperties: false,
    required: ordered(required, form.requiredOrder),
    properties,
  };
  if (conditional.keys.length > 0) {
    jsonSchema.if = conditionSchema(conditional.when);
    jsonSchema.then = { required: conditional.keys };
  }
  return {
    form_id: form.formId,
    json_schema: jsonSchema,
    ui_schema: { type: 'Categorization', elements: form.steps.map(categoryOf) },
  };
}

/** CMP-033 FORM structural summary (`pages[].fields[]`). */
export function formPages(
  form: DesignerForm,
): { id: string; fields: { id: string; control: string }[] }[] {
  return form.steps.map((step) => ({
    id: step.key,
    fields: step.sections.flatMap((section) =>
      section.fields.map((f) => ({
        id: section.object ? `${section.object.key}.${f.key}` : f.key,
        control: f.kind,
      })),
    ),
  }));
}
