import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  DIGILOCKER_ACTIONS,
  type AuthorizationPort,
  type DigilockerAction,
} from '../authz.js';
import {
  assertBindingPolicy,
  buildSimulationMarker,
  type BindingPolicyContext,
  type DeploymentEnvironment,
} from '../domain/simulation.js';
import { isUuid } from '../domain/simulation.js';
import { Cmp012Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { ConnectorBindingPort } from '../ports/connector-binding-port.js';
import type { DigiLockerApiPort } from '../ports/digilocker-api-port.js';
import type { DigilockerRepository, PublishRow, DigilockerTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { PublishCredentialInput } from './input.js';

export interface DigiLockerServiceDeps {
  repo: DigilockerRepository;
  authorizer: AuthorizationPort;
  connectorBinding: ConnectorBindingPort;
  digilockerApi: DigiLockerApiPort;
  runtimeEnvironment: DeploymentEnvironment;
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

const ALLOWED_PUBLISH_ACTORS = ['SYSTEM', 'INTEGRATION', 'OFFICER'] as const;

export class DigiLockerService {
  constructor(private readonly deps: DigiLockerServiceDeps) {}

  private assertNoOpenTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp012Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private async guard(
    ctx: TenantContext,
    action: DigilockerAction,
    credentialId?: string,
  ): Promise<void> {
    this.assertNoOpenTx();
    await authorize(this.deps.authorizer, authzInput(ctx, action, credentialId));
  }

  private async priorResult(ctx: TenantContext, idem: Idempotency): Promise<CommandResult | null> {
    const prior = await this.deps.repo.withTx(ctx, (tx) =>
      tx.peekIdempotency({ principalId: ctx.actor.id, endpoint: idem.endpoint, key: idem.key }),
    );
    if (!prior) return null;
    if (prior.request_fingerprint !== idem.fingerprint) throw new Cmp012Error('SF-APP-002');
    if (prior.status === 'COMPLETED' && prior.response_status !== null) {
      return { status: prior.response_status, body: prior.response_body };
    }
    throw new Cmp012Error('SF-APP-002');
  }

  private async idempotent(
    ctx: TenantContext,
    idem: Idempotency,
    fn: (tx: DigilockerTx, now: Date) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claim !== 'claimed') {
        return { status: claim.response_status ?? 200, body: claim.response_body };
      }
      const result = await fn(tx, now);
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: result.status,
        body: result.body,
      });
      return result;
    });
  }

  async publishCredential(
    ctx: TenantContext,
    input: PublishCredentialInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    if (!(ALLOWED_PUBLISH_ACTORS as readonly string[]).includes(ctx.actor.type)) {
      throw new Cmp012Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    await this.guard(ctx, DIGILOCKER_ACTIONS.publish, input.credential_id);

    const replay = await this.priorResult(ctx, idem);
    if (replay) return replay;

    // ── Outside TX: resolve connector binding ──────────────────────────────────
    this.assertNoOpenTx();
    let rawBinding;
    try {
      rawBinding = input.connector_binding_id
        ? await this.deps.connectorBinding.resolve(ctx.tenant_id, input.connector_binding_id)
        : await this.deps.connectorBinding.resolveDefault(ctx.tenant_id, 'DIGILOCKER');
    } catch (err) {
      if (err instanceof Cmp012Error) throw err;
      throw new Cmp012Error('SF-SYS-004', {
        ...detail('CONNECTOR_BINDING_UNAVAILABLE'),
        cause: err,
      });
    }

    const policyCtx: BindingPolicyContext = {
      tenantId: ctx.tenant_id,
      runtimeEnvironment: this.deps.runtimeEnvironment,
    };
    const binding = assertBindingPolicy(rawBinding, policyCtx);
    const simulationMarker = buildSimulationMarker(binding, input.test_run_id);

    // ── Outside TX: call DigiLocker API ───────────────────────────────────────
    this.assertNoOpenTx();
    const publishRequestId = randomUUID();

    let apiResult;
    try {
      apiResult = await this.deps.digilockerApi.publish({
        publishRequestId,
        tenantId: ctx.tenant_id,
        credentialId: input.credential_id,
        consentRef: input.consent_ref,
        purposeCode: input.purpose_code,
        documentTypeRef: input.document_type_ref,
        storageKey: `credentials/${ctx.tenant_id}/${input.credential_id}`,
        idempotencyKey: idem.key,
        simulationMarker,
      });
    } catch (err) {
      if (err instanceof Cmp012Error) throw err;
      // Publish failure MUST NOT reverse issuance (SF-CON-DIGILOCKER-PUBLISH invariant)
      apiResult = { status: 'FAILED' as const, failureCode: 'SF-INT-001' };
    }

    const publishStatus = apiResult.status === 'PUBLISHED' ? 'PUBLISHED' : 'FAILED';

    // ── Short TX: persist record + idempotency + outbox + audit ───────────────
    return this.idempotent(ctx, idem, async (tx, txNow) => {
      const row: PublishRow = {
        tenant_id: ctx.tenant_id,
        publish_request_id: publishRequestId,
        credential_id: input.credential_id,
        credential_lifecycle_status_at_request: 'ISSUED',
        consent_ref: input.consent_ref,
        purpose_code: input.purpose_code,
        connector_binding_id: binding.connector_binding_id,
        connector_mode: binding.mode,
        simulation_marker: simulationMarker ? { ...simulationMarker } : null,
        document_type_ref: input.document_type_ref,
        publish_status: publishStatus,
        provider_transaction_ref:
          apiResult.status === 'PUBLISHED' ? (apiResult.providerTransactionRef ?? null) : null,
        failure_code: publishStatus === 'FAILED' ? (apiResult.failureCode ?? 'SF-INT-001') : null,
        attempt_number: 1,
        idempotency_key: idem.key,
        issuance_reversed_on_publish_failure: false,
        registry_status_changed_by_publish: false,
        invented_statutory_policy_forbidden: true,
        correlation_id: ctx.correlation_id,
        actor_type: ctx.actor.type,
        created_by: ctx.actor.id,
        created_at: txNow.toISOString(),
        updated_at: txNow.toISOString(),
      };

      await tx.insertPublishRecord(row);

      const eventType: string =
        publishStatus === 'PUBLISHED' ? 'DigiLockerPublishSucceeded' : 'DigiLockerPublishFailed';

      await tx.insertOutbox(
        envelopeOf({
          eventType,
          tenantId: ctx.tenant_id,
          cellId: ctx.cell_id,
          aggregateType: 'DigiLockerPublish',
          aggregateId: publishRequestId,
          aggregateVersion: 1,
          occurredAt: txNow.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            publish_request_id: publishRequestId,
            credential_id: input.credential_id,
            publish_status: publishStatus,
            connector_mode: binding.mode,
            issuance_reversed_on_publish_failure: false,
            registry_status_changed_by_publish: false,
          },
        }),
        TOPIC_DOMAIN,
      );

      await appendAudit(tx, ctx, {
        action:
          publishStatus === 'PUBLISHED'
            ? 'DIGILOCKER_PUBLISH_SUCCEEDED'
            : 'DIGILOCKER_PUBLISH_FAILED',
        actionClass: 'WRITE',
        resourceType: 'DigiLockerPublish',
        resourceId: publishRequestId,
        result: 'SUCCESS',
        now: txNow,
      });

      return { status: 201, body: publishView(row) };
    });
  }

  async getPublishRecord(ctx: TenantContext, publishRequestId: string): Promise<CommandResult> {
    if (!isUuid(publishRequestId)) {
      throw new Cmp012Error('SF-SYS-003', detail('UUID_REQUIRED', '/publish_request_id'));
    }
    await this.guard(ctx, DIGILOCKER_ACTIONS.read);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getPublishRecord(ctx.tenant_id, publishRequestId);
      if (!row) throw new Cmp012Error('SF-SYS-002');
      return { status: 200, body: publishView(row) };
    });
  }
}

function publishView(row: PublishRow): Record<string, unknown> {
  const v: Record<string, unknown> = {
    publish_request_id: row.publish_request_id,
    credential_id: row.credential_id,
    publish_status: row.publish_status,
    connector_mode: row.connector_mode,
    document_type_ref: row.document_type_ref,
    attempt_number: row.attempt_number,
    issuance_reversed_on_publish_failure: row.issuance_reversed_on_publish_failure,
    registry_status_changed_by_publish: row.registry_status_changed_by_publish,
    created_at: row.created_at,
  };
  if (row.provider_transaction_ref !== null) {
    v['provider_transaction_ref'] = row.provider_transaction_ref;
  }
  if (row.failure_code !== null) {
    v['failure_code'] = row.failure_code;
  }
  return v;
}
