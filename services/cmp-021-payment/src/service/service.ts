import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  PAYMENT_ACTIONS,
  type AuthorizationPort,
  type PaymentAction,
} from '../authz.js';
import {
  assertBindingPolicy,
  buildSimulationMarker,
  type BindingPolicyContext,
  type DeploymentEnvironment,
} from '../domain/simulation.js';
import { isUuid } from '../domain/uuid.js';
import { IDEMPOTENCY_KEY, IDEMPOTENCY_TTL_MS, requestFingerprint } from '../domain/fingerprint.js';
import { intentView } from '../domain/intent-view.js';
import { callbackView } from '../domain/callback-view.js';
import { Cmp021Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { ConnectorBindingPort } from '../ports/connector-binding-port.js';
import type { FeeQuotePort } from '../ports/fee-quote-port.js';
import type { GatewayCallbackPayload, PaymentGatewayPort } from '../ports/payment-gateway-port.js';
import type { WorkflowSignalPort } from '../ports/workflow-signal-port.js';
import type { IntentRow, PaymentRepository, PaymentTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { CreateIntentInput, ApplyCallbackInput } from './input.js';

export interface PaymentServiceDeps {
  repo: PaymentRepository;
  authorizer: AuthorizationPort;
  feeQuote: FeeQuotePort;
  connectorBinding: ConnectorBindingPort;
  gateway: PaymentGatewayPort;
  workflowSignal: WorkflowSignalPort;
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

const INTENT_CREATE_ACTORS = ['CITIZEN', 'OFFICER', 'SYSTEM'] as const;
const CALLBACK_ACTORS = ['INTEGRATION', 'SYSTEM'] as const;

export class PaymentService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  private assertNoOpenTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp021Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private async guard(
    ctx: TenantContext,
    action: PaymentAction,
    applicationId?: string,
  ): Promise<void> {
    this.assertNoOpenTx();
    await authorize(this.deps.authorizer, authzInput(ctx, action, applicationId));
  }

  /**
   * Read-only replay check so a retried createIntent never re-invokes fee/binding/gateway ports.
   * Mirrors CMP-020 FeeService.priorResult (must be called outside any TX).
   */
  private async priorResult(ctx: TenantContext, idem: Idempotency): Promise<CommandResult | null> {
    const prior = await this.deps.repo.withTx(ctx, (tx) =>
      tx.peekIdempotency({ principalId: ctx.actor.id, endpoint: idem.endpoint, key: idem.key }),
    );
    if (!prior) return null;
    if (prior.request_fingerprint !== idem.fingerprint) throw new Cmp021Error('SF-APP-002');
    if (prior.status === 'COMPLETED' && prior.response_status !== null) {
      return { status: prior.response_status, body: prior.response_body };
    }
    throw new Cmp021Error('SF-APP-002');
  }

  private async idempotent(
    ctx: TenantContext,
    idem: Idempotency,
    fn: (tx: PaymentTx, now: Date) => Promise<CommandResult>,
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
      if (claim !== 'claimed') return claim;
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

  async createIntent(
    ctx: TenantContext,
    input: CreateIntentInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    if (!(INTENT_CREATE_ACTORS as readonly string[]).includes(ctx.actor.type)) {
      throw new Cmp021Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    await this.guard(ctx, PAYMENT_ACTIONS.createIntent);

    // ── Idempotency peek/replay before any port calls (mirrors CMP-020 priorResult) ──
    const replay = await this.priorResult(ctx, idem);
    if (replay) return replay;

    // ── Outside TX: load fee quote ─────────────────────────────────────────────
    this.assertNoOpenTx();
    let quote;
    try {
      quote = await this.deps.feeQuote.getById(ctx.tenant_id, input.fee_quote_id);
    } catch (err) {
      if (err instanceof Cmp021Error) throw err;
      throw new Cmp021Error('SF-SYS-004', { ...detail('FEE_QUOTE_UNAVAILABLE'), cause: err });
    }
    if (!quote) throw new Cmp021Error('SF-SYS-002', detail('FEE_QUOTE_NOT_FOUND'));
    if (quote.tenant_id !== ctx.tenant_id) throw new Cmp021Error('SF-TEN-002');
    if (quote.client_authoritative_amount !== false) {
      throw new Cmp021Error('SF-SYS-003', detail('CLIENT_AMOUNT_FORBIDDEN'));
    }

    // ── Outside TX: resolve connector binding ──────────────────────────────────
    this.assertNoOpenTx();
    let rawBinding;
    try {
      rawBinding = input.connector_binding_id
        ? await this.deps.connectorBinding.resolve(ctx.tenant_id, input.connector_binding_id)
        : await this.deps.connectorBinding.resolveDefault(ctx.tenant_id, 'PAYMENT');
    } catch (err) {
      if (err instanceof Cmp021Error) throw err;
      throw new Cmp021Error('SF-SYS-004', {
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

    // ── Outside TX: call gateway ──────────────────────────────────────────────
    this.assertNoOpenTx();
    const paymentIntentId = randomUUID();
    let gatewayResult;
    try {
      gatewayResult = await this.deps.gateway.createSession({
        paymentIntentId,
        tenantId: ctx.tenant_id,
        applicationId: quote.application_id,
        feeQuoteId: input.fee_quote_id,
        amountMinor: BigInt(quote.total_amount_minor),
        currency: quote.currency,
        idempotencyKey: idem.key,
        simulationMarker,
      });
    } catch (err) {
      if (err instanceof Cmp021Error) throw err;
      throw new Cmp021Error('SF-SYS-004', { ...detail('GATEWAY_SESSION_FAILED'), cause: err });
    }

    // ── Short TX: persist intent + idempotency + outbox + audit ───────────────
    return this.idempotent(ctx, idem, async (tx, now) => {
      const row: IntentRow = {
        tenant_id: ctx.tenant_id,
        payment_intent_id: paymentIntentId,
        fee_quote_id: input.fee_quote_id,
        application_id: quote.application_id,
        cell_id: ctx.cell_id,
        currency: quote.currency,
        amount_minor: BigInt(quote.total_amount_minor),
        status: gatewayResult.initialStatus,
        connector_binding_id: binding.connector_binding_id,
        connector_mode: binding.mode,
        simulation_marker: simulationMarker ? { ...simulationMarker } : null,
        psp_session_ref: gatewayResult.pspSessionRef,
        psp_redirect_url: gatewayResult.pspRedirectUrl,
        idempotency_key: idem.key,
        correlation_id: ctx.correlation_id,
        actor_type: ctx.actor.type,
        created_by: ctx.actor.id,
        created_at: now.toISOString(),
      };

      await tx.insertIntent(row);

      await tx.insertOutbox(
        envelopeOf({
          eventType: 'PaymentIntentCreated',
          tenantId: ctx.tenant_id,
          cellId: ctx.cell_id,
          aggregateType: 'PaymentIntent',
          aggregateId: paymentIntentId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            payment_intent_id: paymentIntentId,
            fee_quote_id: input.fee_quote_id,
            application_id: quote.application_id,
            currency: quote.currency,
            amount_minor: Number(row.amount_minor),
            status: row.status,
            connector_mode: binding.mode,
          },
        }),
        TOPIC_DOMAIN,
      );

      await appendAudit(tx, ctx, {
        action: 'PAYMENT_INTENT_CREATE',
        actionClass: 'WRITE',
        resourceType: 'PaymentIntent',
        resourceId: paymentIntentId,
        result: 'SUCCESS',
        now,
      });

      return { status: 201, body: intentView(row) };
    });
  }

  async getIntent(ctx: TenantContext, paymentIntentId: string): Promise<CommandResult> {
    if (!isUuid(paymentIntentId)) {
      throw new Cmp021Error('SF-SYS-003', detail('UUID_REQUIRED', '/payment_intent_id'));
    }
    await this.guard(ctx, PAYMENT_ACTIONS.readIntent);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getIntent(paymentIntentId);
      if (!row) throw new Cmp021Error('SF-SYS-002');
      return { status: 200, body: intentView(row) };
    });
  }

  async applyCallback(ctx: TenantContext, input: ApplyCallbackInput): Promise<CommandResult> {
    if (!(CALLBACK_ACTORS as readonly string[]).includes(ctx.actor.type as never)) {
      throw new Cmp021Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    await this.guard(ctx, PAYMENT_ACTIONS.applyCallback);

    // ── Outside TX: verify signature ──────────────────────────────────────────
    this.assertNoOpenTx();
    const callbackPayload: GatewayCallbackPayload = {
      raw: input.raw,
      headers: input.headers,
    };
    let verifyResult;
    try {
      verifyResult = await this.deps.gateway.verifyCallback(callbackPayload);
    } catch (err) {
      if (err instanceof Cmp021Error) throw err;
      throw new Cmp021Error('SF-SYS-004', { ...detail('GATEWAY_VERIFY_FAILED'), cause: err });
    }

    const signatureVerified = verifyResult.verified;
    const verificationResult = signatureVerified ? ('VERIFIED' as const) : ('REJECTED' as const);
    const financialEffectApplicable = signatureVerified && verifyResult.outcome === 'CAPTURED';
    const intentId = verifyResult.paymentIntentId;

    if (!isUuid(intentId)) {
      throw new Cmp021Error('SF-SYS-003', detail('PAYMENT_INTENT_ID_INVALID_IN_CALLBACK'));
    }

    // ── Short TX: exactly-once claim, transition, outbox, audit ───────────────
    const now = this.deps.clock();
    const callbackId = randomUUID();

    const result = await this.deps.repo.withTx(ctx, async (tx) => {
      // duplicate detection via exactly_once_key
      const prior = await tx.getCallbackByExactlyOnceKey(input.exactly_once_key);
      if (prior) {
        // Idempotent replay: return prior result, zero second financial effect (SF-PAY-002)
        return { status: 200, body: callbackView(prior) };
      }

      const intent = await tx.getIntent(intentId);
      if (!intent) throw new Cmp021Error('SF-SYS-002', detail('PAYMENT_INTENT_NOT_FOUND'));
      if (intent.tenant_id !== ctx.tenant_id) throw new Cmp021Error('SF-TEN-002');

      let financialEffectApplied = false;
      let newStatus: IntentRow['status'] = intent.status;

      if (signatureVerified) {
        if (verifyResult.outcome === 'CAPTURED') {
          // claim exactly-once financial effect
          const claimed = await tx.claimExactlyOnceEffect(
            ctx.tenant_id,
            input.exactly_once_key,
            callbackId,
          );
          if (!claimed) {
            // Race: another thread claimed it; fetch and return idempotent
            const concurrentPrior = await tx.getCallbackByExactlyOnceKey(input.exactly_once_key);
            if (concurrentPrior) {
              return { status: 200, body: callbackView(concurrentPrior) };
            }
            throw new Cmp021Error('SF-PAY-002', detail('EXACTLY_ONCE_CLAIM_RACE'));
          }
          financialEffectApplied = true;
          newStatus = 'CAPTURED';
        } else if (verifyResult.outcome === 'FAILED') {
          newStatus = 'FAILED';
        } else if (verifyResult.outcome === 'CANCELLED') {
          newStatus = 'CANCELLED';
        }
      }

      await tx.updateIntentStatus(intentId, newStatus);

      const callbackRow = {
        tenant_id: ctx.tenant_id,
        callback_id: callbackId,
        payment_intent_id: intentId,
        application_id: intent.application_id,
        exactly_once_key: input.exactly_once_key,
        verification_result: verificationResult,
        signature_verified: signatureVerified,
        financial_effect_applied: financialEffectApplied,
        idempotency_key: input.idempotency_key,
        correlation_id: ctx.correlation_id,
        recorded_at: now.toISOString(),
      };
      await tx.insertCallback(callbackRow);

      const eventType =
        verificationResult === 'VERIFIED' && financialEffectApplied
          ? 'PaymentVerified'
          : 'PaymentFailed';

      await tx.insertOutbox(
        envelopeOf({
          eventType,
          tenantId: ctx.tenant_id,
          cellId: ctx.cell_id,
          aggregateType: 'PaymentCallback',
          aggregateId: callbackId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            callback_id: callbackId,
            payment_intent_id: intentId,
            application_id: intent.application_id,
            verification_result: verificationResult,
            signature_verified: signatureVerified,
            financial_effect_applied: financialEffectApplied,
          },
        }),
        TOPIC_DOMAIN,
      );

      await appendAudit(tx, ctx, {
        action: financialEffectApplied ? 'PAYMENT_CALLBACK_CAPTURED' : 'PAYMENT_CALLBACK_REJECTED',
        actionClass: 'WRITE',
        resourceType: 'PaymentCallback',
        resourceId: callbackId,
        result: 'SUCCESS',
        now,
      });

      return { status: 201, body: callbackView(callbackRow) };
    });

    // ── Post-commit: signal workflow (INT-007) ─────────────────────────────────
    if (financialEffectApplicable) {
      this.assertNoOpenTx();
      try {
        const bodyAsRecord = result.body as unknown as Record<string, unknown>;
        await this.deps.workflowSignal.signalPaymentVerified({
          tenantId: ctx.tenant_id,
          paymentIntentId: intentId,
          applicationId: String(bodyAsRecord['application_id'] ?? ''),
          correlationId: ctx.correlation_id,
        });
      } catch {
        // Post-commit signal failures MUST NOT roll back the payment (INT-007 at-least-once)
      }
    }

    return result;
  }
}
