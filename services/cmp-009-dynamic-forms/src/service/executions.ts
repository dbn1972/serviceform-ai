import { randomUUID } from 'node:crypto';
import { validate, type RequestContext, type SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import type { FormsConfig } from '../config.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { sha256Of } from '../domain/canonical.js';
import type { ExecutionRequest } from '../domain/inputs.js';
import { parseFormPackage } from '../domain/pack.js';
import { runFormRuntime, type ControlView } from '../domain/runtime.js';
import { Cmp009Error, mapPgError } from '../errors.js';
import type { FormDefinitionPort, PublishedFormDefinition } from '../ports/form-definition.js';
import type { LocalizationPort } from '../ports/localization.js';
import {
  ensureSnapshot,
  getExecution,
  insertExecution,
  type ExecutionRow,
  type ResultCode,
} from '../repo/forms-repo.js';

export interface PreparedExecution {
  executionId: string;
  request: ExecutionRequest;
  form: PublishedFormDefinition;
  controls: ControlView[];
  visibleFields: string[];
  requiredFields: string[];
  rendererIds: string[];
  errors: { code: string; pointer: string }[];
  resultCode: ResultCode;
  dataHash: string;
  payloadDigest: string;
  locale: string;
  labels: Record<string, string>;
  simulation: SimulationMarker | null;
}

function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp009Error('SF-TEN-001');
  return ctx.tenant_id;
}

function pinMismatch(): never {
  throw new Cmp009Error('SF-FORM-001', {
    statusCode: 409,
    details: [{ code: 'FORM_PIN_MISMATCH' }],
  });
}

export function executionPublic(row: ExecutionRow) {
  return {
    execution_id: row.execution_id,
    form: {
      form_key: row.form_key,
      version_id: row.version_id,
      content_hash: row.content_hash,
    },
    snapshot_id: row.snapshot_id,
    result_code: row.result_code,
    visible_fields: row.visible_fields,
    required_fields: row.required_fields,
    errors: row.errors,
    renderer_ids: row.renderer_ids,
    data_hash: row.data_hash,
    purpose_code: row.purpose_code,
    locale: row.locale,
    evaluated_at: new Date(row.evaluated_at).toISOString(),
    client_validation_authoritative: false,
  };
}

export async function resolvePublishedForm(
  deps: { ctx: RequestContext; config: FormsConfig; forms: FormDefinitionPort },
  pin: { form_key: string; version_id: string; content_hash: string },
): Promise<PublishedFormDefinition> {
  const tenantId = tenantOf(deps.ctx);
  const form = await deps.forms.resolve({
    tenantId,
    formKey: pin.form_key,
    versionId: pin.version_id,
    contentHash: pin.content_hash,
    correlationId: deps.ctx.correlation_id,
  });
  if (form.tenant_id !== tenantId) throw new Cmp009Error('SF-TEN-002');
  if (form.status !== 'PUBLISHED') {
    throw new Cmp009Error('SF-FORM-001', {
      statusCode: 409,
      details: [{ code: 'FORM_UNPUBLISHED' }],
    });
  }
  if (
    form.form_key !== pin.form_key ||
    form.version_id !== pin.version_id ||
    form.content_hash !== pin.content_hash
  ) {
    pinMismatch();
  }
  return form;
}

export async function prepareExecution(
  deps: {
    ctx: RequestContext;
    config: FormsConfig;
    forms: FormDefinitionPort;
    localization: LocalizationPort;
  },
  request: ExecutionRequest,
): Promise<PreparedExecution> {
  const form = await resolvePublishedForm(deps, request.form);
  let simulation: SimulationMarker | null = null;
  if (form.simulation) {
    if (
      deps.config.environment === 'PRODUCTION' ||
      !validate('simulation-marker', form.simulation).valid
    ) {
      throw new Cmp009Error('SF-SYS-003', {
        details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }],
      });
    }
    simulation = form.simulation;
  }
  const parsed = parseFormPackage(form.payload, request.form.form_key);
  const loc = await deps.localization.resolve({
    tenantId: tenantOf(deps.ctx),
    locale: request.locale,
    keys: parsed.messageKeys,
    correlationId: deps.ctx.correlation_id,
  });
  const runtime = runFormRuntime(parsed.jsonSchema, parsed.uiSchema, request.data, loc.messages);
  return {
    executionId: randomUUID(),
    request,
    form,
    controls: runtime.controls,
    visibleFields: runtime.visibleScopes,
    requiredFields: runtime.requiredFields,
    rendererIds: runtime.rendererIds,
    errors: runtime.issues,
    resultCode: runtime.valid ? 'VALID' : 'INVALID',
    dataHash: sha256Of(request.data),
    payloadDigest: sha256Of(form.payload),
    locale: loc.locale,
    labels: loc.messages,
    simulation,
  };
}

export async function persistExecution(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  prepared: PreparedExecution,
) {
  const tenantId = tenantOf(deps.ctx);
  const pin = prepared.request.form;
  let row: ExecutionRow;
  try {
    const snapshot = await ensureSnapshot(client, {
      snapshotId: randomUUID(),
      tenantId,
      cellId: deps.ctx.cell_id,
      formKey: pin.form_key,
      contentHash: pin.content_hash,
      payloadDigest: prepared.payloadDigest,
      payload: prepared.form.payload,
      createdBy: deps.ctx.actor.id,
      now: deps.now,
    });
    if (snapshot.payload_digest !== prepared.payloadDigest) {
      throw new Cmp009Error('SF-FORM-001', {
        statusCode: 409,
        details: [{ code: 'FORM_DIGEST_MISMATCH' }],
      });
    }
    row = await insertExecution(client, {
      executionId: prepared.executionId,
      tenantId,
      cellId: deps.ctx.cell_id,
      snapshotId: snapshot.snapshot_id,
      formKey: pin.form_key,
      versionId: pin.version_id,
      contentHash: pin.content_hash,
      dataHash: prepared.dataHash,
      purposeCode: prepared.request.purpose_code,
      locale: prepared.locale,
      resultCode: prepared.resultCode,
      visibleFields: prepared.visibleFields,
      requiredFields: prepared.requiredFields,
      errors: prepared.errors,
      rendererIds: prepared.rendererIds,
      requestedBy: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  await insertOutbox(
    client,
    envelopeOf({
      eventType: 'FormValidated',
      tenantId,
      cellId: deps.ctx.cell_id,
      aggregateType: 'FormExecution',
      aggregateId: row.execution_id,
      aggregateVersion: 1,
      occurredAt: deps.now.toISOString(),
      correlationId: deps.ctx.correlation_id,
      actor: deps.ctx.actor,
      data: {
        execution_id: row.execution_id,
        form_key: row.form_key,
        version_id: row.version_id,
        content_hash: row.content_hash,
        result_code: row.result_code,
        error_count: row.errors.length,
        data_hash: row.data_hash,
        locale: row.locale,
      },
    }),
  );
  await appendAudit(client, deps.ctx, {
    action: 'FORM_EXECUTION_EXECUTE',
    actionClass: 'WRITE',
    resourceType: 'FormExecution',
    resourceId: row.execution_id,
    result: prepared.resultCode === 'VALID' ? 'SUCCESS' : 'DENIED',
    reason: prepared.resultCode,
    now: deps.now,
  });
  return executionPublic(row);
}

export async function readExecution(client: PoolClient, ctx: RequestContext, executionId: string) {
  const row = await getExecution(client, tenantOf(ctx), executionId);
  if (!row) throw new Cmp009Error('SF-SYS-002');
  return executionPublic(row);
}

export async function interpretForm(
  deps: {
    ctx: RequestContext;
    config: FormsConfig;
    forms: FormDefinitionPort;
    localization: LocalizationPort;
  },
  input: { form: ExecutionRequest['form']; data: Record<string, unknown>; locale: string },
) {
  const prepared = await prepareExecution(deps, {
    form: input.form,
    data: input.data,
    purpose_code: 'FORM_INTERPRET',
    locale: input.locale,
  });
  return {
    form: input.form,
    locale: prepared.locale,
    controls: prepared.controls,
    visible_fields: prepared.visibleFields,
    required_fields: prepared.requiredFields,
    renderer_ids: prepared.rendererIds,
    client_validation_authoritative: false,
    labels: prepared.labels,
  };
}
