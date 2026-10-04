import { randomUUID } from 'node:crypto';
import { validate, type RequestContext, type SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { withContextTx } from '../db/tx.js';
import { canonicalJson, isUuid, sha256Fingerprint, sha256Of } from '../domain/canonical.js';
import { assertBindingSafe } from '../domain/connector-guard.js';
import {
  ASSURANCE_LEVELS,
  EVIDENCE_SOURCES,
  parsePolicyDefinition,
  type EvidencePolicyDefinition,
  type Scalar,
} from '../domain/policy.js';
import { resolveRequirements, type HeldEvidence } from '../domain/resolver.js';
import { assertNoOpenTransaction } from '../domain/txn-guard.js';
import { Cmp011Error, mapPgError } from '../errors.js';
import {
  getPublishedPolicyByVersionRef,
  getResolution,
  insertResolution,
  type PolicyRow,
  type ResolutionRow,
} from '../repo/evidence-repo.js';
import type { EvidenceDeps } from './deps.js';

const KEY_RE = /^[a-z][a-z0-9._-]{0,127}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PURPOSE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SCENARIO_RE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_FACTS = 200;
const MAX_HELD = 500;

export interface CalculateBody {
  binding_id: string;
  facts: Record<string, Scalar>;
  rule_outcomes: Record<string, Scalar>;
  subject_id?: string;
  application_ref?: string;
  include_uploaded: boolean;
  digilocker?: { purpose_code: string; scenario: string; test_run_id: string };
}

function bad(code: string, pointer?: string): never {
  throw new Cmp011Error('SF-SYS-003', { details: [{ code, ...(pointer ? { pointer } : {}) }] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScalarMap(raw: unknown, pointer: string): Record<string, Scalar> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) bad('SCALAR_MAP_INVALID', pointer);
  const keys = Object.keys(raw);
  if (keys.length > MAX_FACTS) bad('SCALAR_MAP_TOO_LARGE', pointer);
  const entries = new Map<string, Scalar>();
  for (const key of keys) {
    const value = raw[key];
    const ok =
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 256);
    if (!KEY_RE.test(key) || !ok) bad('SCALAR_MAP_INVALID', `${pointer}/${key}`);
    entries.set(key, value as Scalar);
  }
  return Object.fromEntries(entries);
}

export function parseCalculateBody(raw: unknown): CalculateBody {
  if (!isRecord(raw)) bad('BODY_REQUIRED');
  const allowed = [
    'binding_id',
    'facts',
    'rule_outcomes',
    'subject_id',
    'application_ref',
    'include_uploaded',
    'digilocker',
  ];
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) bad('UNKNOWN_FIELD', `/${key}`);
  if (typeof raw['binding_id'] !== 'string' || !isUuid(raw['binding_id']))
    bad('BINDING_ID', '/binding_id');
  const body: CalculateBody = {
    binding_id: raw['binding_id'],
    facts: parseScalarMap(raw['facts'], '/facts'),
    rule_outcomes: parseScalarMap(raw['rule_outcomes'], '/rule_outcomes'),
    include_uploaded: raw['include_uploaded'] === true,
  };
  if (raw['include_uploaded'] !== undefined && typeof raw['include_uploaded'] !== 'boolean') {
    bad('INCLUDE_UPLOADED', '/include_uploaded');
  }
  if (raw['subject_id'] !== undefined) {
    if (typeof raw['subject_id'] !== 'string' || !isUuid(raw['subject_id']))
      bad('SUBJECT_ID', '/subject_id');
    body.subject_id = raw['subject_id'];
  }
  if (raw['application_ref'] !== undefined) {
    if (typeof raw['application_ref'] !== 'string' || !REF_RE.test(raw['application_ref'])) {
      bad('APPLICATION_REF', '/application_ref');
    }
    body.application_ref = raw['application_ref'];
  }
  const dl = raw['digilocker'];
  if (dl !== undefined) {
    if (!isRecord(dl)) bad('DIGILOCKER_INVALID', '/digilocker');
    for (const key of Object.keys(dl)) {
      if (!['purpose_code', 'scenario', 'test_run_id'].includes(key))
        bad('UNKNOWN_FIELD', `/digilocker/${key}`);
    }
    const { purpose_code: purpose, scenario, test_run_id: testRun } = dl;
    if (typeof purpose !== 'string' || !PURPOSE_RE.test(purpose))
      bad('PURPOSE_CODE', '/digilocker/purpose_code');
    if (typeof scenario !== 'string' || !SCENARIO_RE.test(scenario))
      bad('SCENARIO', '/digilocker/scenario');
    if (typeof testRun !== 'string' || testRun.length < 1 || testRun.length > 128) {
      bad('TEST_RUN_ID', '/digilocker/test_run_id');
    }
    body.digilocker = { purpose_code: purpose, scenario, test_run_id: testRun };
  }
  return body;
}

export function calculateFingerprint(body: CalculateBody): string {
  return sha256Fingerprint(['POST /evidence-requirements/calculate', canonicalJson(body)]);
}

async function portCall<T>(code: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Cmp011Error) throw err;
    throw new Cmp011Error('SF-SYS-004', { details: [{ code }], cause: err });
  }
}

function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp011Error('SF-TEN-001');
  return ctx.tenant_id;
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

/** Port output is untrusted input: anything malformed is dropped, never coerced into evidence. */
export function normalizeHeld(
  raw: readonly {
    evidence_ref?: unknown;
    evidence_type_code?: unknown;
    source?: unknown;
    verification?: unknown;
    scope?: unknown;
    assurance?: unknown;
    issued_at?: unknown;
    expires_at?: unknown;
  }[],
  knownTypes: ReadonlySet<string>,
): HeldEvidence[] {
  const out: HeldEvidence[] = [];
  for (const item of raw.slice(0, MAX_HELD)) {
    if (typeof item.evidence_ref !== 'string' || !REF_RE.test(item.evidence_ref)) continue;
    if (typeof item.evidence_type_code !== 'string' || !knownTypes.has(item.evidence_type_code))
      continue;
    if (!(EVIDENCE_SOURCES as readonly unknown[]).includes(item.source)) continue;
    if (!['VERIFIED', 'UNVERIFIED', 'ADVISORY'].includes(item.verification as string)) continue;
    if (item.scope !== 'APPLICATION' && item.scope !== 'PROFILE') continue;
    const held: HeldEvidence = {
      evidence_ref: item.evidence_ref,
      evidence_type_code: item.evidence_type_code,
      source: item.source as HeldEvidence['source'],
      verification: item.verification as HeldEvidence['verification'],
      scope: item.scope,
    };
    if ((ASSURANCE_LEVELS as readonly unknown[]).includes(item.assurance)) {
      held.assurance = item.assurance as HeldEvidence['assurance'] & string;
    }
    const issued = iso(item.issued_at);
    if (issued) held.issued_at = issued;
    if (item.expires_at !== undefined) held.expires_at = iso(item.expires_at) ?? 'invalid';
    out.push(held);
  }
  return out;
}

async function loadPolicy(
  deps: EvidenceDeps,
  ctx: RequestContext,
  body: CalculateBody,
): Promise<{ row: PolicyRow; definition: EvidencePolicyDefinition }> {
  const tenantId = tenantOf(ctx);
  const pin = await portCall('BINDING_PORT_UNAVAILABLE', () =>
    deps.bindingPins.resolveEvidencePin({ tenant_id: tenantId, binding_id: body.binding_id }),
  );
  if (!pin) throw new Cmp011Error('SF-APP-001', { statusCode: 404 });
  if (pin.binding_status === 'DRAFT') bad('BINDING_NOT_PUBLISHED');
  const row = await withContextTx(deps.pool, ctx, (client) =>
    getPublishedPolicyByVersionRef(client, tenantId, pin.version_ref),
  );
  if (!row) {
    throw new Cmp011Error('SF-APP-001', {
      statusCode: 404,
      details: [{ code: 'EVIDENCE_POLICY_VERSION_NOT_FOUND' }],
    });
  }
  if (row.content_hash !== pin.content_hash) bad('PIN_HASH_MISMATCH');
  const definition = parsePolicyDefinition(row.definition);
  if (sha256Of(definition) !== row.content_hash) bad('POLICY_HASH_MISMATCH');
  return { row, definition };
}

interface ExternalEvidence {
  held: HeldEvidence[];
  availability: Record<string, boolean>;
  digilocker?: { status: 'OK' | 'UNAVAILABLE'; simulation?: SimulationMarker };
}

async function gatherExternal(
  deps: EvidenceDeps,
  ctx: RequestContext,
  body: CalculateBody,
  definition: EvidencePolicyDefinition,
): Promise<ExternalEvidence> {
  assertNoOpenTransaction();
  const tenantId = tenantOf(ctx);
  const knownTypes = new Set(definition.evidence_types.map((t) => t.code));
  const result: ExternalEvidence = { held: [], availability: {} };

  if (body.include_uploaded) {
    if (!body.subject_id) bad('SUBJECT_ID_REQUIRED', '/subject_id');
    const subjectId = body.subject_id;
    const uploaded = await portCall('UPLOAD_PORT_UNAVAILABLE', () =>
      deps.uploads.listEvidence({
        tenant_id: tenantId,
        subject_id: subjectId,
        ...(body.application_ref ? { application_ref: body.application_ref } : {}),
      }),
    );
    for (const doc of uploaded) {
      if (doc.evidence_type_code === null) {
        const classifier = deps.classification;
        const suggestion = classifier
          ? await portCall('OCR_PORT_UNAVAILABLE', () =>
              classifier.suggest({ tenant_id: tenantId, evidence_ref: doc.evidence_ref }),
            )
          : null;
        if (suggestion) {
          result.held.push(
            ...normalizeHeld(
              [
                {
                  ...doc,
                  evidence_type_code: suggestion.evidence_type_code,
                  verification: 'ADVISORY',
                },
              ],
              knownTypes,
            ),
          );
        }
      } else {
        result.held.push(...normalizeHeld([doc], knownTypes));
      }
    }
  }

  if (body.digilocker) {
    const binding = deps.digiLockerBinding;
    if (!deps.digiLocker || !binding || deps.config.digiLockerMode !== 'SIMULATED') {
      bad('DIGILOCKER_NOT_CONFIGURED');
    }
    assertBindingSafe(binding, deps.config.environment, tenantId);
    if (!body.subject_id) bad('SUBJECT_ID_REQUIRED', '/subject_id');
    if (!deps.consent) bad('CONSENT_PORT_REQUIRED');
    const consentPort = deps.consent;
    const subjectId = body.subject_id;
    const purposeCode = body.digilocker.purpose_code;
    const consent = await portCall('CONSENT_PORT_UNAVAILABLE', () =>
      consentPort.check({
        tenant_id: tenantId,
        subject_id: subjectId,
        purpose_code: purposeCode,
        correlation_id: ctx.correlation_id,
      }),
    );
    if (!consent.allowed) {
      throw new Cmp011Error('SF-AUTH-002', { details: [{ code: 'CONSENT_REQUIRED' }] });
    }
    const refToType = new Map<string, string[]>();
    for (const type of definition.evidence_types) {
      for (const source of type.sources) {
        if (source.source === 'DIGILOCKER' && source.document_type_ref) {
          refToType.set(source.document_type_ref, [
            ...(refToType.get(source.document_type_ref) ?? []),
            type.code,
          ]);
        }
      }
    }
    try {
      const fetched = await deps.digiLocker.lookupDocuments({
        subject_id: body.subject_id,
        document_type_refs: [...refToType.keys()].sort(),
        scenario: body.digilocker.scenario,
        test_run_id: body.digilocker.test_run_id,
      });
      const marker = fetched.simulation;
      if (
        !validate('simulation-marker', marker).valid ||
        marker.connector_binding_id !== binding.connector_binding_id
      ) {
        bad('SIMULATION_MARKER_REQUIRED');
      }
      const availability = new Map<string, boolean>();
      for (const typeCodes of refToType.values()) {
        for (const code of typeCodes) availability.set(code, false);
      }
      for (const doc of fetched.documents) {
        for (const code of refToType.get(doc.document_type_ref) ?? []) {
          availability.set(code, true);
          result.held.push(
            ...normalizeHeld(
              [
                {
                  evidence_ref: doc.evidence_ref,
                  evidence_type_code: code,
                  source: 'DIGILOCKER',
                  verification: 'VERIFIED',
                  scope: 'APPLICATION',
                  assurance: doc.assurance,
                  issued_at: doc.issued_at,
                  expires_at: doc.expires_at,
                },
              ],
              knownTypes,
            ),
          );
        }
      }
      result.availability = Object.fromEntries(availability);
      result.digilocker = { status: 'OK', simulation: marker };
    } catch (err) {
      if (!(err instanceof Cmp011Error) || err.code === 'SF-SYS-004') {
        result.digilocker = { status: 'UNAVAILABLE' };
      } else {
        throw err;
      }
    }
  }
  return result;
}

export function resolutionPublic(
  row: ResolutionRow,
  extras: { digilocker?: ExternalEvidence['digilocker'] } = {},
) {
  return {
    resolution_id: row.resolution_id,
    binding_id: row.binding_id,
    application_ref: row.application_ref,
    evidence_policy_version: {
      policy_id: row.policy_id,
      version_ref: row.version_ref,
      content_hash: row.policy_content_hash,
    },
    input_hash: row.input_hash,
    decision_hash: row.decision_hash,
    simulated: row.simulated,
    checklist: row.checklist,
    decision_trace: row.decision_trace,
    ...(extras.digilocker ? { digilocker: extras.digilocker } : {}),
  };
}

export async function calculateEvidence(
  deps: EvidenceDeps,
  ctx: RequestContext,
  rawBody: unknown,
  idemKey: string,
) {
  const tenantId = tenantOf(ctx);
  const body = parseCalculateBody(rawBody);
  await authorize(
    deps.authorizer,
    authzInput(ctx, 'EVIDENCE_REQUIREMENTS_CALCULATE', 'EvidenceRequirementSet'),
  );
  const { row: policyRow, definition } = await loadPolicy(deps, ctx, body);
  const external = await gatherExternal(deps, ctx, body, definition);
  const now = deps.clock();
  const endpoint = 'POST /evidence-requirements/calculate';

  return withContextTx(deps.pool, ctx, async (client: PoolClient) => {
    const claim = await claimIdempotency(client, {
      tenantId,
      principalId: ctx.actor.id,
      endpoint,
      key: idemKey,
      fingerprint: calculateFingerprint(body),
      now,
    });
    if (claim !== 'claimed') return { status: claim.status, body: claim.body };

    const held = external.held.slice().sort((a, b) => a.evidence_ref.localeCompare(b.evidence_ref));
    const resolved = resolveRequirements({
      policy: definition,
      facts: body.facts,
      rule_outcomes: body.rule_outcomes,
      held_evidence: held,
      digilocker_availability: external.availability,
      as_of: now.toISOString(),
    });
    const inputHash = sha256Of({
      policy: policyRow.content_hash,
      facts: body.facts,
      rule_outcomes: body.rule_outcomes,
      held,
      availability: external.availability,
      as_of: now.toISOString(),
    });
    const decisionHash = sha256Of({ checklist: resolved.checklist, trace: resolved.trace });
    let stored: ResolutionRow;
    try {
      stored = await insertResolution(client, {
        resolutionId: randomUUID(),
        tenantId,
        cellId: ctx.cell_id,
        bindingId: body.binding_id,
        policyId: policyRow.policy_id,
        versionRef: policyRow.version_ref as string,
        policyContentHash: policyRow.content_hash,
        applicationRef: body.application_ref ?? null,
        inputHash,
        decisionHash,
        checklist: resolved.checklist,
        trace: resolved.trace,
        simulated: external.digilocker?.simulation !== undefined,
        createdBy: ctx.actor.id,
        now,
      });
    } catch (err) {
      throw mapPgError(err);
    }
    await insertOutbox(
      client,
      envelopeOf({
        eventType: 'EvidenceRequirementsResolved',
        tenantId,
        cellId: ctx.cell_id,
        aggregateType: 'EvidenceResolution',
        aggregateId: stored.resolution_id,
        aggregateVersion: 1,
        occurredAt: now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: {
          resolution_id: stored.resolution_id,
          binding_id: stored.binding_id,
          version_ref: stored.version_ref,
          policy_content_hash: stored.policy_content_hash,
          decision_hash: stored.decision_hash,
          complete: resolved.checklist.complete,
          simulation: stored.simulated,
        },
      }),
    );
    await appendAudit(client, ctx, {
      action: 'EVIDENCE_REQUIREMENTS_CALCULATE',
      actionClass: 'WRITE',
      resourceType: 'EvidenceResolution',
      resourceId: stored.resolution_id,
      result: 'SUCCESS',
      now,
    });
    const out = resolutionPublic(stored, { digilocker: external.digilocker });
    await completeIdempotency(client, {
      tenantId,
      principalId: ctx.actor.id,
      endpoint,
      key: idemKey,
      status: 200,
      body: out,
    });
    return { status: 200, body: out };
  });
}

export async function readResolution(
  client: PoolClient,
  ctx: RequestContext,
  resolutionId: string,
) {
  const row = await getResolution(client, tenantOf(ctx), resolutionId);
  if (!row) throw new Cmp011Error('SF-APP-001', { statusCode: 404 });
  return resolutionPublic(row);
}
