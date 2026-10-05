import type { JsonSchemaNode } from './schema.js';

/** Renderer ids compatible with packages/ui-ux4g (CMP-054). Do not fork primitives. */
export type Ux4gRendererId =
  | 'Ux4gTextInput'
  | 'Ux4gTextarea'
  | 'Ux4gNumberInput'
  | 'Ux4gDateInput'
  | 'Ux4gCheckbox'
  | 'Ux4gRadioGroup'
  | 'Ux4gSelect'
  | 'Ux4gUnsupported';

export type UiSchemaHint = {
  control?: string;
  options?: { format?: string; multi?: boolean };
};

export function resolveUx4gRenderer(schema: JsonSchemaNode, ui?: UiSchemaHint): Ux4gRendererId {
  const hint = ui?.control ?? ui?.options?.format;
  if (hint === 'textarea') return 'Ux4gTextarea';
  if (hint === 'radio' && schema.enum) return 'Ux4gRadioGroup';
  if (schema.enum && schema.enum.length > 0) return 'Ux4gSelect';
  if (schema.format === 'date' || schema.format === 'date-time') return 'Ux4gDateInput';
  switch (schema.type) {
    case 'boolean':
      return 'Ux4gCheckbox';
    case 'number':
    case 'integer':
      return 'Ux4gNumberInput';
    case 'string':
      return 'Ux4gTextInput';
    default:
      return 'Ux4gUnsupported';
  }
}

export const UX4G_JSON_FORMS_RENDERERS: Record<Ux4gRendererId, { ux4gClass: string }> = {
  Ux4gTextInput: { ux4gClass: 'ux4g-input-container' },
  Ux4gTextarea: { ux4gClass: 'ux4g-input-container' },
  Ux4gNumberInput: { ux4gClass: 'ux4g-input-container' },
  Ux4gDateInput: { ux4gClass: 'ux4g-input-container' },
  Ux4gCheckbox: { ux4gClass: 'ux4g-checkbox' },
  Ux4gRadioGroup: { ux4gClass: 'ux4g-radio' },
  Ux4gSelect: { ux4gClass: 'ux4g-input-container' },
  Ux4gUnsupported: { ux4gClass: 'ux4g-alert-warning' },
};

export interface AccessibilityContract {
  renderer_id: Ux4gRendererId;
  ux4g_class: string;
  label_association: 'htmlFor';
  required_announced: boolean;
  keyboard: 'tab';
  aria_invalid_on_error: true;
}

export function accessibilityContract(
  renderer: Ux4gRendererId,
  required: boolean,
): AccessibilityContract {
  return {
    renderer_id: renderer,
    ux4g_class: UX4G_JSON_FORMS_RENDERERS[renderer].ux4gClass,
    label_association: 'htmlFor',
    required_announced: required,
    keyboard: 'tab',
    aria_invalid_on_error: true,
  };
}

export function schemaNodeAt(root: JsonSchemaNode, scope: string): JsonSchemaNode | undefined {
  const parts = scope.replace(/^#\//, '').split('/').filter(Boolean);
  let cur: JsonSchemaNode | undefined = root;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === 'properties' && cur?.properties) {
      const name = parts[i + 1];
      if (!name) return undefined;
      cur = cur.properties[name];
      i += 1;
      continue;
    }
    return undefined;
  }
  return cur;
}
