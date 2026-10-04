import { Cmp039Error } from '../errors.js';
import { isDataClassification, type DataClassification } from '../domain/classification.js';
import type { ModelPin } from '../ports/provider.js';

export type Operation = 'INVOKE' | 'EMBED';

export interface RequestedTool {
  tool_id: string;
  version: string;
  scopes: string[];
}

export interface RequestedSource {
  source_id: string;
  tenant_id: string;
}

export interface GatewayRequest {
  operation: Operation;
  policyId: string;
  policyVersion: number;
  purpose: string;
  classification: DataClassification;
  variables: Record<string, string>;
  inputs: string[];
  model: ModelPin | undefined;
  tools: RequestedTool[];
  sources: RequestedSource[];
  callerComponent: string | undefined;
}

export const POLICY_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const MODEL_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const FLOATING_VERSIONS = ['latest', 'default', 'stable', 'current'] as const;
export const TOOL_ID_RE = /^[a-z][a-z0-9_.-]{1,63}$/;
const VERSION_PART_RE = /^[0-9]{1,4}$/;

export function isToolVersion(value: string): boolean {
  const parts = value.split('.');
  return parts.length >= 1 && parts.length <= 3 && parts.every((p) => VERSION_PART_RE.test(p));
}
export const SCOPE_RE = /^[a-z][a-z0-9_:.-]{1,63}$/;
export const SOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const VARIABLE_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const COMPONENT_RE = /^CMP-0[0-9]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FIELD_CHARS = 20_000;
const MAX_INPUTS = 16;

function bad(code: string): Cmp039Error {
  return new Cmp039Error('SF-SYS-003', { details: [{ code }] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw bad(code);
  }
}

export function parseModelPin(raw: unknown): ModelPin {
  if (!isRecord(raw)) throw bad('MODEL_PIN_INVALID');
  assertKeys(raw, ['provider_id', 'model_id', 'model_version'], 'MODEL_PIN_INVALID');
  const { provider_id, model_id, model_version } = raw;
  if (
    typeof provider_id !== 'string' ||
    typeof model_id !== 'string' ||
    typeof model_version !== 'string' ||
    !PROVIDER_ID_RE.test(provider_id) ||
    !MODEL_ID_RE.test(model_id) ||
    !MODEL_VERSION_RE.test(model_version) ||
    (FLOATING_VERSIONS as readonly string[]).includes(model_version.toLowerCase())
  ) {
    throw bad('MODEL_PIN_INVALID');
  }
  return { provider_id, model_id, model_version };
}

function parseTools(raw: unknown): RequestedTool[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 8) throw bad('TOOLS_INVALID');
  return raw.map((item) => {
    if (!isRecord(item)) throw bad('TOOLS_INVALID');
    assertKeys(item, ['tool_id', 'version', 'scopes'], 'TOOLS_INVALID');
    const { tool_id, version, scopes } = item;
    if (
      typeof tool_id !== 'string' ||
      typeof version !== 'string' ||
      !TOOL_ID_RE.test(tool_id) ||
      !isToolVersion(version)
    ) {
      throw bad('TOOLS_INVALID');
    }
    const list = scopes === undefined ? [] : scopes;
    if (!Array.isArray(list) || list.length > 8) throw bad('TOOLS_INVALID');
    for (const s of list) {
      if (typeof s !== 'string' || !SCOPE_RE.test(s)) throw bad('TOOLS_INVALID');
    }
    return { tool_id, version, scopes: list as string[] };
  });
}

function parseSources(raw: unknown): RequestedSource[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 16) throw bad('SOURCES_INVALID');
  return raw.map((item) => {
    if (!isRecord(item)) throw bad('SOURCES_INVALID');
    assertKeys(item, ['source_id', 'tenant_id'], 'SOURCES_INVALID');
    const { source_id, tenant_id } = item;
    if (
      typeof source_id !== 'string' ||
      typeof tenant_id !== 'string' ||
      !SOURCE_ID_RE.test(source_id) ||
      !UUID_RE.test(tenant_id)
    ) {
      throw bad('SOURCES_INVALID');
    }
    return { source_id, tenant_id };
  });
}

const COMMON_KEYS = [
  'policy_id',
  'policy_version',
  'purpose',
  'data_classification',
  'model',
  'sources',
  'caller_component',
] as const;

export function parseGatewayRequest(operation: Operation, body: unknown): GatewayRequest {
  if (!isRecord(body)) throw bad('BODY_REQUIRED');
  assertKeys(
    body,
    operation === 'INVOKE' ? [...COMMON_KEYS, 'variables', 'tools'] : [...COMMON_KEYS, 'inputs'],
    'UNKNOWN_FIELD',
  );
  const { policy_id, policy_version, purpose, data_classification } = body;
  if (typeof policy_id !== 'string' || !POLICY_ID_RE.test(policy_id))
    throw bad('POLICY_ID_INVALID');
  if (
    typeof policy_version !== 'number' ||
    !Number.isInteger(policy_version) ||
    policy_version < 1
  ) {
    throw bad('POLICY_VERSION_INVALID');
  }
  if (typeof purpose !== 'string' || purpose.length < 1 || purpose.length > 200) {
    throw bad('PURPOSE_REQUIRED');
  }
  if (!isDataClassification(data_classification)) throw bad('DATA_CLASSIFICATION_REQUIRED');
  const caller = body['caller_component'];
  if (caller !== undefined && (typeof caller !== 'string' || !COMPONENT_RE.test(caller))) {
    throw bad('CALLER_COMPONENT_INVALID');
  }

  const variables: Record<string, string> = {};
  let inputs: string[] = [];
  if (operation === 'INVOKE') {
    const raw = body['variables'] ?? {};
    if (!isRecord(raw)) throw bad('VARIABLES_INVALID');
    for (const [name, value] of Object.entries(raw)) {
      if (
        !VARIABLE_NAME_RE.test(name) ||
        typeof value !== 'string' ||
        value.length > MAX_FIELD_CHARS
      ) {
        throw bad('VARIABLES_INVALID');
      }
      variables[name] = value;
    }
  } else {
    const raw = body['inputs'];
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_INPUTS)
      throw bad('INPUTS_INVALID');
    for (const v of raw) {
      if (typeof v !== 'string' || v.length < 1 || v.length > MAX_FIELD_CHARS)
        throw bad('INPUTS_INVALID');
    }
    inputs = raw as string[];
  }

  return {
    operation,
    policyId: policy_id,
    policyVersion: policy_version,
    purpose,
    classification: data_classification,
    variables,
    inputs,
    model: body['model'] === undefined ? undefined : parseModelPin(body['model']),
    tools: operation === 'INVOKE' ? parseTools(body['tools']) : [],
    sources: parseSources(body['sources']),
    callerComponent: caller,
  };
}
