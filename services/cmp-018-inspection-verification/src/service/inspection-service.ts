import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authzInput,
  decide,
  type AuthorizationPort,
  type AuthzRecord,
  type InspectionResource,
} from '../authz.js';
import type { TenantContext } from '../context.js';
import {
  parseAssignment,
  rejectNamedOfficer,
  sameAssignment,
  type Assignment,
} from '../domain/assignment.js';
import { mismatches, scopeFromContext, type PrincipalScope } from '../domain/resolution.js';
import {
  assertNotAiFinal,
  assertNotStatutoryCaseCommand,
  parseVerificationResult,
  type VerificationResult,
} from '../domain/result.js';
import { parseSchedule, type ScheduleMeta } from '../domain/scheduling.js';
import { assertSimulationPolicy, simulationMarkerOf } from '../domain/simulation.js';
import {
  AUTHZ_ACTION,
  EVENT_TYPE,
  canApply,
  isTerminal,
  targetState,
  type Operation,
} from '../domain/states.js';
import {
  assertOnlyKeys,
  codeField,
  invalid,
  NODE_ID,
  optionalUuid,
  REF,
  requireRecord,
  uuidField,
} from '../domain/validate.js';
import { Cmp018Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import { noopCaseCommand, type CaseCommandPort } from '../ports/case-command.js';
import type { DigiLockerPort } from '../ports/digilocker.js';
import type { EvidencePort } from '../ports/evidence.js';
import type { OcrPort } from '../ports/ocr.js';
import type { PrincipalScopePort } from '../ports/principal-scope.js';
import type {
  InspectionPatch,
  InspectionRepository,
  InspectionRow,
  InspectionWriteTx,
} from '../repo/types.js';
import { guardOutboundPort } from '../tx-scope.js';
import { inspectionEventData, inspectionView, type InspectionView } from './views.js';

export interface Idempotency {
  key: string;
  endpoint: string;
  fingerprint: string;
}

export interface ServiceResult<T = unknown> {
  status: number;
  body: T;
}

export interface InspectionServiceDeps {
  repo: InspectionRepository;
  authz: AuthorizationPort;
  scopes: PrincipalScopePort;
  evidence?: EvidencePort;
  ocr?: OcrPort;
  digilocker?: DigiLockerPort;
  caseCommands?: CaseCommandPort;
  clock?: () => Date;
  newId?: () => string;
}

export const MAX_PAGE = 200;
export const DEFAULT_PAGE = 50;

const CHECKLIST_STATES = ['PENDING', 'SATISFIED', 'NOT_SATISFIED', 'NOT_APPLICABLE'] as const;
const FINDING_SEV = ['INFO', 'ADVISORY', 'MATERIAL'] as const;

export class InspectionService {
  private readonly clock: () => Date;
  private readonly newId: () => string;
  private readonly caseCommands: CaseCommandPort;
  private readonly evidence: EvidencePort | undefined;
  private readonly ocr: OcrPort | undefined;
  private readonly digilocker: DigiLockerPort | undefined;

  constructor(private readonly deps: InspectionServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
    this.caseCommands = guardOutboundPort('case-command', deps.caseCommands ?? noopCaseCommand);
    this.evidence = deps.evidence ? guardOutboundPort('evidence', deps.evidence) : undefined;
    this.ocr = deps.ocr ? guardOutboundPort('ocr', deps.ocr) : undefined;
    this.digilocker = deps.digilocker
      ? guardOutboundPort('digilocker', deps.digilocker)
      : undefined;
  }

  static parseCreate(body: unknown): {
    application_id: string;
    workflow_node_id: string | null;
    assignment: Assignment;
  } {
    const obj = requireRecord(body, '');
    rejectTop(obj);
    assertOnlyKeys(obj, ['application_id', 'workflow_node_id', 'assignment'], '');
    const node = obj['workflow_node_id'];
    if (node !== undefined && (typeof node !== 'string' || !NODE_ID.test(node))) {
      throw invalid('/workflow_node_id');
    }
    return {
      application_id: uuidField(obj, 'application_id', ''),
      workflow_node_id: node === undefined ? null : (node as string),
      assignment: parseAssignment(obj['assignment']),
    };
  }

  async createInspection(
    ctx: TenantContext,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<InspectionView>> {
    this.guard(ctx);
    const input = InspectionService.parseCreate(body);
    const inspectionId = this.newId();
    const resource: InspectionResource = {
      inspection_id: inspectionId,
      application_id: input.application_id,
      workflow_node_id: input.workflow_node_id,
      assignment: input.assignment,
    };
    const authz = await this.authorize(ctx, AUTHZ_ACTION.CREATE, resource, inspectionId);
    const now = this.clock();
    return this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, idem, now);
      if (replay) return replay as ServiceResult<InspectionView>;
      const row = await tx.insertInspection({
        inspection_id: inspectionId,
        application_id: input.application_id,
        prior_inspection_id: null,
        workflow_node_id: input.workflow_node_id,
        cell_id: ctx.cell_id,
        assignment: input.assignment,
        created_by: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        now,
      });
      const result: ServiceResult<InspectionView> = { status: 201, body: inspectionView(row) };
      await this.record(tx, ctx, {
        action: AUTHZ_ACTION.CREATE,
        operation: 'CREATE',
        before: null,
        after: row,
        authz,
        idem,
        now,
      });
      await this.finishIdempotency(tx, ctx, idem, result);
      return result;
    });
  }

  async schedule(ctx: TenantContext, inspectionId: string, body: unknown, idem: Idempotency) {
    return this.mutate(ctx, {
      operation: 'SCHEDULE',
      inspectionId,
      idem,
      schedule: parseSchedule(body),
    });
  }

  async reassign(ctx: TenantContext, inspectionId: string, body: unknown, idem: Idempotency) {
    const obj = requireRecord(body, '');
    rejectTop(obj);
    assertOnlyKeys(obj, ['assignment'], '');
    return this.mutate(ctx, {
      operation: 'REASSIGN',
      inspectionId,
      idem,
      target: parseAssignment(obj['assignment']),
    });
  }

  async start(ctx: TenantContext, inspectionId: string, idem: Idempotency) {
    return this.mutate(ctx, { operation: 'START', inspectionId, idem });
  }

  async recordChecklist(
    ctx: TenantContext,
    inspectionId: string,
    body: unknown,
    idem: Idempotency,
  ) {
    const obj = requireRecord(body, '');
    rejectTop(obj);
    assertOnlyKeys(obj, ['item_code', 'item_state', 'required'], '');
    const item_state = codeField(obj, 'item_state', '');
    if (!(CHECKLIST_STATES as readonly string[]).includes(item_state)) {
      throw invalid('/item_state');
    }
    return this.mutate(ctx, {
      operation: 'RECORD_CHECKLIST',
      inspectionId,
      idem,
      checklist: {
        item_code: codeField(obj, 'item_code', ''),
        item_state,
        required: obj['required'] === undefined ? true : obj['required'] === true,
      },
    });
  }

  async recordObservation(
    ctx: TenantContext,
    inspectionId: string,
    body: unknown,
    idem: Idempotency,
  ) {
    const obj = requireRecord(body, '');
    rejectTop(obj);
    assertOnlyKeys(obj, ['item_code', 'note_ref', 'geo_ref'], '');
    const note = obj['note_ref'];
    const geo = obj['geo_ref'];
    if (typeof note !== 'string' || !REF.test(note)) throw invalid('/note_ref');
    if (geo !== undefined && (typeof geo !== 'string' || !REF.test(geo))) throw invalid('/geo_ref');
    return this.mutate(ctx, {
      operation: 'RECORD_OBSERVATION',
      inspectionId,
      idem,
      observation: {
        item_code: codeField(obj, 'item_code', ''),
        note_ref: note,
        geo_ref: geo === undefined ? null : geo,
      },
    });
  }

  async attachEvidence(ctx: TenantContext, inspectionId: string, body: unknown, idem: Idempotency) {
    const obj = requireRecord(body, '');
    rejectTop(obj);
    assertOnlyKeys(
      obj,
      ['evidence_id', 'document_id', 'ocr_job_id', 'digilocker_document_ref'],
      '',
    );
    const evidence_id = optionalUuid(obj, 'evidence_id', '');
    const document_id = optionalUuid(obj, 'document_id', '');
    const ocr_job_id = optionalUuid(obj, 'ocr_job_id', '');
    const digiRef = obj['digilocker_document_ref'];
    if (!evidence_id && !document_id && typeof digiRef !== 'string') {
      throw invalid('', 'EVIDENCE_REF_REQUIRED');
    }
    let technical_acceptance: 'PENDING' | 'ACCEPTED' | 'REJECTED_TECHNICAL' = 'PENDING';
    let simulation_marker: Record<string, unknown> | null = null;
    let resolvedDocument = document_id;
    if (this.evidence && (evidence_id || document_id)) {
      const view = await this.evidence.lookup(ctx.tenant_id, {
        ...(evidence_id ? { evidence_id } : {}),
        ...(document_id ? { document_id } : {}),
      });
      technical_acceptance = view.technical_acceptance;
    }
    if (ocr_job_id) {
      if (!this.ocr) throw new Cmp018Error('SF-SYS-002', detail('OCR_PORT_UNCONFIGURED'));
      await this.ocr.lookup(ctx.tenant_id, ocr_job_id);
    }
    if (typeof digiRef === 'string') {
      if (!this.digilocker) {
        throw new Cmp018Error('SF-INT-001', detail('DIGILOCKER_UNCONFIGURED'));
      }
      const binding = this.digilocker.binding();
      assertSimulationPolicy([binding]);
      const fetched = await this.digilocker.lookup(ctx.tenant_id, { document_ref: digiRef });
      resolvedDocument = fetched.document_id;
      simulation_marker = fetched.simulation_marker
        ? fetched.simulation_marker
        : (simulationMarkerOf(binding) ?? null);
    }
    return this.mutate(ctx, {
      operation: 'ATTACH_EVIDENCE',
      inspectionId,
      idem,
      evidence: {
        evidence_id,
        document_id: resolvedDocument,
        ocr_job_id,
        technical_acceptance,
        simulation_marker,
      },
    });
  }

  async recordFinding(ctx: TenantContext, inspectionId: string, body: unknown, idem: Idempotency) {
    const obj = requireRecord(body, '');
    rejectTop(obj);
    assertOnlyKeys(obj, ['finding_code', 'severity', 'related_item_code'], '');
    const severity = codeField(obj, 'severity', '');
    if (!(FINDING_SEV as readonly string[]).includes(severity)) throw invalid('/severity');
    return this.mutate(ctx, {
      operation: 'RECORD_FINDING',
      inspectionId,
      idem,
      finding: {
        finding_code: codeField(obj, 'finding_code', ''),
        severity,
        related_item_code: obj['related_item_code']
          ? codeField(obj, 'related_item_code', '')
          : null,
      },
    });
  }

  async recordResult(ctx: TenantContext, inspectionId: string, body: unknown, idem: Idempotency) {
    assertNotAiFinal(ctx.actor.type);
    const verification_result = parseVerificationResult(body);
    return this.mutate(ctx, {
      operation: 'RECORD_RESULT',
      inspectionId,
      idem,
      verification_result,
    });
  }

  async complete(ctx: TenantContext, inspectionId: string, idem: Idempotency) {
    assertNotAiFinal(ctx.actor.type);
    const result = await this.mutate(ctx, { operation: 'COMPLETE', inspectionId, idem });
    const body = result.body as InspectionView;
    if (body.verification_result) {
      const commandType = 'ENTER_VERIFICATION';
      assertNotStatutoryCaseCommand(commandType);
      await this.caseCommands.submit({
        tenant_id: ctx.tenant_id,
        application_id: body.application_id,
        command_type: commandType,
        inspection_id: body.inspection_id,
        verification_result: body.verification_result,
        statutory_effect: false,
        domain_committed: true,
        open_domain_txn_has_temporal_network: false,
        idempotency_key: idem.key,
        correlation_id: ctx.correlation_id,
        authz_decision_id: 'post-commit',
        authz_policy_revision: 'post-commit',
      });
    }
    return result;
  }

  async cancel(ctx: TenantContext, inspectionId: string, idem: Idempotency) {
    return this.mutate(ctx, { operation: 'CANCEL', inspectionId, idem });
  }

  async reinspect(ctx: TenantContext, inspectionId: string, body: unknown, idem: Idempotency) {
    this.guard(ctx);
    const parent = await this.load(ctx, inspectionId);
    if (parent.inspection_state !== 'COMPLETED') {
      throw new Cmp018Error('SF-APP-001', detail('REINSPECT_REQUIRES_COMPLETED'));
    }
    const obj = body === undefined || body === null ? {} : requireRecord(body, '');
    rejectTop(obj as Record<string, unknown>);
    assertOnlyKeys(obj as Record<string, unknown>, ['assignment'], '');
    const assignment =
      (obj as Record<string, unknown>)['assignment'] !== undefined
        ? parseAssignment((obj as Record<string, unknown>)['assignment'])
        : parent.assignment;
    const authz = await this.authorize(
      ctx,
      AUTHZ_ACTION.REINSPECT,
      resourceOf(parent),
      parent.inspection_id,
    );
    const now = this.clock();
    const childId = this.newId();
    return this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, idem, now);
      if (replay) return replay as ServiceResult<InspectionView>;
      const row = await tx.insertInspection({
        inspection_id: childId,
        application_id: parent.application_id,
        prior_inspection_id: parent.inspection_id,
        workflow_node_id: parent.workflow_node_id,
        cell_id: ctx.cell_id,
        assignment,
        created_by: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        now,
      });
      const result: ServiceResult<InspectionView> = { status: 201, body: inspectionView(row) };
      await this.record(tx, ctx, {
        action: AUTHZ_ACTION.REINSPECT,
        operation: 'REINSPECT',
        before: parent,
        after: row,
        authz,
        idem,
        now,
      });
      await this.finishIdempotency(tx, ctx, idem, result);
      return result;
    });
  }

  async getInspection(ctx: TenantContext, inspectionId: string): Promise<InspectionView> {
    const row = await this.load(ctx, inspectionId);
    await this.authorize(ctx, 'INSPECTION_READ', resourceOf(row), row.inspection_id);
    return inspectionView(row);
  }

  async getHistory(ctx: TenantContext, inspectionId: string) {
    const row = await this.load(ctx, inspectionId);
    await this.authorize(ctx, 'INSPECTION_READ_HISTORY', resourceOf(row), row.inspection_id);
    const items = await this.deps.repo.read(ctx, (tx) => tx.listHistory(inspectionId));
    return { items };
  }

  async getDetail(ctx: TenantContext, inspectionId: string) {
    const row = await this.load(ctx, inspectionId);
    await this.authorize(ctx, 'INSPECTION_READ', resourceOf(row), row.inspection_id);
    return this.deps.repo.read(ctx, async (tx) => ({
      inspection: inspectionView(row),
      checklist: await tx.listChecklist(inspectionId),
      observations: await tx.listObservations(inspectionId),
      evidence: await tx.listEvidence(inspectionId),
      findings: await tx.listFindings(inspectionId),
    }));
  }

  async listAvailable(
    ctx: TenantContext,
    limit = DEFAULT_PAGE,
  ): Promise<{ items: InspectionView[] }> {
    this.guard(ctx);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw invalid('/limit');
    await this.authorize(ctx, 'INSPECTION_LIST', {}, 'availability');
    const scope = await this.scopeOf(ctx);
    const rows = await this.deps.repo.read(ctx, (tx) => tx.listAvailable(scope, limit));
    return { items: rows.map(inspectionView) };
  }

  private async scopeOf(ctx: TenantContext): Promise<PrincipalScope> {
    return scopeFromContext(ctx, await this.deps.scopes.extend(ctx));
  }

  private guard(ctx: TenantContext): void {
    if (ctx.tenant_id === null || ctx.tenant_id === undefined) {
      throw new Cmp018Error('SF-TEN-001', { statusCode: 401 });
    }
  }

  private async load(ctx: TenantContext, inspectionId: string): Promise<InspectionRow> {
    this.guard(ctx);
    if (!/^[0-9a-f-]{36}$/.test(inspectionId)) throw invalid('/inspection_id');
    const row = await this.deps.repo.read(ctx, (tx) => tx.getInspection(inspectionId));
    if (!row) throw new Cmp018Error('SF-SYS-002');
    return row;
  }

  private async mutate(
    ctx: TenantContext,
    plan: {
      operation: Exclude<Operation, 'CREATE' | 'REINSPECT'>;
      inspectionId: string;
      idem: Idempotency;
      schedule?: ScheduleMeta;
      target?: Assignment;
      verification_result?: VerificationResult;
      checklist?: { item_code: string; item_state: string; required: boolean };
      observation?: { item_code: string; note_ref: string; geo_ref: string | null };
      evidence?: {
        evidence_id: string | null;
        document_id: string | null;
        ocr_job_id: string | null;
        technical_acceptance: 'PENDING' | 'ACCEPTED' | 'REJECTED_TECHNICAL';
        simulation_marker: Record<string, unknown> | null;
      };
      finding?: { finding_code: string; severity: string; related_item_code: string | null };
    },
  ): Promise<ServiceResult<InspectionView>> {
    const snapshot = await this.load(ctx, plan.inspectionId);
    const action = AUTHZ_ACTION[plan.operation];
    const authz = await this.authorize(ctx, action, resourceOf(snapshot), snapshot.inspection_id);
    if (plan.operation === 'REASSIGN' && plan.target) {
      await this.authorize(
        ctx,
        action,
        { ...resourceOf(snapshot), assignment: plan.target },
        snapshot.inspection_id,
      );
    }
    if (isTerminal(snapshot.inspection_state)) {
      throw new Cmp018Error('SF-APP-001', detail('INSPECTION_TERMINAL'));
    }
    if (plan.operation === 'START' || plan.operation === 'COMPLETE') {
      const miss = mismatches(snapshot.assignment, await this.scopeOf(ctx));
      if (miss.length > 0) {
        await this.auditDenied(
          ctx,
          action,
          snapshot,
          authz,
          `assignment_mismatch=${miss.join(',')}`,
        );
        throw new Cmp018Error('SF-AUTH-002', detail('ASSIGNMENT_MISMATCH'));
      }
    }
    if (
      (plan.operation === 'COMPLETE' ||
        plan.operation === 'RECORD_RESULT' ||
        plan.operation === 'RECORD_CHECKLIST' ||
        plan.operation === 'RECORD_OBSERVATION' ||
        plan.operation === 'ATTACH_EVIDENCE' ||
        plan.operation === 'RECORD_FINDING') &&
      snapshot.claimed_principal_id !== ctx.actor.id
    ) {
      await this.auditDenied(ctx, action, snapshot, authz, 'not_claimant');
      throw new Cmp018Error('SF-AUTH-002', detail('NOT_CLAIMANT'));
    }
    const now = this.clock();
    return this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, plan.idem, now);
      if (replay) return replay as ServiceResult<InspectionView>;
      const locked = await tx.lockInspection(plan.inspectionId);
      if (!locked) throw new Cmp018Error('SF-SYS-002');
      if (locked.aggregate_version !== snapshot.aggregate_version) {
        throw new Cmp018Error('SF-APP-001', detail('STALE_INSPECTION_VERSION'));
      }
      if (isTerminal(locked.inspection_state)) {
        throw new Cmp018Error('SF-APP-001', detail('INSPECTION_TERMINAL'));
      }
      if (!canApply(plan.operation, locked.inspection_state)) {
        throw new Cmp018Error('SF-APP-001', detail('INSPECTION_STATE_CONFLICT'));
      }
      if (
        plan.operation === 'COMPLETE' &&
        !locked.verification_result &&
        !plan.verification_result
      ) {
        throw new Cmp018Error('SF-SYS-003', detail('VERIFICATION_RESULT_REQUIRED'));
      }
      if (
        plan.operation === 'REASSIGN' &&
        plan.target &&
        sameAssignment(plan.target, locked.assignment)
      ) {
        throw new Cmp018Error('SF-APP-001', detail('ASSIGNMENT_UNCHANGED'));
      }
      const after = await tx.updateInspection(
        plan.inspectionId,
        this.patchFor(ctx, plan, locked, now),
      );
      if (plan.checklist) {
        await tx.upsertChecklistItem({
          item_id: this.newId(),
          inspection_id: after.inspection_id,
          ...plan.checklist,
          now,
        });
      }
      if (plan.observation) {
        await tx.insertObservation({
          observation_id: this.newId(),
          inspection_id: after.inspection_id,
          ...plan.observation,
          captured_at: now,
          actor_id: ctx.actor.id,
        });
      }
      if (plan.evidence) {
        await tx.insertEvidenceRef({
          evidence_ref_id: this.newId(),
          inspection_id: after.inspection_id,
          ...plan.evidence,
        });
      }
      if (plan.finding) {
        await tx.insertFinding({
          finding_id: this.newId(),
          inspection_id: after.inspection_id,
          ...plan.finding,
        });
      }
      await this.record(tx, ctx, {
        action,
        operation: plan.operation,
        before: locked,
        after,
        authz,
        idem: plan.idem,
        now,
      });
      const result: ServiceResult<InspectionView> = { status: 200, body: inspectionView(after) };
      await this.finishIdempotency(tx, ctx, plan.idem, result);
      return result;
    });
  }

  private patchFor(
    ctx: TenantContext,
    plan: {
      operation: Exclude<Operation, 'CREATE' | 'REINSPECT'>;
      schedule?: ScheduleMeta;
      target?: Assignment;
      verification_result?: VerificationResult;
    },
    row: InspectionRow,
    now: Date,
  ): InspectionPatch {
    const schedule: ScheduleMeta = {
      window_start: row.schedule.window_start ? new Date(row.schedule.window_start) : null,
      window_end: row.schedule.window_end ? new Date(row.schedule.window_end) : null,
      slot_ref: row.schedule.slot_ref,
      location_ref: row.schedule.location_ref,
      timezone_iana: row.schedule.timezone_iana,
    };
    const base: InspectionPatch = {
      inspection_state: targetState(plan.operation, row.inspection_state),
      assignment: row.assignment,
      claimed_principal_id: row.claimed_principal_id,
      claimed_at: row.claimed_at ? new Date(row.claimed_at) : null,
      schedule,
      verification_result: row.verification_result,
      expected_version: row.aggregate_version,
      now,
    };
    switch (plan.operation) {
      case 'SCHEDULE':
        return { ...base, schedule: plan.schedule ?? schedule };
      case 'REASSIGN':
        return {
          ...base,
          assignment: plan.target ?? row.assignment,
          claimed_principal_id: null,
          claimed_at: null,
        };
      case 'START':
        return { ...base, claimed_principal_id: ctx.actor.id, claimed_at: now };
      case 'RECORD_RESULT':
        return {
          ...base,
          verification_result: plan.verification_result ?? row.verification_result,
        };
      case 'COMPLETE':
        return {
          ...base,
          verification_result: plan.verification_result ?? row.verification_result,
        };
      case 'CANCEL':
        return base;
      default:
        return base;
    }
  }

  private async authorize(
    ctx: TenantContext,
    action: string,
    resource: InspectionResource,
    resourceId: string,
  ): Promise<AuthzRecord> {
    const record = await decide(this.deps.authz, authzInput(ctx, action, resource));
    if (!record.allow) {
      await this.writeDeniedAudit(ctx, {
        action,
        resourceId,
        authz: record,
        organisationId: resource.assignment?.organisation_id,
        jurisdictionId: resource.assignment?.jurisdiction_id,
      });
      throw new Cmp018Error('SF-AUTH-002', detail('POLICY_DENIED'));
    }
    return record;
  }

  private async auditDenied(
    ctx: TenantContext,
    action: string,
    row: InspectionRow,
    authz: AuthzRecord,
    reason: string,
  ): Promise<void> {
    await this.writeDeniedAudit(ctx, {
      action,
      resourceId: row.inspection_id,
      authz,
      reason,
      organisationId: row.assignment.organisation_id,
      jurisdictionId: row.assignment.jurisdiction_id,
    });
  }

  private async writeDeniedAudit(
    ctx: TenantContext,
    p: {
      action: string;
      resourceId: string;
      authz: AuthzRecord;
      reason?: string;
      organisationId: string | undefined;
      jurisdictionId: string | undefined;
    },
  ): Promise<void> {
    try {
      const now = this.clock();
      await this.deps.repo.write(ctx, (tx) =>
        appendAudit(tx, ctx, {
          action: p.action,
          actionClass: 'WRITE',
          resourceId: p.resourceId,
          result: 'DENIED',
          authz: p.authz,
          ...(p.reason ? { reason: p.reason } : {}),
          ...(p.organisationId ? { organisationId: p.organisationId } : {}),
          ...(p.jurisdictionId ? { jurisdictionId: p.jurisdictionId } : {}),
          now,
        }),
      );
    } catch {
      // Denial stands.
    }
  }

  private async claimIdempotency(
    tx: InspectionWriteTx,
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
    return claimed === 'claimed' ? null : { status: claimed.status, body: claimed.body };
  }

  private async finishIdempotency(
    tx: InspectionWriteTx,
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

  private async record(
    tx: InspectionWriteTx,
    ctx: TenantContext,
    p: {
      action: string;
      operation: Operation;
      before: InspectionRow | null;
      after: InspectionRow;
      authz: AuthzRecord;
      idem: Idempotency;
      now: Date;
    },
  ): Promise<void> {
    await tx.insertHistory({
      history_id: this.newId(),
      inspection_id: p.after.inspection_id,
      operation: p.operation,
      from_state: p.before ? p.before.inspection_state : null,
      to_state: p.after.inspection_state,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      assignment: p.after.assignment,
      claimed_principal_id: p.after.claimed_principal_id,
      verification_result: p.after.verification_result,
      statutory_effect: false,
      authz_decision_id: p.authz.decision_id,
      policy_revision: p.authz.policy_revision,
      idempotency_key: p.idem.key,
      correlation_id: ctx.correlation_id,
      now: p.now,
    });
    await tx.insertOutbox(
      envelopeOf({
        eventType: EVENT_TYPE[p.operation],
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: 'Inspection',
        aggregateId: p.after.inspection_id,
        aggregateVersion: p.after.aggregate_version,
        occurredAt: p.now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: inspectionEventData({
          operation: p.operation,
          row: p.after,
          authzDecisionId: p.authz.decision_id,
          idempotencyKey: p.idem.key,
          correlationId: ctx.correlation_id,
        }),
      }),
      TOPIC_DOMAIN,
    );
    await appendAudit(tx, ctx, {
      action: p.action,
      actionClass: 'WRITE',
      resourceId: p.after.inspection_id,
      result: 'SUCCESS',
      authz: p.authz,
      organisationId: p.after.assignment.organisation_id,
      jurisdictionId: p.after.assignment.jurisdiction_id,
      afterRef: `inspection:${p.after.inspection_id}@v${p.after.aggregate_version}`,
      now: p.now,
    });
  }
}

function resourceOf(row: InspectionRow): InspectionResource {
  return {
    inspection_id: row.inspection_id,
    application_id: row.application_id,
    workflow_node_id: row.workflow_node_id,
    inspection_state: row.inspection_state,
    owner_id: row.claimed_principal_id,
    assignment: row.assignment,
  };
}

function rejectTop(obj: Record<string, unknown>): void {
  if ('tenant_id' in obj) throw new Cmp018Error('SF-TEN-002');
  rejectNamedOfficer(obj, '');
}
