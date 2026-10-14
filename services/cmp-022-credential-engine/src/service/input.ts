import { isErrorCode, isOpaqueRef } from '../domain/charset.js';
import {
  DOWNSTREAM_CHANNELS,
  type DownstreamChannel,
  type DownstreamResult,
} from '../domain/outcome.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp022Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'issued_at',
  'signed_at',
  'generated_at',
  'recorded_at',
  'as_of',
]);

/**
 * Fields a client could use to dictate issuance provenance. Pins, approval, artifacts, signing
 * and registry status are platform-derived from governed ports, never from the request.
 */
export const CLIENT_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  'tenant_id',
  'credential_id',
  'approval_decision_ref',
  'approval_decision_by_this_component',
  'approved',
  'decision',
  'lifecycle_status',
  'version_pins',
  'template_pin',
  'tenant_service_binding_id',
  'service_version_id',
  'credential_template_id',
  'credential_template_version',
  'artifacts',
  'storage_key',
  'sha256',
  'signing_record_id',
  'signature_ref',
  'signed_artifact_sha256',
  'connector_binding_id',
  'connector_mode',
  'simulation_marker',
  'registry_status',
  'current_status',
  'registry_status_owner_cmp',
  'issuance_reversible_by_publish_failure',
  'issuance_reversible_by_notification_failure',
]);

export interface IssueInput {
  application_id: string;
  issuance_key: string;
}

export interface OutcomeInput {
  channel: DownstreamChannel;
  outcome: DownstreamResult;
  outcome_ref: string;
  failure_code: string | null;
}

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp022Error('SF-SYS-003', detail(code, pointer));
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp022Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function onlyKeys(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  for (const key of Object.keys(rec)) {
    if (CLIENT_AUTHORITY_KEYS.has(key)) bad(`/${key}`, 'CLIENT_AUTHORITY_FORBIDDEN');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

export function validateIssueInput(body: unknown): IssueInput {
  const rec = asRecord(body);
  onlyKeys(rec, ['application_id', 'issuance_key']);
  const applicationId = rec['application_id'];
  if (typeof applicationId !== 'string' || !isUuid(applicationId)) {
    bad('/application_id', 'UUID_REQUIRED');
  }
  const issuanceKey = rec['issuance_key'];
  if (!isOpaqueRef(issuanceKey, 8, 128)) bad('/issuance_key', 'ISSUANCE_KEY_INVALID');
  return { application_id: applicationId, issuance_key: issuanceKey };
}

export function validateOutcomeInput(body: unknown): OutcomeInput {
  const rec = asRecord(body);
  onlyKeys(rec, ['channel', 'outcome', 'outcome_ref', 'failure_code']);
  const channel = rec['channel'];
  if (
    typeof channel !== 'string' ||
    !(DOWNSTREAM_CHANNELS as readonly string[]).includes(channel)
  ) {
    bad('/channel', 'CHANNEL_INVALID');
  }
  const outcome = rec['outcome'];
  if (outcome !== 'SUCCEEDED' && outcome !== 'FAILED') bad('/outcome', 'OUTCOME_INVALID');
  const ref = rec['outcome_ref'];
  if (!isOpaqueRef(ref, 1, 128)) bad('/outcome_ref', 'OUTCOME_REF_INVALID');
  const failure = rec['failure_code'];
  if (outcome === 'FAILED') {
    if (!isErrorCode(failure)) bad('/failure_code', 'FAILURE_CODE_REQUIRED');
  } else if (failure !== undefined) {
    bad('/failure_code', 'FAILURE_CODE_FORBIDDEN');
  }
  return {
    channel: channel as DownstreamChannel,
    outcome,
    outcome_ref: ref,
    failure_code: outcome === 'FAILED' ? (failure as string) : null,
  };
}

export function validateEmptyInput(body: unknown): void {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  if (Object.keys(rec).length > 0) bad(`/${Object.keys(rec)[0] as string}`, 'UNKNOWN_FIELD');
}
