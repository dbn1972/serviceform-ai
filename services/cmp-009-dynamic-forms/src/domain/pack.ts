import { Cmp009Error } from '../errors.js';
import { FORM_KEY_RE, MESSAGE_KEY_RE } from './canonical.js';
import { assertRootObjectSchema, parseJsonSchema, type JsonSchemaNode } from './schema.js';
import { parseUiSchema, type UiNode } from './ui-schema.js';

function bad(code: string): never {
  throw new Cmp009Error('SF-FORM-002', { statusCode: 422, details: [{ code }] });
}

export interface FormPackage {
  formId: string;
  jsonSchema: JsonSchemaNode;
  uiSchema: UiNode;
  messageKeys: string[];
}

/**
 * Parses published FORM metadata. JSON Schema + UI schema only; no named-service branching.
 */
export function parseFormPackage(payload: unknown, expectedFormKey: string): FormPackage {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    bad('FORM_PACKAGE_NOT_OBJECT');
  }
  const p = payload as Record<string, unknown>;
  const id = p['form_id'];
  if (typeof id !== 'string' || !FORM_KEY_RE.test(id)) bad('FORM_ID_INVALID');
  if (id !== expectedFormKey) bad('FORM_KEY_MISMATCH');
  const schema = parseJsonSchema(p['json_schema']);
  assertRootObjectSchema(schema);
  const ui = parseUiSchema(p['ui_schema']);
  const keysRaw = p['message_keys'];
  const messageKeys: string[] = [];
  if (keysRaw !== undefined) {
    if (
      !Array.isArray(keysRaw) ||
      keysRaw.some((k) => typeof k !== 'string' || !MESSAGE_KEY_RE.test(k))
    ) {
      bad('MESSAGE_KEYS_INVALID');
    }
    messageKeys.push(...(keysRaw as string[]));
  }
  return { formId: id, jsonSchema: schema, uiSchema: ui, messageKeys };
}
