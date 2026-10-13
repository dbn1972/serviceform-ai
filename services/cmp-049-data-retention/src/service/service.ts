import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import {
  evaluateCandidates,
  evaluateTransition,
  hasOwnerPeriodRef,
  transitionActions,
  type Eligibility,
} from '../domain/eligibility.js';
import { collectionResourceId } from '../domain/ids.js';
import {
  POLICY_RESOURCE_TYPE,
  SUBJECT_RESOURCE_TYPE,
  toContract,
  type RetentionPolicyRecord,
} from '../domain/policy.js';
import { Cmp049Error, detail, type ErrorCode } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { RetentionRepository, RetentionSubjectRecord, RetentionTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { EnrollSubjectInput, RegisterPolicyInput, TransitionInput } from './input.js';

export interface RetentionServiceDeps {
  repo: RetentionRepository;
  authorizer: AuthorizationPort;
  clock: () => Date;
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

type ActorType = TenantContext['actor']['type'];
/** Retention is a staff/system surface; citizens never reach it whatever the policy data says. */
const STAFF_ACTORS: readonly ActorType[] = ['OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM'];
/** Policy definition and owner period binding are governance actions, not case work. */
const POLICY_ADMIN_ACTORS: readonly ActorType[] = ['PRIVILEGED_ADMIN', 'SYSTEM'];

export const ACTIONS = {
  policyRegister: 'RETENTION_POLICY_REGISTER',
  policyRead: 'RETENTION_POLICY_READ',
  policyBindPeriodRef: 'RETENTION_POLICY_BIND_PERIOD_REF',
  subjectEnroll: 'RETENTION_SUBJECT_ENROLL',
  subjectRead: 'RETENTION_SUBJECT_READ',
  subjectEvaluate: 'RETENTION_SUBJECT_EVALUATE',
} as const;

/** A business refusal that must leave an audit trail even though its transaction rolls back. */
class AuditedRefusal extends Cmp049Error {
  constructor(
    code: ErrorCode,
    readonly reason: string,
    readonly action: string,
    readonly resourceType: string,
    readonly resourceId: string,
  ) {
    super(code, detail(reason));
  }
}

export function policyView(row: RetentionPolicyRecord): Record<string, unknown> {
  return {
    policy: toContract(row),
    policy_version: row.policy_version,
    owner_period_ref_bound: hasOwnerPeriodRef(row.owner_supplied_period_ref),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function subjectView(row: RetentionSubjectRecord): Record<string, unknown> {
  return {
    subject_id: row.subject_id,
    policy_id: row.policy_id,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    eligibility: row.eligibility,
    subject_version: row.subject_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class DataRetentionService {
  constructor(private readonly deps: RetentionServiceDeps) {}

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp049Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private assertActor(ctx: TenantContext, allowed: readonly ActorType[]): void {
    if (!allowed.includes(ctx.actor.type)) {
      throw new Cmp049Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
  }

  /** PEP call on OPA; a policy denial is audited as DENIED, a PDP outage fails closed (503). */
  private async guard(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    actors: readonly ActorType[],
  ): Promise<void> {
    this.assertNotInTx();
    this.assertActor(ctx, actors);
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action, resourceType));
    } catch (err) {
      if (err instanceof Cmp049Error && err.code === 'SF-AUTH-002') {
        await this.auditOutcome(ctx, action, resourceType, resourceId, 'DENIED');
      }
      throw err;
    }
  }

  private async auditOutcome(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    result: 'DENIED' | 'FAILED',
    reason?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action.endsWith('_READ') || action.endsWith('_EVALUATE') ? 'READ' : 'WRITE',
        resourceType,
        resourceId,
        result,
        ...(reason === undefined ? {} : { reason }),
        now,
      }),
    );
  }

  /** Runs one idempotent command; an AuditedRefusal rolls back and is then audited as FAILED. */
  private async command(
    ctx: TenantContext,
    idem: Idempotency,
    run: (tx: RetentionTx, now: Date) => Promise<CommandResult>,
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
          body: result.body,
        });
        return result;
      });
    } catch (err) {
      if (err instanceof AuditedRefusal) {
        await this.auditOutcome(
          ctx,
          err.action,
          err.resourceType,
          err.resourceId,
          'FAILED',
          err.reason,
        );
      }
      throw err;
    }
  }

  private async emit(
    tx: RetentionTx,
    ctx: TenantContext,
    p: {
      eventType: DomainEventType;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      now: Date;
      data: object;
    },
  ): Promise<void> {
    await tx.insertOutbox(
      envelopeOf({
        eventType: p.eventType,
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: p.aggregateType,
        aggregateId: p.aggregateId,
        aggregateVersion: p.aggregateVersion,
        occurredAt: p.now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: p.data,
      }),
      TOPIC_DOMAIN,
    );
  }

  private policyEventData(row: RetentionPolicyRecord): object {
    return {
      policy_id: row.policy_id,
      policy_version: row.policy_version,
      resource_type: row.scope.resource_type,
      owner_supplied_period_ref: row.owner_supplied_period_ref,
      owner_period_ref_bound: hasOwnerPeriodRef(row.owner_supplied_period_ref),
      transition_count: row.eligibility_transitions.length,
      statutory_retention_policy_input_required: true,
      invented_statutory_period_forbidden: true,
    };
  }

  async registerPolicy(
    ctx: TenantContext,
    input: RegisterPolicyInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const collectionId = collectionResourceId(ctx.tenant_id, 'POLICIES');
    await this.guard(
      ctx,
      ACTIONS.policyRegister,
      POLICY_RESOURCE_TYPE,
      collectionId,
      POLICY_ADMIN_ACTORS,
    );
    return this.command(ctx, idem, async (tx, now) => {
      const nowIso = now.toISOString();
      const row: RetentionPolicyRecord = {
        tenant_id: ctx.tenant_id,
        policy_id: randomUUID(),
        policy_version: 1,
        scope: input.scope,
        owner_supplied_period_ref: input.owner_supplied_period_ref,
        eligibility_transitions: input.eligibility_transitions,
        created_at: nowIso,
        updated_at: nowIso,
        created_by: ctx.actor.id,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertPolicy(row);
      await this.emit(tx, ctx, {
        eventType: 'RetentionPolicyRegistered',
        aggregateType: POLICY_RESOURCE_TYPE,
        aggregateId: row.policy_id,
        aggregateVersion: row.policy_version,
        now,
        data: this.policyEventData(row),
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.policyRegister,
        actionClass: 'WRITE',
        resourceType: POLICY_RESOURCE_TYPE,
        resourceId: row.policy_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: policyView(row) };
    });
  }

  async getPolicy(ctx: TenantContext, policyId: string): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.policyRead, POLICY_RESOURCE_TYPE, policyId, STAFF_ACTORS);
    const now = this.deps.clock();
    const row = await this.deps.repo.withTx(ctx, async (tx) => {
      const found = await tx.getPolicy(policyId);
      await appendAudit(tx, ctx, {
        action: ACTIONS.policyRead,
        actionClass: 'READ',
        resourceType: POLICY_RESOURCE_TYPE,
        resourceId: policyId,
        result: found ? 'SUCCESS' : 'FAILED',
        ...(found ? {} : { reason: 'POLICY_NOT_FOUND' }),
        now,
      });
      return found;
    });
    if (!row) throw new Cmp049Error('SF-SYS-002', detail('POLICY_NOT_FOUND'));
    return { status: 200, body: policyView(row) };
  }

  /** Records the owner's approved period reference. One-time: a bound ref is never replaced. */
  async bindPeriodRef(
    ctx: TenantContext,
    policyId: string,
    periodRef: string,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.policyBindPeriodRef;
    await this.guard(ctx, action, POLICY_RESOURCE_TYPE, policyId, POLICY_ADMIN_ACTORS);
    return this.command(ctx, idem, async (tx, now) => {
      const current = await tx.getPolicy(policyId, true);
      if (!current) throw new Cmp049Error('SF-SYS-002', detail('POLICY_NOT_FOUND'));
      if (hasOwnerPeriodRef(current.owner_supplied_period_ref)) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'PERIOD_REF_ALREADY_BOUND',
          action,
          POLICY_RESOURCE_TYPE,
          policyId,
        );
      }
      const next: RetentionPolicyRecord = {
        ...current,
        owner_supplied_period_ref: periodRef,
        policy_version: current.policy_version + 1,
        updated_at: now.toISOString(),
        last_correlation_id: ctx.correlation_id,
      };
      await tx.bindPolicyPeriodRef(next);
      await this.emit(tx, ctx, {
        eventType: 'RetentionPolicyPeriodRefBound',
        aggregateType: POLICY_RESOURCE_TYPE,
        aggregateId: next.policy_id,
        aggregateVersion: next.policy_version,
        now,
        data: this.policyEventData(next),
      });
      await appendAudit(tx, ctx, {
        action,
        actionClass: 'WRITE',
        resourceType: POLICY_RESOURCE_TYPE,
        resourceId: policyId,
        result: 'SUCCESS',
        now,
      });
      return { status: 200, body: policyView(next) };
    });
  }

  async enrollSubject(
    ctx: TenantContext,
    input: EnrollSubjectInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.subjectEnroll;
    const collectionId = collectionResourceId(ctx.tenant_id, 'SUBJECTS');
    await this.guard(ctx, action, SUBJECT_RESOURCE_TYPE, collectionId, STAFF_ACTORS);
    return this.command(ctx, idem, async (tx, now) => {
      const policy = await tx.getPolicy(input.policy_id);
      if (!policy) throw new Cmp049Error('SF-SYS-002', detail('POLICY_NOT_FOUND'));
      if (policy.scope.resource_type !== input.resource_type) {
        throw new Cmp049Error(
          'SF-SYS-003',
          detail('RESOURCE_TYPE_SCOPE_MISMATCH', '/resource_type'),
        );
      }
      if (await tx.findSubjectByResource(input.resource_type, input.resource_id)) {
        throw new Cmp049Error('SF-APP-002', detail('SUBJECT_ALREADY_ENROLLED'));
      }
      const nowIso = now.toISOString();
      const row: RetentionSubjectRecord = {
        tenant_id: ctx.tenant_id,
        subject_id: randomUUID(),
        policy_id: policy.policy_id,
        resource_type: input.resource_type,
        resource_id: input.resource_id,
        eligibility: 'ACTIVE',
        subject_version: 1,
        created_at: nowIso,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertSubject(row);
      await this.emit(tx, ctx, {
        eventType: 'RetentionSubjectEnrolled',
        aggregateType: SUBJECT_RESOURCE_TYPE,
        aggregateId: row.subject_id,
        aggregateVersion: row.subject_version,
        now,
        data: {
          subject_id: row.subject_id,
          policy_id: policy.policy_id,
          policy_version: policy.policy_version,
          resource_type: row.resource_type,
          resource_id: row.resource_id,
          from_eligibility: null,
          to_eligibility: row.eligibility,
          subject_version: row.subject_version,
          owner_supplied_period_ref: policy.owner_supplied_period_ref,
        },
      });
      await appendAudit(tx, ctx, {
        action,
        actionClass: 'WRITE',
        resourceType: SUBJECT_RESOURCE_TYPE,
        resourceId: row.subject_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: subjectView(row) };
    });
  }

  async getSubject(ctx: TenantContext, subjectId: string): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.subjectRead, SUBJECT_RESOURCE_TYPE, subjectId, STAFF_ACTORS);
    const now = this.deps.clock();
    const row = await this.deps.repo.withTx(ctx, async (tx) => {
      const found = await tx.getSubject(subjectId);
      await appendAudit(tx, ctx, {
        action: ACTIONS.subjectRead,
        actionClass: 'READ',
        resourceType: SUBJECT_RESOURCE_TYPE,
        resourceId: subjectId,
        result: found ? 'SUCCESS' : 'FAILED',
        ...(found ? {} : { reason: 'SUBJECT_NOT_FOUND' }),
        now,
      });
      return found;
    });
    if (!row) throw new Cmp049Error('SF-SYS-002', detail('SUBJECT_NOT_FOUND'));
    return { status: 200, body: subjectView(row) };
  }

  /** Deterministic preview of every candidate transition; never changes state. */
  async evaluateSubject(ctx: TenantContext, subjectId: string): Promise<CommandResult> {
    const action = ACTIONS.subjectEvaluate;
    await this.guard(ctx, action, SUBJECT_RESOURCE_TYPE, subjectId, STAFF_ACTORS);
    const now = this.deps.clock();
    const found = await this.deps.repo.withTx(ctx, async (tx) => {
      const subject = await tx.getSubject(subjectId);
      const policy = subject ? await tx.getPolicy(subject.policy_id) : undefined;
      await appendAudit(tx, ctx, {
        action,
        actionClass: 'READ',
        resourceType: SUBJECT_RESOURCE_TYPE,
        resourceId: subjectId,
        result: subject && policy ? 'SUCCESS' : 'FAILED',
        ...(subject && policy ? {} : { reason: 'SUBJECT_NOT_FOUND' }),
        now,
      });
      return subject && policy ? { subject, policy } : undefined;
    });
    if (!found) throw new Cmp049Error('SF-SYS-002', detail('SUBJECT_NOT_FOUND'));
    const { subject, policy } = found;
    return {
      status: 200,
      body: {
        subject_id: subject.subject_id,
        eligibility: subject.eligibility,
        subject_version: subject.subject_version,
        policy_id: policy.policy_id,
        policy_version: policy.policy_version,
        owner_period_ref_bound: hasOwnerPeriodRef(policy.owner_supplied_period_ref),
        statutory_retention_policy_input_required: true,
        candidates: evaluateCandidates(policy, subject.eligibility),
      },
    };
  }

  /**
   * Moves a subject between eligibility states. OPA is asked before any transaction (including
   * the extra LEGAL_HOLD release grant, which needs the current state from a short read). The
   * write transaction then locks the row, pins expected_version and re-evaluates the policy, so
   * the state the PDP saw is the state that changes. Refusals fail closed and are audited.
   */
  async transitionSubject(
    ctx: TenantContext,
    subjectId: string,
    input: TransitionInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const to = input.to_eligibility;
    const primaryAction = `RETENTION_TRANSITION_${to}`;
    await this.guard(ctx, primaryAction, SUBJECT_RESOURCE_TYPE, subjectId, STAFF_ACTORS);
    const preview = await this.deps.repo.withTx(ctx, (tx) => tx.getSubject(subjectId));
    if (preview) {
      for (const action of transitionActions(preview.eligibility, to)) {
        if (action !== primaryAction) {
          await this.guard(ctx, action, SUBJECT_RESOURCE_TYPE, subjectId, STAFF_ACTORS);
        }
      }
    }
    return this.command(ctx, idem, async (tx, now) => {
      const subject = await tx.getSubject(subjectId, true);
      if (!subject) throw new Cmp049Error('SF-SYS-002', detail('SUBJECT_NOT_FOUND'));
      if (
        subject.subject_version !== input.expected_version ||
        !preview ||
        subject.subject_version !== preview.subject_version
      ) {
        throw new Cmp049Error('SF-APP-001', detail('STALE_VERSION', '/expected_version'));
      }
      const policy = await tx.getPolicy(subject.policy_id);
      if (!policy) throw new Cmp049Error('SF-SYS-002', detail('POLICY_NOT_FOUND'));
      const from: Eligibility = subject.eligibility;
      const verdict = evaluateTransition(policy, from, to);
      if (!verdict.allowed) {
        throw new AuditedRefusal(
          'SF-APP-001',
          verdict.reason,
          primaryAction,
          SUBJECT_RESOURCE_TYPE,
          subjectId,
        );
      }
      const next: RetentionSubjectRecord = {
        ...subject,
        eligibility: to,
        subject_version: subject.subject_version + 1,
        updated_at: now.toISOString(),
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateSubjectEligibility(next);
      await tx.insertTransition({
        tenant_id: ctx.tenant_id,
        transition_id: randomUUID(),
        subject_id: subjectId,
        policy_id: policy.policy_id,
        policy_version: policy.policy_version,
        from_eligibility: from,
        to_eligibility: to,
        owner_supplied_period_ref: policy.owner_supplied_period_ref,
        reason_code: input.reason_code,
        subject_version: next.subject_version,
        actor_id: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        transitioned_at: next.updated_at,
      });
      await this.emit(tx, ctx, {
        eventType: 'RetentionEligibilityChanged',
        aggregateType: SUBJECT_RESOURCE_TYPE,
        aggregateId: subjectId,
        aggregateVersion: next.subject_version,
        now,
        data: {
          subject_id: subjectId,
          policy_id: policy.policy_id,
          policy_version: policy.policy_version,
          resource_type: next.resource_type,
          resource_id: next.resource_id,
          from_eligibility: from,
          to_eligibility: to,
          subject_version: next.subject_version,
          owner_supplied_period_ref: policy.owner_supplied_period_ref,
        },
      });
      await appendAudit(tx, ctx, {
        action: primaryAction,
        actionClass: 'DECISION',
        resourceType: SUBJECT_RESOURCE_TYPE,
        resourceId: subjectId,
        result: 'SUCCESS',
        reason: `${from}->${to}`,
        now,
      });
      return { status: 200, body: subjectView(next) };
    });
  }
}
