import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { SCHEMAS } from './schemas.js';

// ajv-formats ships CommonJS; under NodeNext the callable is on .default.
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

export const SCHEMA_BASE = 'https://contracts.serviceform.ai';

/** Contract name -> schema $id (plus JSON pointer for contracts defined under $defs). */
export const CONTRACTS = {
  'request-context': `${SCHEMA_BASE}/request-context/v1`,
  'event-envelope': `${SCHEMA_BASE}/event-envelope/v1`,
  'error-response': `${SCHEMA_BASE}/error-response/v1`,
  'idempotency-record': `${SCHEMA_BASE}/idempotency-record/v1`,
  'audit-event': `${SCHEMA_BASE}/audit-event/v1`,
  'authz-decision-input': `${SCHEMA_BASE}/authz-decision/v1#/$defs/input`,
  'authz-decision-output': `${SCHEMA_BASE}/authz-decision/v1#/$defs/output`,
  'connector-binding': `${SCHEMA_BASE}/connector-binding/v1`,
  'simulation-marker': `${SCHEMA_BASE}/simulation-marker/v1`,
  'isolation-declaration': `${SCHEMA_BASE}/isolation-declaration/v1`,
} as const;

export type ContractName = keyof typeof CONTRACTS;

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const schema of SCHEMAS) ajv.addSchema(schema);
  return ajv;
}

let shared: Ajv2020 | undefined;
const compiled = new Map<ContractName, ValidateFunction>();

export function validatorFor(name: ContractName): ValidateFunction {
  let fn = compiled.get(name);
  if (!fn) {
    shared ??= createAjv();
    fn = shared.getSchema(CONTRACTS[name]);
    if (!fn) throw new Error(`Unknown contract schema: ${name}`);
    compiled.set(name, fn);
  }
  return fn;
}

export function validate(name: ContractName, value: unknown): ValidationResult {
  const fn = validatorFor(name);
  const valid = fn(value) as boolean;
  return { valid, errors: valid ? [] : [...(fn.errors ?? [])] };
}
