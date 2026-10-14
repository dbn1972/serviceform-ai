import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  CREDENTIAL_ACTIONS,
  type AuthorizationPort,
  type CredentialAction,
} from '../authz.js';
import { isOpaqueRef, isSha256Hex, isStorageKey } from '../domain/charset.js';
import {
  assertForwardTransition,
  credentialIdFor,
  credentialView,
  registryKeyFor,
  renderKeyFor,
  signingKeyFor,
  type ArtifactRow,
  type CredentialRow,
} from '../domain/credential.js';
import { downstreamOutcomeView, type DownstreamOutcomeRow } from '../domain/outcome.js';
import {
  signingRecordView,
  validateSigningResult,
  type DeploymentEnvironment,
  type SigningRecordRow,
} from '../domain/signing.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp022Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { CaseIssuancePins, CaseIssuancePinsPort } from '../ports/case-pins-port.js';
import type { RegistrationAck, CredentialRegistryPort } from '../ports/registry-port.js';
import type { ArtifactRenderPort, StoredArtifactRef } from '../ports/render-port.js';
import type { SigningAdapterResult, SigningPort } from '../ports/signing-port.js';
import type { CredentialRepository, CredentialTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { IssueInput, OutcomeInput } from './input.js';

export interface CredentialServiceDeps {
  repo: CredentialRepository;
  authorizer: AuthorizationPort;
  casePins: CaseIssuancePinsPort;
  renderer: ArtifactRenderPort;
  signing: SigningPort;
  registry: CredentialRegistryPort;
  environment: DeploymentEnvironment;
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
/** Issuance is a workflow side effect after an upstream approval; citizens cannot trigger it. */
const ISSUE_ACTORS: readonly ActorType[] = ['SYSTEM', 'OFFICER'];
const OUTCOME_ACTORS: readonly ActorType[] = ['SYSTEM', 'INTEGRATION'];
const REGISTRY_ISSUABLE: ReadonlySet<RegistrationAck['current_status']> = new Set([
  'REGISTERED',
  'ACTIVE',
]);

type ValidPins = CaseIssuancePins & {
  credential_template_id: string;
  credential_template_version: number;
  approval_decision_ref: string;
};

interface State {
  row: CredentialRow;
  artifacts: ArtifactRow[];
  signing: SigningRecordRow[];
}

const MAX_RESUME_STEPS = 6;

export class CredentialService {
  constructor(private readonly deps: CredentialServiceDeps) {}

  private assertNoOpenTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp022Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private async guard(
    ctx: TenantContext,
    action: CredentialAction,
    applicationId?: string,
  ): Promise<void> {
    this.assertNoOpenTx();
    await authorize(this.deps.authorizer, authzInput(ctx, action, applicationId));
  }

  private async load(tx: CredentialTx, credentialId: string): Promise<State | null> {
    const row = await tx.getCredential(credentialId);
    if (!row) return null;
    return {
      row,
      artifacts: await tx.listArtifacts(credentialId),
      signing: await tx.listSigningRecords(credentialId),
    };
  }

  private async resolvePins(ctx: TenantContext, applicationId: string): Promise<ValidPins> {
    this.assertNoOpenTx();
    let pins: CaseIssuancePins | null;
    try {
      pins = await this.deps.casePins.getIssuancePins(ctx, applicationId);
    } catch (err) {
      if (err instanceof Cmp022Error) throw err;
      throw new Cmp022Error('SF-SYS-004', { ...detail('CASE_PINS_UNAVAILABLE'), cause: err });
    }
    if (pins === null || pins.application_id !== applicationId) {
      throw new Cmp022Error('SF-SYS-002', detail('APPLICATION_NOT_FOUND'));
    }
    if (!isUuid(pins.tenant_service_binding_id) || !isUuid(pins.service_version_id)) {
      throw new Cmp022Error('SF-FORM-001', detail('CASE_PINS_INVALID'));
    }
    if (pins.credential_template_id === null || pins.credential_template_version === null) {
      throw new Cmp022Error('SF-FORM-001', detail('CREDENTIAL_TEMPLATE_NOT_PINNED'));
    }
    if (
      !isUuid(pins.credential_template_id) ||
      !Number.isSafeInteger(pins.credential_template_version) ||
      pins.credential_template_version < 1
    ) {
      throw new Cmp022Error('SF-FORM-001', detail('CASE_PINS_INVALID'));
    }
    if (pins.approval_decision_ref === null) {
      throw new Cmp022Error('SF-WF-001', detail('UPSTREAM_APPROVAL_NOT_RECORDED'));
    }
    if (!isOpaqueRef(pins.approval_decision_ref, 1, 128)) {
      throw new Cmp022Error('SF-WF-001', detail('UPSTREAM_APPROVAL_REF_INVALID'));
    }
    return pins as ValidPins;
  }

  private async render(
    ctx: TenantContext,
    credentialId: string,
    pins: ValidPins,
  ): Promise<StoredArtifactRef> {
    this.assertNoOpenTx();
    let ref: StoredArtifactRef;
    try {
      ref = await this.deps.renderer.render(ctx, {
        credential_id: credentialId,
        application_id: pins.application_id,
        tenant_service_binding_id: pins.tenant_service_binding_id,
        service_version_id: pins.service_version_id,
        credential_template_id: pins.credential_template_id,
        credential_template_version: pins.credential_template_version,
        idempotency_key: renderKeyFor(credentialId),
      });
    } catch (err) {
      if (err instanceof Cmp022Error) throw err;
      throw new Cmp022Error('SF-CRED-001', { ...detail('RENDER_UNAVAILABLE'), cause: err });
    }
    if (!isStorageKey(ref?.storage_key) || !isSha256Hex(ref?.sha256)) {
      throw new Cmp022Error('SF-CRED-001', detail('RENDER_RESULT_INVALID'));
    }
    return { storage_key: ref.storage_key, sha256: ref.sha256 };
  }

  private async priorResult(ctx: TenantContext, idem: Idempotency): Promise<CommandResult | null> {
    const prior = await this.deps.repo.withTx(ctx, (tx) =>
      tx.peekIdempotency({ principalId: ctx.actor.id, endpoint: idem.endpoint, key: idem.key }),
    );
    if (!prior) return null;
    if (prior.request_fingerprint !== idem.fingerprint) throw new Cmp022Error('SF-APP-002');
    if (prior.status === 'COMPLETED' && prior.response_status !== null) {
      return { status: prior.response_status, body: prior.response_body };
    }
    throw new Cmp022Error('SF-APP-002');
  }

  /** Claims and completes the HTTP idempotency record inside an already-open transaction. */
  private async inIdempotency(
    tx: CredentialTx,
    ctx: TenantContext,
    idem: Idempotency,
    now: Date,
    fn: () => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const claim = await tx.claimIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      fingerprint: idem.fingerprint,
      now,
    });
    if (claim !== 'claimed') return claim;
    const result = await fn();
    await tx.completeIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      status: result.status,
      body: result.body,
    });
    return result;
  }

  private event(
    ctx: TenantContext,
    type: string,
    row: CredentialRow,
    version: number,
    occurredAt: string,
    extra: Record<string, unknown>,
  ): ReturnType<typeof envelopeOf> {
    return envelopeOf({
      eventType: type,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'Credential',
      aggregateId: row.credential_id,
      aggregateVersion: version,
      occurredAt,
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        credential_id: row.credential_id,
        application_id: row.application_id,
        tenant_service_binding_id: row.tenant_service_binding_id,
        service_version_id: row.service_version_id,
        credential_template_id: row.credential_template_id,
        credential_template_version: row.credential_template_version,
        issuance_key: row.issuance_key,
        approval_decision_ref: row.approval_decision_ref,
        approval_decision_by_this_component: false,
        ...extra,
      },
    });
  }

  /**
   * Issues a credential for an application whose upstream approval is already recorded.
   * Steps run as GENERATED → SIGNED → ISSUED, each committed in its own short transaction with
   * every port call (render, INT-013 signing, CMP-024 registration) made with no transaction
   * open. A retry with the same issuance_key resumes from the persisted step.
   */
  async issue(ctx: TenantContext, input: IssueInput, idem: Idempotency): Promise<CommandResult> {
    if (!ISSUE_ACTORS.includes(ctx.actor.type)) {
      throw new Cmp022Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    await this.guard(ctx, CREDENTIAL_ACTIONS.issue, input.application_id);
    const replay = await this.priorResult(ctx, idem);
    if (replay) return replay;

    const credentialId = credentialIdFor(ctx.tenant_id, input.application_id, input.issuance_key);
    let state = await this.deps.repo.withTx(ctx, (tx) => this.load(tx, credentialId));
    if (!state) state = await this.generate(ctx, input, idem, credentialId);

    for (let step = 0; step < MAX_RESUME_STEPS; step += 1) {
      if (state.row.lifecycle_status === 'GENERATED') state = await this.sign(ctx, state);
      else if (state.row.lifecycle_status === 'SIGNED') return this.complete(ctx, state, idem);
      else return this.replayIssued(ctx, state, idem);
    }
    throw new Cmp022Error('SF-SYS-001', detail('ISSUANCE_RESUME_EXHAUSTED'));
  }

  private async generate(
    ctx: TenantContext,
    input: IssueInput,
    idem: Idempotency,
    credentialId: string,
  ): Promise<State> {
    const pins = await this.resolvePins(ctx, input.application_id);
    const rendered = await this.render(ctx, credentialId, pins);
    const now = this.deps.clock().toISOString();
    const row: CredentialRow = {
      tenant_id: ctx.tenant_id,
      credential_id: credentialId,
      application_id: input.application_id,
      cell_id: ctx.cell_id,
      tenant_service_binding_id: pins.tenant_service_binding_id,
      service_version_id: pins.service_version_id,
      credential_template_id: pins.credential_template_id,
      credential_template_version: pins.credential_template_version,
      lifecycle_status: 'GENERATED',
      issuance_key: input.issuance_key,
      idempotency_key: idem.key,
      approval_decision_ref: pins.approval_decision_ref,
      signing_record_id: null,
      correlation_id: ctx.correlation_id,
      actor_type: ctx.actor.type,
      created_by: ctx.actor.id,
      generated_at: now,
      signed_at: null,
      issued_at: null,
    };
    return this.deps.repo.withTx(ctx, async (tx) => {
      if (await tx.insertCredential(row)) {
        await tx.insertArtifact({
          credential_id: credentialId,
          artifact_kind: 'UNSIGNED_RENDER',
          storage_key: rendered.storage_key,
          sha256: rendered.sha256,
        });
        await tx.insertOutbox(
          this.event(ctx, 'CredentialGenerated', row, 1, now, {
            lifecycle_status: 'GENERATED',
            unsigned_artifact_sha256: rendered.sha256,
          }),
          TOPIC_DOMAIN,
        );
        await appendAudit(tx, ctx, {
          action: 'CREDENTIAL_GENERATE',
          actionClass: 'WRITE',
          resourceType: 'Credential',
          resourceId: credentialId,
          result: 'SUCCESS',
          now: new Date(now),
        });
      }
      const loaded = await this.load(tx, credentialId);
      if (!loaded) throw new Cmp022Error('SF-SYS-001', detail('CREDENTIAL_DEDUP_RACE'));
      return loaded;
    });
  }

  private async sign(ctx: TenantContext, state: State): Promise<State> {
    const unsigned = state.artifacts.find((a) => a.artifact_kind === 'UNSIGNED_RENDER');
    if (!unsigned) throw new Cmp022Error('SF-SYS-001', detail('UNSIGNED_ARTIFACT_MISSING'));
    const credentialId = state.row.credential_id;
    const attempt = state.signing.length + 1;
    const idempotencyKey = signingKeyFor(credentialId, attempt);
    this.assertNoOpenTx();
    let raw: SigningAdapterResult;
    try {
      raw = await this.deps.signing.sign(ctx, {
        credential_id: credentialId,
        artifact: { storage_key: unsigned.storage_key, sha256: unsigned.sha256 },
        attempt_number: attempt,
        idempotency_key: idempotencyKey,
      });
    } catch (err) {
      if (err instanceof Cmp022Error) throw err;
      throw new Cmp022Error('SF-CRED-001', { ...detail('SIGNING_UNAVAILABLE'), cause: err });
    }
    const signed = validateSigningResult(raw, this.deps.environment);
    const now = this.deps.clock().toISOString();
    const record: SigningRecordRow = {
      ...signed,
      tenant_id: ctx.tenant_id,
      signing_record_id: randomUUID(),
      credential_id: credentialId,
      attempt_number: attempt,
      idempotency_key: idempotencyKey,
      recorded_at: now,
      correlation_id: ctx.correlation_id,
    };
    const next = await this.deps.repo.withTx(ctx, async (tx) => {
      const locked = await tx.lockCredential(credentialId);
      if (locked?.lifecycle_status !== 'GENERATED') return this.load(tx, credentialId);
      if (!(await tx.insertSigningRecord(record))) return this.load(tx, credentialId);
      if (record.signing_result === 'FAILED') {
        await tx.insertOutbox(
          this.event(ctx, 'CredentialSigningFailed', state.row, 1, now, {
            lifecycle_status: 'GENERATED',
            signing_record_id: record.signing_record_id,
            attempt_number: attempt,
            connector_mode: record.connector_mode,
            failure_code: record.failure_code,
          }),
          TOPIC_DOMAIN,
        );
        await appendAudit(tx, ctx, {
          action: 'CREDENTIAL_SIGN',
          actionClass: 'WRITE',
          resourceType: 'Credential',
          resourceId: credentialId,
          result: 'FAILED',
          now: new Date(now),
        });
        return null;
      }
      assertForwardTransition(state.row.lifecycle_status, 'SIGNED');
      await tx.insertArtifact({
        credential_id: credentialId,
        artifact_kind: 'SIGNED_ARTIFACT',
        storage_key: record.signature_ref as string,
        sha256: record.signed_artifact_sha256 as string,
      });
      if (!(await tx.markSigned(credentialId, record.signing_record_id, now))) {
        throw new Cmp022Error('SF-APP-002', detail('CONCURRENT_SIGNING'));
      }
      await tx.insertOutbox(
        this.event(ctx, 'CredentialSigned', state.row, 2, now, {
          lifecycle_status: 'SIGNED',
          signing_record_id: record.signing_record_id,
          connector_mode: record.connector_mode,
          signed_artifact_sha256: record.signed_artifact_sha256,
        }),
        TOPIC_DOMAIN,
      );
      await appendAudit(tx, ctx, {
        action: 'CREDENTIAL_SIGN',
        actionClass: 'WRITE',
        resourceType: 'Credential',
        resourceId: credentialId,
        result: 'SUCCESS',
        now: new Date(now),
      });
      return this.load(tx, credentialId);
    });
    if (next === null) {
      throw new Cmp022Error('SF-CRED-001', {
        details: [{ code: 'SIGNING_FAILED', message: record.failure_code as string }],
      });
    }
    return next;
  }

  private async register(ctx: TenantContext, state: State, signedSha: string): Promise<void> {
    this.assertNoOpenTx();
    let ack: RegistrationAck;
    try {
      ack = await this.deps.registry.register(ctx, {
        credential_id: state.row.credential_id,
        application_id: state.row.application_id,
        signed_artifact_sha256: signedSha,
        idempotency_key: registryKeyFor(state.row.credential_id),
      });
    } catch (err) {
      if (err instanceof Cmp022Error) throw err;
      throw new Cmp022Error('SF-INT-001', { ...detail('REGISTRY_UNAVAILABLE'), cause: err });
    }
    if (ack?.credential_id !== state.row.credential_id) {
      throw new Cmp022Error('SF-CRED-001', detail('REGISTRY_ACK_INVALID'));
    }
    if (!REGISTRY_ISSUABLE.has(ack.current_status)) {
      throw new Cmp022Error('SF-CRED-001', detail('REGISTRY_STATUS_NOT_ISSUABLE'));
    }
  }

  private async complete(
    ctx: TenantContext,
    state: State,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const signedArtifact = state.artifacts.find((a) => a.artifact_kind === 'SIGNED_ARTIFACT');
    if (!signedArtifact || state.row.signing_record_id === null) {
      throw new Cmp022Error('SF-SYS-001', detail('SIGNED_ARTIFACT_MISSING'));
    }
    await this.register(ctx, state, signedArtifact.sha256);
    const nowDate = this.deps.clock();
    const now = nowDate.toISOString();
    const credentialId = state.row.credential_id;
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, nowDate, async () => {
        assertForwardTransition(state.row.lifecycle_status, 'ISSUED');
        if (!(await tx.markIssued(credentialId, now))) {
          const current = await this.load(tx, credentialId);
          if (current?.row.lifecycle_status === 'ISSUED') {
            return { status: 200, body: credentialView(current.row, current.artifacts) };
          }
          throw new Cmp022Error('SF-APP-001', detail('INVALID_CREDENTIAL_TRANSITION'));
        }
        await tx.insertOutbox(
          this.event(ctx, 'CredentialIssued', state.row, 3, now, {
            lifecycle_status: 'ISSUED',
            signing_record_id: state.row.signing_record_id,
            signed_artifact: {
              storage_key: signedArtifact.storage_key,
              sha256: signedArtifact.sha256,
            },
            issued_at: now,
            registry_status_owner_cmp: 'CMP-024',
            issuance_reversible_by_publish_failure: false,
            issuance_reversible_by_notification_failure: false,
          }),
          TOPIC_DOMAIN,
        );
        await appendAudit(tx, ctx, {
          action: 'CREDENTIAL_ISSUE',
          actionClass: 'WRITE',
          resourceType: 'Credential',
          resourceId: credentialId,
          result: 'SUCCESS',
          now: nowDate,
        });
        const issued = await this.load(tx, credentialId);
        if (!issued) throw new Cmp022Error('SF-SYS-001');
        return { status: 201, body: credentialView(issued.row, issued.artifacts) };
      }),
    );
  }

  private replayIssued(
    ctx: TenantContext,
    state: State,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, now, () =>
        Promise.resolve({ status: 200, body: credentialView(state.row, state.artifacts) }),
      ),
    );
  }

  /**
   * Records a post-issuance publish/notification outcome. The credential row is never touched:
   * a FAILED outcome leaves the credential ISSUED (no reversal, no compensation).
   */
  async recordDownstreamOutcome(
    ctx: TenantContext,
    credentialId: string,
    input: OutcomeInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    if (!OUTCOME_ACTORS.includes(ctx.actor.type)) {
      throw new Cmp022Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    await this.guard(ctx, CREDENTIAL_ACTIONS.recordOutcome);
    const nowDate = this.deps.clock();
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, nowDate, async () => {
        const row = await tx.getCredential(credentialId);
        if (!row) throw new Cmp022Error('SF-SYS-002');
        if (row.lifecycle_status !== 'ISSUED') {
          throw new Cmp022Error('SF-APP-001', detail('CREDENTIAL_NOT_ISSUED'));
        }
        const outcome: DownstreamOutcomeRow = {
          tenant_id: ctx.tenant_id,
          outcome_id: randomUUID(),
          credential_id: credentialId,
          channel: input.channel,
          outcome: input.outcome,
          outcome_ref: input.outcome_ref,
          failure_code: input.failure_code,
          actor_type: ctx.actor.type,
          recorded_by: ctx.actor.id,
          correlation_id: ctx.correlation_id,
          recorded_at: nowDate.toISOString(),
        };
        if (!(await tx.insertDownstreamOutcome(outcome))) {
          const existing = await tx.findDownstreamOutcome(
            credentialId,
            input.channel,
            input.outcome_ref,
          );
          if (!existing) throw new Cmp022Error('SF-SYS-001', detail('OUTCOME_DEDUP_RACE'));
          if (existing.outcome !== input.outcome) {
            throw new Cmp022Error('SF-APP-002', detail('OUTCOME_CONFLICT'));
          }
          return { status: 200, body: downstreamOutcomeView(existing) };
        }
        await appendAudit(tx, ctx, {
          action: 'CREDENTIAL_DOWNSTREAM_OUTCOME_RECORD',
          actionClass: 'WRITE',
          resourceType: 'Credential',
          resourceId: credentialId,
          result: 'SUCCESS',
          now: nowDate,
        });
        return { status: 201, body: downstreamOutcomeView(outcome) };
      }),
    );
  }

  async get(ctx: TenantContext, credentialId: string): Promise<CommandResult> {
    await this.guard(ctx, CREDENTIAL_ACTIONS.read);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const s = await this.load(tx, credentialId);
      if (!s) throw new Cmp022Error('SF-SYS-002');
      return { status: 200, body: credentialView(s.row, s.artifacts) };
    });
  }

  async listForApplication(ctx: TenantContext, applicationId: string): Promise<CommandResult> {
    await this.guard(ctx, CREDENTIAL_ACTIONS.read, applicationId);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const rows = await tx.listByApplication(applicationId);
      const credentials = [];
      for (const row of rows) {
        credentials.push(credentialView(row, await tx.listArtifacts(row.credential_id)));
      }
      return { status: 200, body: { credentials } };
    });
  }

  async listSigningRecords(ctx: TenantContext, credentialId: string): Promise<CommandResult> {
    await this.guard(ctx, CREDENTIAL_ACTIONS.read);
    return this.deps.repo.withTx(ctx, async (tx) => {
      if (!(await tx.getCredential(credentialId))) throw new Cmp022Error('SF-SYS-002');
      const records = (await tx.listSigningRecords(credentialId)).map(signingRecordView);
      return { status: 200, body: { signing_records: records } };
    });
  }
}
