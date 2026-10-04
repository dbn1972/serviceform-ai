import { Cmp009Error } from '../errors.js';

const FORBIDDEN_SCHEMA_KEYS = new Set([
  '$ref',
  '$dynamicRef',
  'patternProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentMediaType',
  'contentEncoding',
]);

const ALLOWED_FORMATS = new Set(['date', 'date-time', 'email', 'uuid']);
const ALLOWED_TYPES = new Set([
  'object',
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'null',
]);
const MAX_DEPTH = 12;

export interface JsonSchemaNode {
  type?: string;
  format?: string;
  enum?: readonly unknown[];
  const?: unknown;
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  if?: JsonSchemaNode;
  then?: JsonSchemaNode;
  else?: JsonSchemaNode;
}

function schemaFail(code: string): never {
  throw new Cmp009Error('SF-FORM-002', { statusCode: 422, details: [{ code }] });
}

export function parseJsonSchema(raw: unknown, depth = 0): JsonSchemaNode {
  if (depth > MAX_DEPTH) schemaFail('SCHEMA_TOO_DEEP');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    schemaFail('SCHEMA_NOT_OBJECT');
  const node = raw as Record<string, unknown>;
  for (const key of Object.keys(node)) {
    if (FORBIDDEN_SCHEMA_KEYS.has(key)) schemaFail('SCHEMA_KEYWORD_FORBIDDEN');
  }
  if (node['type'] !== undefined) {
    if (typeof node['type'] !== 'string' || !ALLOWED_TYPES.has(node['type'])) {
      schemaFail('SCHEMA_TYPE_UNSUPPORTED');
    }
  }
  if (node['format'] !== undefined) {
    if (typeof node['format'] !== 'string' || !ALLOWED_FORMATS.has(node['format'])) {
      schemaFail('SCHEMA_FORMAT_UNSUPPORTED');
    }
  }
  if (node['enum'] !== undefined && !Array.isArray(node['enum'])) schemaFail('SCHEMA_ENUM_INVALID');
  if (node['required'] !== undefined) {
    if (!Array.isArray(node['required']) || node['required'].some((k) => typeof k !== 'string')) {
      schemaFail('SCHEMA_REQUIRED_INVALID');
    }
  }
  if (
    node['additionalProperties'] !== undefined &&
    typeof node['additionalProperties'] !== 'boolean'
  ) {
    schemaFail('SCHEMA_ADDITIONAL_PROPERTIES_INVALID');
  }
  const properties = node['properties'];
  const parsedProps: Record<string, JsonSchemaNode> = {};
  if (properties !== undefined) {
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      schemaFail('SCHEMA_PROPERTIES_INVALID');
    }
    for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) schemaFail('SCHEMA_PROPERTY_NAME_INVALID');
      parsedProps[name] = parseJsonSchema(child, depth + 1);
    }
  }
  const out: JsonSchemaNode = {};
  if (typeof node['type'] === 'string') out.type = node['type'];
  if (typeof node['format'] === 'string') out.format = node['format'];
  if (Array.isArray(node['enum'])) out.enum = node['enum'];
  if ('const' in node) out.const = node['const'];
  if (typeof node['title'] === 'string') out.title = node['title'];
  if (typeof node['description'] === 'string') out.description = node['description'];
  if (typeof node['minLength'] === 'number') out.minLength = node['minLength'];
  if (typeof node['maxLength'] === 'number') out.maxLength = node['maxLength'];
  if (typeof node['minimum'] === 'number') out.minimum = node['minimum'];
  if (typeof node['maximum'] === 'number') out.maximum = node['maximum'];
  if (typeof node['minItems'] === 'number') out.minItems = node['minItems'];
  if (typeof node['maxItems'] === 'number') out.maxItems = node['maxItems'];
  if (Object.keys(parsedProps).length > 0) out.properties = parsedProps;
  if (Array.isArray(node['required'])) out.required = node['required'] as string[];
  if (typeof node['additionalProperties'] === 'boolean') {
    out.additionalProperties = node['additionalProperties'];
  }
  if (node['items'] !== undefined) out.items = parseJsonSchema(node['items'], depth + 1);
  if (node['if'] !== undefined) out.if = parseJsonSchema(node['if'], depth + 1);
  if (node['then'] !== undefined) out.then = parseJsonSchema(node['then'], depth + 1);
  if (node['else'] !== undefined) out.else = parseJsonSchema(node['else'], depth + 1);
  return out;
}

export function assertRootObjectSchema(schema: JsonSchemaNode): void {
  if (schema.type !== 'object' || !schema.properties) schemaFail('SCHEMA_ROOT_NOT_OBJECT');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SchemaIssue {
  code: string;
  pointer: string;
}

function matchesConst(schema: JsonSchemaNode, data: unknown): boolean {
  if (schema.const !== undefined) return Object.is(schema.const, data) || schema.const === data;
  if (schema.enum) return schema.enum.some((v) => v === data);
  if (schema.properties) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
    const rec = data as Record<string, unknown>;
    return Object.entries(schema.properties).every(([k, child]) => matchesConst(child, rec[k]));
  }
  return true;
}

export function validateAgainstSchema(
  schema: JsonSchemaNode,
  data: unknown,
  pointer = '',
  hidden = new Set<string>(),
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (schema.if) {
    const matched = matchesConst(schema.if, data);
    const branch = matched ? schema.then : schema.else;
    if (branch) issues.push(...validateAgainstSchema(branch, data, pointer, hidden));
  }
  if (schema.const !== undefined && schema.const !== data) {
    issues.push({ code: 'CONST_MISMATCH', pointer: pointer || '/' });
  }
  if (schema.enum && !schema.enum.includes(data)) {
    issues.push({ code: 'ENUM_MISMATCH', pointer: pointer || '/' });
  }
  if (schema.type === 'string') {
    if (typeof data !== 'string') {
      issues.push({ code: 'TYPE_STRING', pointer: pointer || '/' });
      return issues;
    }
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      issues.push({ code: 'MIN_LENGTH', pointer: pointer || '/' });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      issues.push({ code: 'MAX_LENGTH', pointer: pointer || '/' });
    }
    if (schema.format === 'date' && !DATE_RE.test(data)) {
      issues.push({ code: 'FORMAT_DATE', pointer: pointer || '/' });
    }
    if (schema.format === 'email' && !EMAIL_RE.test(data)) {
      issues.push({ code: 'FORMAT_EMAIL', pointer: pointer || '/' });
    }
    if (schema.format === 'uuid' && !UUID_RE.test(data)) {
      issues.push({ code: 'FORMAT_UUID', pointer: pointer || '/' });
    }
    return issues;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof data !== 'number' || !Number.isFinite(data)) {
      issues.push({ code: 'TYPE_NUMBER', pointer: pointer || '/' });
      return issues;
    }
    if (schema.type === 'integer' && !Number.isInteger(data)) {
      issues.push({ code: 'TYPE_INTEGER', pointer: pointer || '/' });
    }
    if (schema.minimum !== undefined && data < schema.minimum) {
      issues.push({ code: 'MINIMUM', pointer: pointer || '/' });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      issues.push({ code: 'MAXIMUM', pointer: pointer || '/' });
    }
    return issues;
  }
  if (schema.type === 'boolean') {
    if (typeof data !== 'boolean') issues.push({ code: 'TYPE_BOOLEAN', pointer: pointer || '/' });
    return issues;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      issues.push({ code: 'TYPE_ARRAY', pointer: pointer || '/' });
      return issues;
    }
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      issues.push({ code: 'MIN_ITEMS', pointer: pointer || '/' });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      issues.push({ code: 'MAX_ITEMS', pointer: pointer || '/' });
    }
    if (schema.items) {
      data.forEach((item, i) => {
        issues.push(
          ...validateAgainstSchema(schema.items as JsonSchemaNode, item, `${pointer}/${i}`, hidden),
        );
      });
    }
    return issues;
  }
  if (schema.type === 'object' || schema.properties || schema.required) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      issues.push({ code: 'TYPE_OBJECT', pointer: pointer || '/' });
      return issues;
    }
    const rec = data as Record<string, unknown>;
    const required = schema.required ?? [];
    for (const name of required) {
      const childPtr = `${pointer}/${name}`;
      if (hidden.has(childPtr) || hidden.has(`/${name}`)) continue;
      if (rec[name] === undefined) issues.push({ code: 'REQUIRED', pointer: childPtr });
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const name of Object.keys(rec)) {
        if (!allowed.has(name))
          issues.push({ code: 'ADDITIONAL_PROPERTY', pointer: `${pointer}/${name}` });
      }
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (rec[name] === undefined) continue;
      issues.push(...validateAgainstSchema(child, rec[name], `${pointer}/${name}`, hidden));
    }
  }
  return issues;
}
