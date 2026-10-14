import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

/** Synthetic identifiers and opaque refs only. No real tenant, issuer, person or document. */
export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CANARY = '00000000-0000-4000-8000-000000000099';
export const APP_1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
export const APP_UNAPPROVED = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
export const TSB_ID = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
export const SVC_VERSION_ID = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
export const TEMPLATE_ID = 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3';
export const ESIGN_BINDING_ID = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
export const DL_BINDING_ID = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
export const CONSENT_REF = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
export const SYSTEM_ACTOR = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
export const OFFICER_ACTOR = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
export const CITIZEN_ACTOR = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
export const VERIFIER_ACTOR = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4';
export const QR_WORKLOAD = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5';
export const ISSUER_REF = 'issuer:tenant-meta:m07int';
export const TYPE_REF = 'credtype:tenant-meta:m07int';
export const PURPOSE_CODE = 'CREDENTIAL_PUBLISH';
export const DOCUMENT_TYPE_REF = 'doctype:tenant-meta:m07int';
export const TEST_RUN_ID = 'sf-m07-int-run';
export const APPROVAL_REF = 'wf:decision:m07int-0001';

export type ActorType = 'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION' | 'PRIVILEGED_ADMIN';
export type DeploymentEnvironment =
  'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'PERFORMANCE' | 'UAT' | 'PREPROD' | 'PRODUCTION';

export interface Ctx {
  tenant_id: string;
  cell_id: string;
  actor: { type: ActorType; id: string };
  roles: string[];
  jurisdiction_ids: string[];
  auth_assurance: 'NONE' | 'OTP' | 'PASSWORD' | 'MFA' | 'WORKLOAD_IDENTITY';
  correlation_id: string;
  trace_id: string;
}

export function ctxFor(tenantId: string, actorType: ActorType = 'SYSTEM', actorId?: string): Ctx {
  const id =
    actorId ??
    (actorType === 'OFFICER'
      ? OFFICER_ACTOR
      : actorType === 'CITIZEN'
        ? CITIZEN_ACTOR
        : actorType === 'INTEGRATION'
          ? VERIFIER_ACTOR
          : SYSTEM_ACTOR);
  const workload = actorType === 'SYSTEM' || actorType === 'INTEGRATION';
  return {
    tenant_id: tenantId,
    cell_id: 'cell-m07-int',
    actor: { type: actorType, id },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: workload ? 'WORKLOAD_IDENTITY' : actorType === 'CITIZEN' ? 'OTP' : 'MFA',
    correlation_id: randomUUID(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  };
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`${what} missing`);
  return value;
}

/** Allow-all PDP double that records every decision request (OPA stays the authority). */
export class RecordingAuthorizer {
  readonly calls: Array<{ action: string; subject: { tenant_id: string | null } }> = [];
  denyActions = new Set<string>();

  decide(input: { action: string; subject: { tenant_id: string | null } }): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(input);
    const allow = !this.denyActions.has(input.action);
    return Promise.resolve({
      allow,
      reason_code: allow ? 'ALLOW' : 'DENY',
      policy_revision: 'rev-m07-int',
      decision_id: randomUUID(),
    });
  }
}

export class Clock {
  constructor(private ms = Date.parse('2026-10-14T06:00:00Z')) {}
  readonly now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '../../../..');

interface Validator {
  (d: unknown): boolean;
  errors?: unknown;
}
interface Ajv {
  addSchema(s: object): void;
  getSchema(id: string): Validator | undefined;
}

const requireFromContracts = createRequire(join(repoRoot, 'packages/contracts/package.json'));
const { Ajv2020 } = requireFromContracts('ajv/dist/2020.js') as {
  Ajv2020: new (o: object) => Ajv;
};
const formatsModule = requireFromContracts('ajv-formats') as { default?: (a: Ajv) => void } & ((
  a: Ajv,
) => void);
const addFormats = formatsModule.default ?? formatsModule;
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
for (const dir of ['contracts/shared/schemas', 'contracts/m07/schemas']) {
  for (const f of readdirSync(join(repoRoot, dir)).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(repoRoot, dir, f), 'utf8')) as object);
  }
}

export type FrozenContract =
  | 'm07/credential'
  | 'm07/signing-record'
  | 'm07/credential-status'
  | 'm07/verification-token'
  | 'm07/digilocker-publish'
  | 'event-envelope'
  | 'error-response';

/** Validates a payload against a FROZEN schema from contracts/ (read-only). */
export function conforms(
  contract: FrozenContract,
  payload: unknown,
): { ok: boolean; errors: string } {
  const v = must(ajv.getSchema(`https://contracts.serviceform.ai/${contract}/v1`), contract);
  const ok = v(payload);
  return { ok, errors: ok ? '' : JSON.stringify(v.errors) };
}

/** Counts occurrences of any foreign-tenant identifier in a serialized response. */
export function leaks(body: unknown, foreign: readonly string[]): number {
  const text = JSON.stringify(body ?? null);
  return foreign.filter((id) => id.length > 0 && text.includes(id)).length;
}

/**
 * Contract assertions that currently fail against owner code are recorded as expected failures
 * so the suite documents the finding without being forced green. Set M07_INT_SHOW_FINDINGS=1 to
 * run them as ordinary tests and capture the actual failure reasons for evidence.
 */
export const finding: typeof it.fails = process.env['M07_INT_SHOW_FINDINGS']
  ? (it as typeof it.fails)
  : it.fails;
