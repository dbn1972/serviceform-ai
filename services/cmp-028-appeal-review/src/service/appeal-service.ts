import { randomUUID } from 'node:crypto';
import type { AuditParams } from '../audit.js';
import { appendAudit } from '../audit.js';
import {
  authzInput,
  decide,
  type AuthorizationPort,
  type AuthzRecord,
  type AppealResource,
} from '../authz.js';
import type { TenantContext } from '../context.js';
import {
  parseAuthority,
  rejectNamedOfficer,
  type AppellateAuthority,
} from '../domain/authority.js';
import {
  AUTHZ_ACTION,
  EVENT_TYPE,
  isAiActor,
  isForbiddenAiKind,
  isTerminal,
  NOTE_KINDS,
  type AdmissibilityCode,
  type AppealState,
  type NoteKind,
  type Operation,
} from '../domain/states.js';
import {
  assertOnlyKeys,
  codeField,
  CONTENT_REF,
  invalid,
  optionalCode,
  optionalUuid,
  requireRecord,
  uuidField,
  uuidList,
} from '../domain/validate.js';
import { Cmp028Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { CaseCommandPort, CaseCommandRequest } from '../ports/case-command.js';
import type { WorkflowLinkPort } from '../ports/workflow.js';
import type { AppealPatch, AppealRepository, AppealRow, AppealWriteTx } from '../repo/types.js';
import { guardOutboundPort } from '../tx-scope.js';
import { appealEventData, appealView, historyView, noteView, type AppealView } from './views.js';

export interface Idempotency {
  key: string;
  endpoint: string;
  fingerprint: string;
}

export interface ServiceResult<T = unknown> {
  status: number;
  body: T;
}

export interface AppealServiceDeps {
  repo: AppealRepository;
  authz: AuthorizationPort;
  caseCommands?: CaseCommandPort;
  workflow?: WorkflowLinkPort;
  clock?: () => Date;
  newId?: () => string;
}

const AI_PROTECTED: ReadonlySet<Operation> = new Set([
  'RECORD_ADMISSIBILITY',
  'RECORD_DECISION',
  'RECORD_REVIEW',
  'WITHDRAW',
  'CANCEL',
  'ASSIGN',
  'REASSIGN',
]);

function patchFrom(row: AppealRow, now: Date, extra: Partial<AppealPatch> = {}): AppealPatch {
  return {
    appeal_state: extra.appeal_state ?? row.appeal_state,
    admissibility_code: extra.admissibility_code ?? row.admissibility_code,
    admissibility_reason_code: extra.admissibility_reason_code ?? row.admissibility_reason_code,
    authority: extra.authority ?? row.authority,
    workflow_instance_id: extra.workflow_instance_id ?? row.workflow_instance_id,
    workflow_version_id: extra.workflow_version_id ?? row.workflow_version_id,
    hearing_ref: extra.hearing_ref ?? row.hearing_ref,
    review_ref: extra.review_ref ?? row.review_ref,
    decision_ref: extra.decision_ref ?? row.decision_ref,
    original_case_command_ref: extra.original_case_command_ref ?? row.original_case_command_ref,
    original_case_id: extra.original_case_id ?? row.original_case_id,
    original_decision_id: extra.original_decision_id ?? row.original_decision_id,
    evidence_refs: extra.evidence_refs ?? row.evidence_refs,
    expected_version: extra.expected_version ?? row.aggregate_version,
    now,
  };
}

export class AppealService {
  private readonly clock: () => Date;
  private readonly newId: () => string;
  private readonly caseCommands: CaseCommandPort | undefined;
  private readonly workflow: WorkflowLinkPort | undefined;

  constructor(private readonly deps: AppealServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
    this.caseCommands = deps.caseCommands
      ? guardOutboundPort('cmp-015-command', deps.caseCommands)
      : undefined;
    this.workflow = deps.workflow
      ? guardOutboundPort('cmp-016-workflow', deps.workflow)
      : undefined;
  }

  static parseFile(body: unknown): {
    original_application_id: string;
    original_case_id: string | null;
    original_decision_id: string | null;
    grounds_code: string;
    evidence_refs: string[];
    authority: AppellateAuthority;
    original_case_command: CaseCommandRequest | null;
    workflow_version_id: string | null;
  } {
    const obj = requireRecord(body, '');
    rejectNamedOfficerOnTop(obj);
    assertOnlyKeys(
      obj,
      [
        'original_application_id',
        'original_case_id',
        'original_decision_id',
        'grounds_code',
        'evidence_refs',
        'appellate_authority',
        'original_case_command',
        'workflow_version_id',
      ],
      '',
    );
    let original_case_command: CaseCommandRequest | null = null;
    if (obj['original_case_command'] !== undefined) {
      const c = requireRecord(obj['original_case_command'], '/original_case_command');
      assertOnlyKeys(c, ['command_type', 'expected_state'], '/original_case_command');
      original_case_command = {
        application_id: uuidField(obj, 'original_application_id', ''),
        command_type: codeField(c, 'command_type', '/original_case_command'),
        expected_state: codeField(c, 'expected_state', '/original_case_command'),
        idempotency_key: '',
        appeal_id: '',
      };
    }
    return {
      original_application_id: uuidField(obj, 'original_application_id', ''),
      original_case_id: optionalUuid(obj, 'original_case_id', ''),
      original_decision_id: optionalUuid(obj, 'original_decision_id', ''),
      grounds_code: codeField(obj, 'grounds_code', ''),
      evidence_refs: uuidList(obj, 'evidence_refs', ''),
      authority: parseAuthority(obj['appellate_authority']),
      original_case_command,
      workflow_version_id: optionalUuid(obj, 'workflow_version_id', ''),
    };
  }

  async fileAppeal(
    ctx: TenantContext,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<AppealView>> {
    this.guard(ctx);
    const input = AppealService.parseFile(body);
    const appealId = this.newId();
    this.rejectAi(ctx, 'FILE');
    const authz = await this.authorize(
      ctx,
      AUTHZ_ACTION.FILE,
      {
        appeal_id: appealId,
        application_id: input.original_application_id,
        authority: input.authority,
      },
      appealId,
    );
    const now = this.clock();
    const result = await this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, idem, now);
      if (replay) return replay as ServiceResult<AppealView>;
      const row = await tx.insertAppeal({
        appeal_id: appealId,
        original_application_id: input.original_application_id,
        original_case_id: input.original_case_id,
        original_decision_id: input.original_decision_id,
        cell_id: ctx.cell_id,
        grounds_code: input.grounds_code,
        evidence_refs: input.evidence_refs,
        authority: input.authority,
        created_by: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        now,
      });
      const out: ServiceResult<AppealView> = { status: 201, body: appealView(row) };
      await this.recordTransition(tx, ctx, {
        action: AUTHZ_ACTION.FILE,
        operation: 'FILE',
        before: null,
        after: row,
        authz,
        idem,
        now,
      });
      await this.finishIdempotency(tx, ctx, idem, out);
      return out;
    });

    if (input.original_case_command) {
      await this.dispatchCaseCommand(ctx, {
        ...input.original_case_command,
        application_id: input.original_application_id,
        appeal_id: result.body.appeal_id,
        idempotency_key: idem.key,
      });
    }
    if (input.workflow_version_id) {
      await this.dispatchWorkflow(ctx, result.body.appeal_id, input.original_application_id, {
        workflow_version_id: input.workflow_version_id,
        idempotency_key: idem.key,
      });
    }
    return result;
  }

  async getAppeal(ctx: TenantContext, appealId: string): Promise<AppealView> {
    this.guard(ctx);
    const row = await this.deps.repo.read(ctx, (tx) => tx.getAppeal(appealId));
    if (!row) throw new Cmp028Error('SF-SYS-002');
    await this.authorize(
      ctx,
      AUTHZ_ACTION.READ,
      {
        appeal_id: row.appeal_id,
        application_id: row.original_application_id,
        appeal_state: row.appeal_state,
        authority: row.authority,
      },
      appealId,
    );
    return appealView(row);
  }

  async getHistory(
    ctx: TenantContext,
    appealId: string,
  ): Promise<{ items: ReturnType<typeof historyView>[] }> {
    this.guard(ctx);
    const row = await this.deps.repo.read(ctx, (tx) => tx.getAppeal(appealId));
    if (!row) throw new Cmp028Error('SF-SYS-002');
    await this.authorize(
      ctx,
      AUTHZ_ACTION.READ,
      {
        appeal_id: row.appeal_id,
        application_id: row.original_application_id,
        appeal_state: row.appeal_state,
        authority: row.authority,
      },
      appealId,
    );
    const items = await this.deps.repo.read(ctx, (tx) => tx.listHistory(appealId));
    return { items: items.map(historyView) };
  }

  async recordAdmissibility(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<AppealView>> {
    const obj = requireRecord(body, '');
    assertOnlyKeys(obj, ['admissibility_code', 'reason_code'], '');
    const code = codeField(obj, 'admissibility_code', '');
    if (code !== 'ADMITTED' && code !== 'NOT_ADMITTED') throw invalid('/admissibility_code');
    const reason = optionalCode(obj, 'reason_code', '');
    return this.mutate(ctx, appealId, idem, 'RECORD_ADMISSIBILITY', (row) => {
      if (row.appeal_state !== 'FILED')
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      return patchFrom(row, this.clock(), {
        appeal_state: code as AppealState,
        admissibility_code: code as AdmissibilityCode,
        admissibility_reason_code: reason,
      });
    });
  }

  async assign(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
    operation: 'ASSIGN' | 'REASSIGN',
  ): Promise<ServiceResult<AppealView>> {
    const obj = requireRecord(body, '');
    rejectNamedOfficerOnTop(obj);
    assertOnlyKeys(obj, ['appellate_authority'], '');
    const authority = parseAuthority(obj['appellate_authority']);
    return this.mutate(ctx, appealId, idem, operation, (row) => {
      const allowed = operation === 'ASSIGN' ? ['ADMITTED', 'IN_REVIEW'] : ['IN_REVIEW'];
      if (!allowed.includes(row.appeal_state)) {
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      }
      return patchFrom(row, this.clock(), { appeal_state: 'IN_REVIEW', authority });
    });
  }

  async recordReview(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<AppealView>> {
    const obj = requireRecord(body, '');
    assertOnlyKeys(obj, ['review_ref'], '');
    const review_ref = uuidField(obj, 'review_ref', '');
    return this.mutate(ctx, appealId, idem, 'RECORD_REVIEW', (row) => {
      if (row.appeal_state !== 'IN_REVIEW' && row.appeal_state !== 'ADMITTED') {
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      }
      return patchFrom(row, this.clock(), { appeal_state: 'IN_REVIEW', review_ref });
    });
  }

  async recordHearing(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<AppealView>> {
    const obj = requireRecord(body, '');
    assertOnlyKeys(obj, ['hearing_ref'], '');
    const hearing_ref = uuidField(obj, 'hearing_ref', '');
    return this.mutate(ctx, appealId, idem, 'RECORD_HEARING', (row) => {
      if (row.appeal_state !== 'IN_REVIEW') {
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      }
      return patchFrom(row, this.clock(), { hearing_ref });
    });
  }

  async recordDecision(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<AppealView>> {
    const obj = requireRecord(body, '');
    assertOnlyKeys(obj, ['decision_ref', 'original_case_command'], '');
    const decision_ref = uuidField(obj, 'decision_ref', '');
    let queued: CaseCommandRequest | null = null;
    if (obj['original_case_command'] !== undefined) {
      const c = requireRecord(obj['original_case_command'], '/original_case_command');
      assertOnlyKeys(c, ['command_type', 'expected_state'], '/original_case_command');
      queued = {
        application_id: '',
        command_type: codeField(c, 'command_type', '/original_case_command'),
        expected_state: codeField(c, 'expected_state', '/original_case_command'),
        idempotency_key: idem.key,
        appeal_id: appealId,
      };
    }
    const result = await this.mutate(ctx, appealId, idem, 'RECORD_DECISION', (row) => {
      if (row.appeal_state !== 'IN_REVIEW') {
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      }
      return patchFrom(row, this.clock(), {
        appeal_state: 'DECISION_REFERENCED',
        decision_ref,
      });
    });
    if (queued) {
      await this.dispatchCaseCommand(ctx, {
        ...queued,
        application_id: result.body.original_application_id,
      });
    }
    return result;
  }

  async withdrawOrCancel(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
    operation: 'WITHDRAW' | 'CANCEL',
  ): Promise<ServiceResult<AppealView>> {
    const obj = requireRecord(body, '');
    assertOnlyKeys(obj, ['reason_code'], '');
    optionalCode(obj, 'reason_code', '');
    return this.mutate(ctx, appealId, idem, operation, (row) => {
      if (!['FILED', 'ADMITTED', 'IN_REVIEW'].includes(row.appeal_state)) {
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      }
      return patchFrom(row, this.clock(), {
        appeal_state: operation === 'WITHDRAW' ? 'WITHDRAWN' : 'CANCELLED',
      });
    });
  }

  async linkWorkflow(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<AppealView>> {
    const obj = requireRecord(body, '');
    assertOnlyKeys(obj, ['workflow_version_id'], '');
    const workflow_version_id = uuidField(obj, 'workflow_version_id', '');
    const current = await this.deps.repo.read(ctx, (tx) => tx.getAppeal(appealId));
    if (!current) throw new Cmp028Error('SF-SYS-002');
    if (!this.workflow) throw new Cmp028Error('SF-SYS-001', detail('WORKFLOW_PORT_REQUIRED'));
    const linked = await this.workflow.link(ctx, {
      appeal_id: appealId,
      application_id: current.original_application_id,
      workflow_version_id,
      idempotency_key: idem.key,
    });
    return this.mutate(ctx, appealId, idem, 'LINK_WORKFLOW', (row) => {
      if (!['FILED', 'ADMITTED', 'IN_REVIEW'].includes(row.appeal_state)) {
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      }
      return patchFrom(row, this.clock(), {
        workflow_version_id,
        workflow_instance_id: linked.workflow_instance_id,
      });
    });
  }

  async addAssistNote(
    ctx: TenantContext,
    appealId: string,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<ReturnType<typeof noteView>>> {
    this.guard(ctx);
    const obj = requireRecord(body, '');
    assertOnlyKeys(obj, ['note_kind', 'content_ref'], '');
    const note_kind = codeField(obj, 'note_kind', '');
    if (isForbiddenAiKind(note_kind) || !(NOTE_KINDS as readonly string[]).includes(note_kind)) {
      throw new Cmp028Error('SF-SYS-003', detail('AI_DECISION_FORBIDDEN', '/note_kind'));
    }
    const content_ref = obj['content_ref'];
    if (typeof content_ref !== 'string' || !CONTENT_REF.test(content_ref)) {
      throw invalid('/content_ref');
    }
    const now = this.clock();
    const existing = await this.deps.repo.read(ctx, (tx) => tx.getAppeal(appealId));
    if (!existing) throw new Cmp028Error('SF-SYS-002');
    await this.authorize(
      ctx,
      AUTHZ_ACTION.AI_ASSIST,
      {
        appeal_id: existing.appeal_id,
        application_id: existing.original_application_id,
        appeal_state: existing.appeal_state,
        authority: existing.authority,
      },
      appealId,
    );
    return this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, idem, now);
      if (replay) return replay as ServiceResult<ReturnType<typeof noteView>>;
      const row = await tx.lockAppeal(appealId);
      if (!row) throw new Cmp028Error('SF-SYS-002');
      const note = await tx.insertNote({
        note_id: this.newId(),
        appeal_id: appealId,
        note_kind: note_kind as NoteKind,
        content_ref,
        created_by: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        now,
      });
      await appendAudit(tx, ctx, {
        action: AUTHZ_ACTION.AI_ASSIST,
        actionClass: 'READ',
        resourceId: appealId,
        result: 'SUCCESS',
        authz: null,
        reason: `note_kind=${note_kind};not_a_legal_outcome`,
        now,
      });
      const out = { status: 201, body: noteView(note) };
      await this.finishIdempotency(tx, ctx, idem, out);
      return out;
    });
  }

  private async mutate(
    ctx: TenantContext,
    appealId: string,
    idem: Idempotency,
    operation: Operation,
    plan: (row: AppealRow) => AppealPatch,
  ): Promise<ServiceResult<AppealView>> {
    this.guard(ctx);
    this.rejectAi(ctx, operation);
    const now = this.clock();
    const existing = await this.deps.repo.read(ctx, (tx) => tx.getAppeal(appealId));
    if (!existing) throw new Cmp028Error('SF-SYS-002');
    if (isTerminal(existing.appeal_state)) {
      throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
    }
    const authz = await this.authorize(
      ctx,
      AUTHZ_ACTION[operation],
      {
        appeal_id: existing.appeal_id,
        application_id: existing.original_application_id,
        appeal_state: existing.appeal_state,
        authority: existing.authority,
      },
      appealId,
    );
    return this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, idem, now);
      if (replay) return replay as ServiceResult<AppealView>;
      const before = await tx.lockAppeal(appealId);
      if (!before) throw new Cmp028Error('SF-SYS-002');
      if (isTerminal(before.appeal_state)) {
        throw new Cmp028Error('SF-APP-001', detail('APPEAL_STATE_CONFLICT'));
      }
      const patch = plan(before);
      const after = await tx.updateAppeal(appealId, patch);
      const out: ServiceResult<AppealView> = { status: 200, body: appealView(after) };
      await this.recordTransition(tx, ctx, {
        action: AUTHZ_ACTION[operation],
        operation,
        before,
        after,
        authz,
        idem,
        now,
      });
      await this.finishIdempotency(tx, ctx, idem, out);
      return out;
    });
  }

  private async dispatchCaseCommand(ctx: TenantContext, req: CaseCommandRequest): Promise<void> {
    if (!this.caseCommands)
      throw new Cmp028Error('SF-SYS-001', detail('CASE_COMMAND_PORT_REQUIRED'));
    await this.caseCommands.apply(ctx, req);
  }

  private async dispatchWorkflow(
    ctx: TenantContext,
    appealId: string,
    applicationId: string,
    req: { workflow_version_id: string; idempotency_key: string },
  ): Promise<void> {
    if (!this.workflow) throw new Cmp028Error('SF-SYS-001', detail('WORKFLOW_PORT_REQUIRED'));
    const linked = await this.workflow.link(ctx, {
      appeal_id: appealId,
      application_id: applicationId,
      workflow_version_id: req.workflow_version_id,
      idempotency_key: req.idempotency_key,
    });
    await this.deps.repo.write(ctx, async (tx) => {
      const row = await tx.lockAppeal(appealId);
      if (!row) throw new Cmp028Error('SF-SYS-002');
      await tx.updateAppeal(
        appealId,
        patchFrom(row, this.clock(), {
          workflow_instance_id: linked.workflow_instance_id,
          workflow_version_id: req.workflow_version_id,
        }),
      );
    });
  }

  private guard(ctx: TenantContext): void {
    if (!ctx.tenant_id) throw new Cmp028Error('SF-TEN-001');
  }

  private rejectAi(ctx: TenantContext, operation: Operation): void {
    if (isAiActor(ctx.roles) && AI_PROTECTED.has(operation)) {
      throw new Cmp028Error('SF-SYS-003', detail('AI_DECISION_FORBIDDEN'));
    }
  }

  private async authorize(
    ctx: TenantContext,
    action: string,
    resource: AppealResource,
    resourceId: string,
  ): Promise<AuthzRecord> {
    const record = await decide(this.deps.authz, authzInput(ctx, action, resource));
    if (!record.allow) {
      await this.deps.repo.write(ctx, async (tx) => {
        const denied: AuditParams = {
          action,
          actionClass: 'WRITE',
          resourceId,
          result: 'DENIED',
          authz: record,
          now: this.clock(),
        };
        if (resource.authority?.organisation_id) {
          denied.organisationId = resource.authority.organisation_id;
        }
        if (resource.authority?.jurisdiction_id) {
          denied.jurisdictionId = resource.authority.jurisdiction_id;
        }
        await appendAudit(tx, ctx, denied);
      });
      throw new Cmp028Error('SF-AUTH-002');
    }
    return record;
  }

  private async claimIdempotency(
    tx: AppealWriteTx,
    ctx: TenantContext,
    idem: Idempotency,
    now: Date,
  ): Promise<ServiceResult | null> {
    const claimed = await tx.claimIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      fingerprint: idem.fingerprint,
      now,
    });
    if (claimed === 'claimed') return null;
    return claimed;
  }

  private async finishIdempotency(
    tx: AppealWriteTx,
    ctx: TenantContext,
    idem: Idempotency,
    result: ServiceResult,
  ): Promise<void> {
    await tx.completeIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      status: result.status,
      body: result.body,
    });
  }

  private async recordTransition(
    tx: AppealWriteTx,
    ctx: TenantContext,
    p: {
      action: string;
      operation: Operation;
      before: AppealRow | null;
      after: AppealRow;
      authz: AuthzRecord;
      idem: Idempotency;
      now: Date;
    },
  ): Promise<void> {
    await tx.insertHistory({
      history_id: this.newId(),
      appeal_id: p.after.appeal_id,
      operation: p.operation,
      from_state: p.before?.appeal_state ?? null,
      to_state: p.after.appeal_state,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      authority: p.after.authority,
      admissibility_code: p.after.admissibility_code,
      review_ref: p.after.review_ref,
      hearing_ref: p.after.hearing_ref,
      decision_ref: p.after.decision_ref,
      authz_decision_id: p.authz.decision_id,
      policy_revision: p.authz.policy_revision,
      idempotency_key: p.idem.key,
      correlation_id: ctx.correlation_id,
      now: p.now,
    });
    const env = envelopeOf({
      eventType: EVENT_TYPE[p.operation],
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'Appeal',
      aggregateId: p.after.appeal_id,
      aggregateVersion: p.after.aggregate_version,
      occurredAt: p.now.toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: appealEventData({
        operation: p.operation,
        appeal: p.after,
        authzDecisionId: p.authz.decision_id,
        idempotencyKey: p.idem.key,
        correlationId: ctx.correlation_id,
      }),
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
    await appendAudit(tx, ctx, {
      action: p.action,
      actionClass:
        p.operation === 'RECORD_ADMISSIBILITY' || p.operation === 'RECORD_DECISION'
          ? 'DECISION'
          : 'WRITE',
      resourceId: p.after.appeal_id,
      result: 'SUCCESS',
      authz: p.authz,
      organisationId: p.after.authority.organisation_id,
      jurisdictionId: p.after.authority.jurisdiction_id,
      afterRef: p.after.appeal_id,
      now: p.now,
    });
  }
}

function rejectNamedOfficerOnTop(obj: Record<string, unknown>): void {
  rejectNamedOfficer(obj, '');
}
