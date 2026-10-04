import { randomUUID } from 'node:crypto';
import {
  validate,
  type AuthAssurance,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
  type IsolationClass,
  type RequestContext,
  type Uuid,
} from '@serviceform/contracts';
import { metrics, trace } from '@opentelemetry/api';
import type { Logger } from '@serviceform/observability';
import { sanitizeDecisionLog } from './decision-log.js';
import type { PdpClient } from './pdp-client.js';

const tracer = trace.getTracer('sf.security');
const meter = metrics.getMeter('sf.security');
const decisions = meter.createCounter('sf_authz_decisions_total');
const duration = meter.createHistogram('sf_authz_decision_duration_ms');
const pdpFailures = meter.createCounter('sf_pdp_failures_total');

export interface AuthzResource {
  resource_type: string;
  tenant_id: Uuid | null;
  organisation_id?: Uuid;
  jurisdiction_id?: Uuid;
  service_id?: Uuid;
  application_id?: Uuid;
  task_id?: Uuid;
  owner_id?: Uuid;
  classification?: IsolationClass;
}

const PDP_FAIL = new Set([
  'PDP_UNAVAILABLE',
  'PDP_TIMEOUT',
  'PDP_ERROR',
  'POLICY_UNDEFINED',
  'PDP_INVALID_RESPONSE',
  'CIRCUIT_OPEN',
]);

function denyLocal(reason: string): AuthzDecisionOutput {
  return { allow: false, reason_code: reason, policy_revision: 'none', decision_id: randomUUID() };
}

export async function authorizeAction(opts: {
  ctx: RequestContext;
  action: string;
  resource: AuthzResource;
  workflow_context?: AuthzDecisionInput['workflow_context'];
  pdp: PdpClient;
  logger?: Logger;
  now?: Date;
}): Promise<AuthzDecisionOutput> {
  const started = Date.now();
  const span = tracer.startSpan('sf.authz.decide');
  const request_time = (opts.now ?? new Date()).toISOString();
  const subject: AuthzDecisionInput['subject'] = {
    user_id: opts.ctx.actor.id,
    actor_type: opts.ctx.actor.type,
    tenant_id: opts.ctx.tenant_id,
    roles: opts.ctx.roles,
    jurisdiction_ids: opts.ctx.jurisdiction_ids,
  };
  if (opts.ctx.organisation_id) subject.organisation_id = opts.ctx.organisation_id;
  if (opts.ctx.office_id) subject.office_id = opts.ctx.office_id;
  if (opts.ctx.auth_assurance) subject.assurance = opts.ctx.auth_assurance as AuthAssurance;
  if (opts.ctx.delegation_id) subject.delegation_id = opts.ctx.delegation_id;

  const resource: AuthzDecisionInput['resource'] = {
    resource_type: opts.resource.resource_type,
    tenant_id: opts.resource.tenant_id,
  };
  if (opts.resource.organisation_id) resource.organisation_id = opts.resource.organisation_id;
  if (opts.resource.jurisdiction_id) resource.jurisdiction_id = opts.resource.jurisdiction_id;
  if (opts.resource.service_id) resource.service_id = opts.resource.service_id;
  if (opts.resource.application_id) resource.application_id = opts.resource.application_id;
  if (opts.resource.task_id) resource.task_id = opts.resource.task_id;
  if (opts.resource.owner_id) resource.owner_id = opts.resource.owner_id;
  if (opts.resource.classification) resource.classification = opts.resource.classification;

  const environment: NonNullable<AuthzDecisionInput['environment']> = {
    request_time,
    trace_id: opts.ctx.trace_id,
  };

  const input: AuthzDecisionInput = {
    subject,
    resource,
    action: opts.action,
    environment,
  };
  if (opts.workflow_context) input.workflow_context = opts.workflow_context;

  const valid = validate('authz-decision-input', input);
  let out: AuthzDecisionOutput;
  if (!valid.valid) {
    out = denyLocal('INPUT_INVALID');
  } else if (
    (opts.resource.classification ?? 'TENANT_SCOPED') === 'TENANT_SCOPED' &&
    opts.ctx.tenant_id !== opts.resource.tenant_id
  ) {
    out = denyLocal('TENANT_MISMATCH');
  } else {
    out = await opts.pdp.decide(input);
  }

  const latency = Date.now() - started;
  span.setAttribute('decision_id', out.decision_id);
  span.setAttribute('policy_revision', out.policy_revision);
  span.setAttribute('reason_code', out.reason_code);
  span.setAttribute('allow', out.allow);
  span.end();
  decisions.add(1, { allow: String(out.allow), reason_code: out.reason_code });
  duration.record(latency);
  if (PDP_FAIL.has(out.reason_code)) pdpFailures.add(1, { kind: out.reason_code });

  const log = sanitizeDecisionLog({
    decision_id: out.decision_id,
    trace_id: opts.ctx.trace_id,
    correlation_id: opts.ctx.correlation_id,
    policy_revision: out.policy_revision,
    path: 'sf/authz/decision',
    allow: out.allow,
    reason_code: out.reason_code,
    latency_ms: latency,
    action: opts.action,
    resource_type: opts.resource.resource_type,
    resource_tenant_id: opts.resource.tenant_id,
    subject_actor_type: opts.ctx.actor.type,
    roles: opts.ctx.roles,
    delegation_present: Boolean(opts.ctx.delegation_id),
  });
  opts.logger?.info(log, 'authz decision');
  return out;
}

export function isPdpFailure(reason: string): boolean {
  return PDP_FAIL.has(reason);
}
