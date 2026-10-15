import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort, type ResourceScope } from '../authz.js';
import { handoffTokenMatches, issueHandoffToken } from '../domain/handoff.js';
import { collectionResourceId } from '../domain/ids.js';
import {
  evaluateCommand,
  requiresRepresentation,
  starterActors,
  toContract,
  type ActionCommand,
  type ClosureReason,
  type LifecycleStatus,
  type OperatorActionRecord,
  type SessionAggregate,
  type SessionCommand,
  type SessionRecord,
} from '../domain/session.js';
import { Cmp057Error, detail, type ErrorCode } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { AssistedReadTx, AssistedRepository, AssistedTx } from '../repo/types.js';
import type { ActorType, AuditEvent, TenantContext } from '../types.js';
import { verifyOrFailClosed, type AssistedVerificationPort } from '../verification.js';
import type {
  ApplicationLinkInput,
  BindApplicantInput,
  CloseInput,
  RepresentationInput,
  ResumeInput,
  StartInput,
} from './input.js';

export const DEFAULT_HANDOFF_TTL_MS = 15 * 60 * 1000;

export interface AssistedServiceDeps {
  repo: AssistedRepository;
  authorizer: AuthorizationPort;
  verification: AssistedVerificationPort;
  clock: () => Date;
  /** Lifetime of a one-time handoff token; a deployment security setting, not service policy. */
  handoffTtlMs?: number;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface CommandResult {
  status: number;
  body: unknown;
}

interface RunResult extends CommandResult {
  /** What an idempotent replay returns when the live body carries a one-time secret. */
  replayBody?: unknown;
}

export const RESOURCE_TYPE = 'AssistedSession';

const VERIFIER_ACTORS: readonly ActorType[] = ['OFFICER', 'PRIVILEGED_ADMIN'];

export const ACTIONS = {
  start: 'ASSISTED_SESSION_START',
  read: 'ASSISTED_SESSION_READ',
  command: (c: SessionCommand): string => `ASSISTED_SESSION_${c}`,
} as const;

/** A refusal that must leave an audit trail even though its transaction rolls back. */
class AuditedRefusal extends Cmp057Error {
  constructor(
    code: ErrorCode,
    readonly reason: string,
    readonly action: string,
    readonly resourceId: string,
  ) {
    super(code, detail(reason));
  }
}

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function sessionView(
  agg: SessionAggregate,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const s = agg.session;
  const proof: Record<string, unknown> = {
    applied_by_actor_type: s.applied_by_actor_type,
    channel: s.channel,
  };
  if (s.organisation_id !== null) proof['organisation_id'] = s.organisation_id;
  if (s.office_id !== null) proof['office_id'] = s.office_id;
  if (s.applicant_assurance_ref !== null) {
    proof['applicant_assurance_ref'] = s.applicant_assurance_ref;
  }
  if (agg.representation) {
    proof['representation_verified_by_actor_id'] = agg.representation.verified_by_actor_id;
    if (agg.representation.valid_until !== null) {
      proof['representation_valid_until'] = agg.representation.valid_until;
    }
  }
  if (agg.consent) {
    proof['consent_ref'] = agg.consent.consent_ref;
    proof['read_back_acknowledged'] = true;
  }
  const view: Record<string, unknown> = {
    assisted_session: toContract(agg),
    session_version: s.session_version,
    proof,
  };
  if (s.application_id !== null) view['application_id'] = s.application_id;
  if (s.handoff_expires_at !== null) view['handoff_expires_at'] = s.handoff_expires_at;
  if (s.closure_reason !== null) view['closure_reason'] = s.closure_reason;
  return { ...view, ...extra };
}

/** The only capability handed to the read route: one lookup, no mutators. */
export interface AssistedSessionReader {
  readSession(ctx: TenantContext, sessionId: string): Promise<CommandResult>;
}

/**
 * Who may see a session. The operator loses sight of it once CLOSED so a shared counter or kiosk
 * terminal cannot surface a prior citizen; the citizen always sees their own sessions.
 */
export function canView(ctx: TenantContext, agg: SessionAggregate): boolean {
  const s = agg.session;
  if (ctx.actor.type === 'PRIVILEGED_ADMIN') return true;
  if (ctx.actor.type === 'CITIZEN' && sameId(ctx.actor.id, s.applied_for_citizen_id)) return true;
  if (sameId(ctx.actor.id, s.applied_by_actor_id)) return s.lifecycle_status !== 'CLOSED';
  return (
    ctx.actor.type === 'OFFICER' &&
    requiresRepresentation(s.channel) &&
    s.lifecycle_status === 'APPLICANT_BOUND'
  );
}

export class AssistedSessionService implements AssistedSessionReader {
  private readonly handoffTtlMs: number;

  constructor(private readonly deps: AssistedServiceDeps) {
    this.handoffTtlMs = deps.handoffTtlMs ?? DEFAULT_HANDOFF_TTL_MS;
    if (!Number.isSafeInteger(this.handoffTtlMs) || this.handoffTtlMs <= 0) {
      throw new Cmp057Error('SF-SYS-001', detail('HANDOFF_TTL_INVALID'));
    }
  }

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp057Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private async refuse(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    code: ErrorCode,
    reason: string,
    result: 'DENIED' | 'FAILED' = 'DENIED',
  ): Promise<never> {
    await this.auditOutcome(ctx, action, resourceId, result, reason);
    throw new Cmp057Error(code, detail(reason));
  }

  /** PEP call on OPA; a denial is audited as DENIED, a PDP outage fails closed (503). */
  private async pep(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    scope: ResourceScope = {},
  ): Promise<void> {
    this.assertNotInTx();
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action, RESOURCE_TYPE, scope));
    } catch (err) {
      if (err instanceof Cmp057Error && err.code === 'SF-AUTH-002') {
        await this.auditOutcome(ctx, action, resourceId, 'DENIED', 'POLICY_DENIED');
      }
      throw err;
    }
  }

  private async auditOutcome(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    result: 'DENIED' | 'FAILED',
    reason?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action === ACTIONS.read ? 'READ' : 'WRITE',
        resourceType: RESOURCE_TYPE,
        resourceId,
        result,
        ...(reason === undefined ? {} : { reason }),
        now,
      }),
    );
  }

  private async command(
    ctx: TenantContext,
    idem: Idempotency,
    run: (tx: AssistedTx, now: Date) => Promise<RunResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    try {
      return await this.deps.repo.withTx(ctx, async (tx) => {
        const claim = await tx.claimIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          fingerprint: idem.fingerprint,
          now,
        });
        if (claim !== 'claimed') return claim;
        const result = await run(tx, now);
        await tx.completeIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          status: result.status,
          body: result.replayBody ?? result.body,
        });
        return { status: result.status, body: result.body };
      });
    } catch (err) {
      if (err instanceof AuditedRefusal) {
        await this.auditOutcome(ctx, err.action, err.resourceId, 'FAILED', err.reason);
      }
      throw err;
    }
  }

  /** Pre-transaction lookup so actor rules and the PEP see the applicant before any write. */
  private async precheck(ctx: TenantContext, sessionId: string): Promise<SessionAggregate> {
    const agg = await this.deps.repo.withReadTx(ctx, (tx) => tx.getSession(sessionId));
    if (!agg) throw new Cmp057Error('SF-SYS-002', detail('SESSION_NOT_FOUND'));
    return agg;
  }

  private async requireOperator(
    ctx: TenantContext,
    agg: SessionAggregate,
    action: string,
    allowAdmin = false,
  ): Promise<void> {
    const s = agg.session;
    if (sameId(ctx.actor.id, s.applied_by_actor_id)) return;
    if (allowAdmin && ctx.actor.type === 'PRIVILEGED_ADMIN') return;
    if (ctx.actor.type === 'CITIZEN') {
      await this.refuse(ctx, action, s.session_id, 'SF-SYS-002', 'SESSION_NOT_FOUND');
    }
    await this.refuse(ctx, action, s.session_id, 'SF-AUTH-002', 'OPERATOR_NOT_SESSION_OWNER');
  }

  private async emit(
    tx: AssistedTx,
    ctx: TenantContext,
    p: { eventType: DomainEventType; session: SessionRecord; now: Date; extra?: object },
  ): Promise<void> {
    const s = p.session;
    const data: Record<string, unknown> = {
      session_id: s.session_id,
      channel: s.channel,
      applied_by_actor_id: s.applied_by_actor_id,
      applied_for_citizen_id: s.applied_for_citizen_id,
      applied_by_distinct_from_applied_for: true,
      lifecycle_status: s.lifecycle_status,
      session_version: s.session_version,
      ...(p.extra ?? {}),
    };
    if (s.application_id !== null) data['application_id'] = s.application_id;
    await tx.insertOutbox(
      envelopeOf({
        eventType: p.eventType,
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: RESOURCE_TYPE,
        aggregateId: s.session_id,
        aggregateVersion: s.session_version,
        occurredAt: p.now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data,
      }),
      TOPIC_DOMAIN,
    );
  }

  private actionRow(
    ctx: TenantContext,
    session: SessionRecord,
    command: ActionCommand,
    from: LifecycleStatus | null,
  ): OperatorActionRecord {
    return {
      tenant_id: ctx.tenant_id,
      action_id: randomUUID(),
      session_id: session.session_id,
      sequence: session.session_version,
      command,
      from_status: from,
      to_status: session.lifecycle_status,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      correlation_id: ctx.correlation_id,
      acted_at: session.updated_at,
    };
  }

  private async audit(
    tx: AssistedTx,
    ctx: TenantContext,
    action: string,
    sessionId: string,
    now: Date,
    actionClass: NonNullable<AuditEvent['action_class']> = 'WRITE',
    reason?: string,
  ): Promise<void> {
    await appendAudit(tx, ctx, {
      action,
      actionClass,
      resourceType: RESOURCE_TYPE,
      resourceId: sessionId,
      result: 'SUCCESS',
      ...(reason === undefined ? {} : { reason }),
      now,
    });
  }

  /**
   * Shared transition skeleton: lock, stale-version check, lifecycle verdict, then the
   * command-specific mutation, one operator action row and the audit record.
   */
  private async transition(
    tx: AssistedTx,
    ctx: TenantContext,
    p: {
      command: SessionCommand;
      sessionId: string;
      expectedVersion: number | null;
      now: Date;
      mutate: (agg: SessionAggregate, next: SessionRecord) => Promise<void> | void;
    },
  ): Promise<{ before: SessionAggregate; next: SessionRecord }> {
    const action = ACTIONS.command(p.command);
    const agg = await tx.getSessionForUpdate(p.sessionId);
    if (!agg) throw new Cmp057Error('SF-SYS-002', detail('SESSION_NOT_FOUND'));
    if (p.expectedVersion !== null && agg.session.session_version !== p.expectedVersion) {
      throw new Cmp057Error('SF-APP-001', detail('STALE_VERSION', '/expected_version'));
    }
    const verdict = evaluateCommand(p.command, agg.session.lifecycle_status);
    if (!verdict.allowed) {
      throw new AuditedRefusal('SF-APP-001', verdict.reason, action, p.sessionId);
    }
    const next: SessionRecord = {
      ...agg.session,
      lifecycle_status: verdict.to,
      session_version: agg.session.session_version + 1,
      updated_at: p.now.toISOString(),
      last_correlation_id: ctx.correlation_id,
    };
    await p.mutate(agg, next);
    await tx.updateSession(next);
    await tx.insertAction(this.actionRow(ctx, next, p.command, agg.session.lifecycle_status));
    return { before: agg, next };
  }

  private assertRepresentationCurrent(agg: SessionAggregate, now: Date, action: string): void {
    const until = agg.representation?.valid_until ?? null;
    if (until !== null && Date.parse(until) <= now.getTime()) {
      throw new AuditedRefusal(
        'SF-APP-001',
        'REPRESENTATION_EXPIRED',
        action,
        agg.session.session_id,
      );
    }
  }

  async start(ctx: TenantContext, input: StartInput, idem: Idempotency): Promise<CommandResult> {
    const resourceId = collectionResourceId(ctx.tenant_id, 'ASSISTED_SESSIONS');
    this.assertNotInTx();
    if (!starterActors(input.channel).includes(ctx.actor.type)) {
      await this.refuse(ctx, ACTIONS.start, resourceId, 'SF-AUTH-002', 'ACTOR_NOT_PERMITTED');
    }
    if (sameId(ctx.actor.id, input.applied_for_citizen_id)) {
      await this.refuse(
        ctx,
        ACTIONS.start,
        resourceId,
        'SF-AUTH-002',
        'APPLIED_BY_EQUALS_APPLIED_FOR',
      );
    }
    await this.pep(ctx, ACTIONS.start, resourceId, { ownerId: input.applied_for_citizen_id });
    const inTenant = await verifyOrFailClosed(() =>
      this.deps.verification.applicantInTenant(ctx, input.applied_for_citizen_id),
    );
    if (!inTenant) {
      await this.refuse(ctx, ACTIONS.start, resourceId, 'SF-TEN-002', 'APPLICANT_NOT_IN_TENANT');
    }
    return this.command(ctx, idem, async (tx, now) => {
      const nowIso = now.toISOString();
      const session: SessionRecord = {
        tenant_id: ctx.tenant_id,
        session_id: randomUUID(),
        channel: input.channel,
        applied_by_actor_id: ctx.actor.id.toLowerCase(),
        applied_by_actor_type: ctx.actor.type,
        applied_for_citizen_id: input.applied_for_citizen_id,
        organisation_id: ctx.organisation_id ?? null,
        office_id: ctx.office_id ?? null,
        lifecycle_status: 'STARTED',
        session_version: 1,
        idempotency_key: idem.key,
        applicant_assurance_ref: null,
        application_id: null,
        handoff_token_hash: null,
        handoff_expires_at: null,
        closure_reason: null,
        started_at: nowIso,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertSession(session);
      await tx.insertAction(this.actionRow(ctx, session, 'START', null));
      await this.emit(tx, ctx, { eventType: 'AssistedSessionStarted', session, now });
      await this.audit(tx, ctx, ACTIONS.start, session.session_id, now);
      return { status: 201, body: sessionView({ session }) };
    });
  }

  async bindApplicant(
    ctx: TenantContext,
    sessionId: string,
    input: BindApplicantInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.command('BIND_APPLICANT');
    const pre = await this.precheck(ctx, sessionId);
    await this.requireOperator(ctx, pre, action);
    await this.pep(ctx, action, sessionId, { ownerId: pre.session.applied_for_citizen_id });
    return this.command(ctx, idem, async (tx, now) => {
      const { before, next } = await this.transition(tx, ctx, {
        command: 'BIND_APPLICANT',
        sessionId,
        expectedVersion: input.expected_version,
        now,
        mutate: (_agg, n) => {
          n.applicant_assurance_ref = input.applicant_assurance_ref;
        },
      });
      await this.audit(tx, ctx, action, sessionId, now);
      return { status: 200, body: sessionView({ ...before, session: next }) };
    });
  }

  async verifyRepresentation(
    ctx: TenantContext,
    sessionId: string,
    input: RepresentationInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.command('VERIFY_REPRESENTATION');
    const pre = await this.precheck(ctx, sessionId);
    const s = pre.session;
    if (requiresRepresentation(s.channel)) {
      if (ctx.actor.type === 'CITIZEN' && !sameId(ctx.actor.id, s.applied_by_actor_id)) {
        await this.refuse(ctx, action, sessionId, 'SF-SYS-002', 'SESSION_NOT_FOUND');
      }
      if (sameId(ctx.actor.id, s.applied_by_actor_id)) {
        await this.refuse(ctx, action, sessionId, 'SF-AUTH-002', 'SELF_VERIFICATION_REFUSED');
      }
      if (sameId(ctx.actor.id, s.applied_for_citizen_id)) {
        await this.refuse(ctx, action, sessionId, 'SF-AUTH-002', 'APPLICANT_CANNOT_VERIFY');
      }
      if (!VERIFIER_ACTORS.includes(ctx.actor.type)) {
        await this.refuse(ctx, action, sessionId, 'SF-AUTH-002', 'ACTOR_NOT_PERMITTED');
      }
      if (input.representation_authority_ref === null) {
        throw new Cmp057Error(
          'SF-SYS-003',
          detail('REPRESENTATION_AUTHORITY_REF_REQUIRED', '/representation_authority_ref'),
        );
      }
    } else {
      await this.requireOperator(ctx, pre, action);
    }
    const now = this.deps.clock();
    if (
      input.representation_valid_until !== null &&
      Date.parse(input.representation_valid_until) <= now.getTime()
    ) {
      await this.refuse(ctx, action, sessionId, 'SF-APP-001', 'REPRESENTATION_EXPIRED', 'FAILED');
    }
    await this.pep(ctx, action, sessionId, { ownerId: s.applied_for_citizen_id });
    const consented = await verifyOrFailClosed(() =>
      this.deps.verification.consentCaptured(ctx, {
        citizenId: s.applied_for_citizen_id,
        consentRef: input.consent_ref,
        sessionId,
      }),
    );
    if (!consented) {
      await this.refuse(ctx, action, sessionId, 'SF-APP-001', 'CONSENT_NOT_CAPTURED', 'FAILED');
    }
    return this.command(ctx, idem, async (tx, at) => {
      const atIso = at.toISOString();
      const representation = {
        tenant_id: ctx.tenant_id,
        representation_id: randomUUID(),
        session_id: sessionId,
        representation_authority_ref: input.representation_authority_ref,
        valid_until: input.representation_valid_until,
        verified_by_actor_id: ctx.actor.id.toLowerCase(),
        verified_by_actor_type: ctx.actor.type,
        verified_at: atIso,
      };
      const consent = {
        tenant_id: ctx.tenant_id,
        consent_record_id: randomUUID(),
        session_id: sessionId,
        consent_ref: input.consent_ref,
        read_back_acknowledged: true as const,
        captured_by_actor_id: ctx.actor.id.toLowerCase(),
        captured_at: atIso,
      };
      const { next } = await this.transition(tx, ctx, {
        command: 'VERIFY_REPRESENTATION',
        sessionId,
        expectedVersion: input.expected_version,
        now: at,
        mutate: async () => {
          await tx.insertRepresentation(representation);
          await tx.insertConsent(consent);
        },
      });
      const extra: Record<string, unknown> = { consent_ref: consent.consent_ref };
      if (representation.representation_authority_ref !== null) {
        extra['representation_authority_ref'] = representation.representation_authority_ref;
      }
      await this.emit(tx, ctx, {
        eventType: 'RepresentationVerified',
        session: next,
        now: at,
        extra,
      });
      await this.audit(tx, ctx, action, sessionId, at, 'DECISION', 'REPRESENTATION_AND_CONSENT');
      return { status: 200, body: sessionView({ session: next, representation, consent }) };
    });
  }

  async submit(
    ctx: TenantContext,
    sessionId: string,
    input: ApplicationLinkInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.command('SUBMIT');
    const pre = await this.precheck(ctx, sessionId);
    await this.requireOperator(ctx, pre, action);
    await this.pep(ctx, action, sessionId, {
      ownerId: pre.session.applied_for_citizen_id,
      applicationId: input.application_id,
    });
    return this.command(ctx, idem, async (tx, now) => {
      const { before, next } = await this.transition(tx, ctx, {
        command: 'SUBMIT',
        sessionId,
        expectedVersion: input.expected_version,
        now,
        mutate: (agg, n) => {
          this.assertRepresentationCurrent(agg, now, action);
          n.application_id = input.application_id;
        },
      });
      await this.emit(tx, ctx, {
        eventType: 'AssistedApplicationSubmitted',
        session: next,
        now,
        extra: submissionExtra(before),
      });
      await this.audit(tx, ctx, action, sessionId, now);
      return { status: 200, body: sessionView({ ...before, session: next }) };
    });
  }

  async handoff(
    ctx: TenantContext,
    sessionId: string,
    input: ApplicationLinkInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.command('HANDOFF');
    const pre = await this.precheck(ctx, sessionId);
    await this.requireOperator(ctx, pre, action);
    await this.pep(ctx, action, sessionId, {
      ownerId: pre.session.applied_for_citizen_id,
      applicationId: input.application_id,
    });
    return this.command(ctx, idem, async (tx, now) => {
      const issued = issueHandoffToken();
      const expiresAt = new Date(now.getTime() + this.handoffTtlMs).toISOString();
      const { before, next } = await this.transition(tx, ctx, {
        command: 'HANDOFF',
        sessionId,
        expectedVersion: input.expected_version,
        now,
        mutate: (agg, n) => {
          this.assertRepresentationCurrent(agg, now, action);
          n.application_id = input.application_id;
          n.handoff_token_hash = issued.hash;
          n.handoff_expires_at = expiresAt;
        },
      });
      await this.emit(tx, ctx, {
        eventType: 'AssistedSessionHandedOff',
        session: next,
        now,
        extra: { ...submissionExtra(before), handoff_expires_at: expiresAt },
      });
      await this.audit(tx, ctx, action, sessionId, now);
      const agg = { ...before, session: next };
      return {
        status: 200,
        body: sessionView(agg, { handoff: { handoff_token: issued.token, expires_at: expiresAt } }),
        replayBody: sessionView(agg, {
          handoff: { handoff_token: null, token_redacted: true, expires_at: expiresAt },
        }),
      };
    });
  }

  /** Citizen self-service resume; citizen_id and application identity are carried unchanged. */
  async resume(
    ctx: TenantContext,
    sessionId: string,
    input: ResumeInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.command('RESUME');
    const pre = await this.precheck(ctx, sessionId);
    const s = pre.session;
    if (!sameId(ctx.actor.id, s.applied_for_citizen_id)) {
      if (ctx.actor.type === 'CITIZEN') {
        await this.refuse(ctx, action, sessionId, 'SF-SYS-002', 'SESSION_NOT_FOUND');
      }
      await this.refuse(ctx, action, sessionId, 'SF-AUTH-002', 'HANDOFF_TOKEN_MISUSE');
    }
    if (ctx.actor.type !== 'CITIZEN') {
      await this.refuse(ctx, action, sessionId, 'SF-AUTH-002', 'ACTOR_NOT_PERMITTED');
    }
    await this.pep(ctx, action, sessionId, { ownerId: s.applied_for_citizen_id });
    return this.command(ctx, idem, async (tx, now) => {
      const { before, next } = await this.transition(tx, ctx, {
        command: 'RESUME',
        sessionId,
        expectedVersion: null,
        now,
        mutate: (agg, n) => {
          if (!handoffTokenMatches(input.handoff_token, agg.session.handoff_token_hash)) {
            throw new AuditedRefusal('SF-AUTH-002', 'HANDOFF_TOKEN_INVALID', action, sessionId);
          }
          const exp = agg.session.handoff_expires_at;
          if (exp === null || Date.parse(exp) <= now.getTime()) {
            throw new AuditedRefusal('SF-APP-001', 'HANDOFF_TOKEN_EXPIRED', action, sessionId);
          }
          closeFields(n, 'RESUMED_SELF_SERVICE');
        },
      });
      await this.audit(tx, ctx, action, sessionId, now);
      return {
        status: 200,
        body: sessionView(
          { ...before, session: next },
          {
            resume: {
              application_id: before.session.application_id,
              applied_for_citizen_id: before.session.applied_for_citizen_id,
            },
          },
        ),
      };
    });
  }

  async close(
    ctx: TenantContext,
    sessionId: string,
    input: CloseInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.command('CLOSE');
    const pre = await this.precheck(ctx, sessionId);
    await this.requireOperator(ctx, pre, action, true);
    await this.pep(ctx, action, sessionId, { ownerId: pre.session.applied_for_citizen_id });
    return this.command(ctx, idem, async (tx, now) => {
      const { before, next } = await this.transition(tx, ctx, {
        command: 'CLOSE',
        sessionId,
        expectedVersion: input.expected_version,
        now,
        mutate: (_agg, n) => closeFields(n, 'OPERATOR_CLOSED'),
      });
      await this.audit(tx, ctx, action, sessionId, now);
      return { status: 200, body: sessionView({ ...before, session: next }) };
    });
  }

  /** Read port: authorised, then served from a READ ONLY transaction; never mutates. */
  async readSession(ctx: TenantContext, sessionId: string): Promise<CommandResult> {
    await this.pep(ctx, ACTIONS.read, sessionId);
    const agg = await this.deps.repo.withReadTx(ctx, (tx: AssistedReadTx) =>
      tx.getSession(sessionId),
    );
    if (!agg) throw new Cmp057Error('SF-SYS-002', detail('SESSION_NOT_FOUND'));
    if (!canView(ctx, agg)) {
      return this.refuse(ctx, ACTIONS.read, sessionId, 'SF-SYS-002', 'SESSION_NOT_FOUND');
    }
    return { status: 200, body: sessionView(agg) };
  }
}

function closeFields(n: SessionRecord, reason: ClosureReason): void {
  n.closure_reason = reason;
  n.handoff_token_hash = null;
  n.handoff_expires_at = null;
}

function submissionExtra(agg: SessionAggregate): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (agg.consent) extra['consent_ref'] = agg.consent.consent_ref;
  const ref = agg.representation?.representation_authority_ref ?? null;
  if (ref !== null) extra['representation_authority_ref'] = ref;
  return extra;
}

export function createAssistedSessionReadPort(reader: AssistedSessionReader): Readonly<{
  getSession(ctx: TenantContext, sessionId: string): Promise<CommandResult>;
}> {
  return Object.freeze({
    getSession: (ctx: TenantContext, sessionId: string) => reader.readSession(ctx, sessionId),
  });
}
