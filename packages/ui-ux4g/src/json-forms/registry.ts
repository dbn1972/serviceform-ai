/**
 * JSON Forms is schema/runtime only (DESIGN-SYSTEM.md). Visual widgets resolve here
 * to UX4G-backed renderer ids — never to MUI/Bootstrap/default JSON Forms skins.
 */

export type JsonSchemaNode = {
  type?: string;
  format?: string;
  enum?: readonly unknown[];
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

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
