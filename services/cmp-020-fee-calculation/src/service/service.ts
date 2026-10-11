import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  FEE_ACTIONS,
  type AuthorizationPort,
  type FeeAction,
} from '../authz.js';
import {
  calculate,
  calculationHash,
  factsHash,
  validateEvaluation,
  validatePolicy,
  type Calculation,
  type ValidatedPolicy,
} from '../domain/calculate.js';
import { canonicalJson, sha256Prefixed } from '../domain/fingerprint.js';
import { feeQuoteView } from '../domain/quote.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp020Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { ApplicationFeePins, ApplicationPinsPort } from '../ports/application-pins-port.js';
import type { FeePolicyPort } from '../ports/fee-policy-port.js';
import {
  FEE_RULES_PURPOSE,
  type FeeRulesEvaluation,
  type FeeRulesPort,
} from '../ports/fee-rules-port.js';
import type { FeeRepository, FeeTx, LineRow, QuoteRow } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { QuoteInput } from './input.js';

export interface FeeServiceDeps {
  repo: FeeRepository;
  authorizer: AuthorizationPort;
  applicationPins: ApplicationPinsPort;
  feePolicy: FeePolicyPort;
  feeRules: FeeRulesPort;
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

const QUOTE_ACTORS: readonly TenantContext['actor']['type'][] = ['CITIZEN', 'OFFICER', 'SYSTEM'];
const EMPTY_FACTS_HASH = factsHash({});

type PinnedForFee = ApplicationFeePins & { fee_policy_version_id: string };

export class FeeService {
  constructor(private readonly deps: FeeServiceDeps) {}

  private assertNoOpenTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp020Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private async guard(
    ctx: TenantContext,
    action: FeeAction,
    applicationId?: string,
  ): Promise<void> {
    this.assertNoOpenTx();
    await authorize(this.deps.authorizer, authzInput(ctx, action, applicationId));
  }

  private async resolvePins(ctx: TenantContext, applicationId: string): Promise<PinnedForFee> {
    this.assertNoOpenTx();
    let pins: ApplicationFeePins | null;
    try {
      pins = await this.deps.applicationPins.getFeePins(ctx, applicationId);
    } catch (err) {
      if (err instanceof Cmp020Error) throw err;
      throw new Cmp020Error('SF-SYS-004', {
        ...detail('APPLICATION_PINS_UNAVAILABLE'),
        cause: err,
      });
    }
    if (pins === null || pins.application_id !== applicationId) {
      throw new Cmp020Error('SF-SYS-002', detail('APPLICATION_NOT_FOUND'));
    }
    if (!isUuid(pins.tenant_service_binding_id) || !isUuid(pins.rule_version_id)) {
      throw new Cmp020Error('SF-FORM-001', detail('APPLICATION_PINS_INVALID'));
    }
    if (pins.fee_policy_version_id === null) {
      throw new Cmp020Error('SF-FORM-001', detail('FEE_POLICY_NOT_PINNED'));
    }
    if (!isUuid(pins.fee_policy_version_id)) {
      throw new Cmp020Error('SF-FORM-001', detail('APPLICATION_PINS_INVALID'));
    }
    return pins as PinnedForFee;
  }

  private async resolvePolicy(ctx: TenantContext, pins: PinnedForFee): Promise<ValidatedPolicy> {
    this.assertNoOpenTx();
    let policy;
    try {
      policy = await this.deps.feePolicy.getPublishedVersion(ctx, pins.fee_policy_version_id);
    } catch (err) {
      if (err instanceof Cmp020Error) throw err;
      throw new Cmp020Error('SF-SYS-004', { ...detail('FEE_POLICY_UNAVAILABLE'), cause: err });
    }
    if (policy === null)
      throw new Cmp020Error('SF-FORM-001', detail('FEE_POLICY_VERSION_NOT_FOUND'));
    return validatePolicy(ctx.tenant_id, pins, policy);
  }

  private async evaluateRules(
    ctx: TenantContext,
    pins: PinnedForFee,
    policy: ValidatedPolicy,
    facts: Record<string, unknown>,
  ): Promise<FeeRulesEvaluation> {
    this.assertNoOpenTx();
    const key = sha256Prefixed(
      canonicalJson({
        application_id: pins.application_id,
        rule_version_id: pins.rule_version_id,
        fee_policy_content_hash: policy.content_hash,
        facts_hash: factsHash(facts),
      }),
    ).slice('sha256:'.length, 'sha256:'.length + 48);
    let evaluation: FeeRulesEvaluation;
    try {
      evaluation = await this.deps.feeRules.evaluate(ctx, {
        rule_version_id: pins.rule_version_id,
        purpose_code: FEE_RULES_PURPOSE,
        application_id: pins.application_id,
        facts,
        idempotency_key: `cmp020.${key}`,
      });
    } catch (err) {
      if (err instanceof Cmp020Error) throw err;
      throw new Cmp020Error('SF-SYS-004', { ...detail('FEE_RULES_UNAVAILABLE'), cause: err });
    }
    return validateEvaluation(evaluation, pins.rule_version_id);
  }

  /** Read-only replay check so a retried request never re-invokes rules or metadata ports. */
  private async priorResult(ctx: TenantContext, idem: Idempotency): Promise<CommandResult | null> {
    const prior = await this.deps.repo.withTx(ctx, (tx) =>
      tx.peekIdempotency({ principalId: ctx.actor.id, endpoint: idem.endpoint, key: idem.key }),
    );
    if (!prior) return null;
    if (prior.request_fingerprint !== idem.fingerprint) throw new Cmp020Error('SF-APP-002');
    if (prior.status === 'COMPLETED' && prior.response_status !== null) {
      return { status: prior.response_status, body: prior.response_body };
    }
    throw new Cmp020Error('SF-APP-002');
  }

  private async idempotent(
    ctx: TenantContext,
    idem: Idempotency,
    fn: (tx: FeeTx, now: Date) => Promise<CommandResult>,
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

  async quote(ctx: TenantContext, input: QuoteInput, idem: Idempotency): Promise<CommandResult> {
    if (!QUOTE_ACTORS.includes(ctx.actor.type)) {
      throw new Cmp020Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    await this.guard(ctx, FEE_ACTIONS.quote, input.application_id);
    const replay = await this.priorResult(ctx, idem);
    if (replay) return replay;

    const pins = await this.resolvePins(ctx, input.application_id);
    const policy = await this.resolvePolicy(ctx, pins);
    const evaluation = policy.needs_rules
      ? await this.evaluateRules(ctx, pins, policy, input.facts)
      : null;
    const calc = calculate(policy, evaluation);
    const effectiveFactsHash = policy.needs_rules ? factsHash(input.facts) : EMPTY_FACTS_HASH;
    const calcHash = calculationHash({
      tenantId: ctx.tenant_id,
      applicationId: input.application_id,
      pins,
      policyContentHash: policy.content_hash,
      ruleContentHash: evaluation?.rule_pack.content_hash ?? null,
      factsHash: effectiveFactsHash,
    });

    return this.idempotent(ctx, idem, async (tx, now) => {
      const row = this.quoteRow(ctx, pins, policy, evaluation, calc, {
        factsHash: effectiveFactsHash,
        calculationHash: calcHash,
        idempotencyKey: idem.key,
        issuedAt: now.toISOString(),
      });
      if (!(await tx.insertQuote(row))) {
        const existing = await tx.findQuoteByCalculation(input.application_id, calcHash);
        if (!existing) throw new Cmp020Error('SF-SYS-001', detail('QUOTE_DEDUP_RACE'));
        return { status: 200, body: feeQuoteView(existing, await tx.listLines(existing.quote_id)) };
      }
      const lines: LineRow[] = calc.lines.map((l, i) => ({
        quote_id: row.quote_id,
        line_seq: i + 1,
        code: l.code,
        amount_minor: l.amount_minor,
        calculation_basis: l.calculation_basis,
        description_code: l.description_code,
        rule_output_key: l.rule_output_key,
      }));
      for (const line of lines) await tx.insertLine(line);
      const quote = feeQuoteView(row, lines);
      await tx.insertOutbox(
        envelopeOf({
          eventType: 'FeeQuoteIssued',
          tenantId: ctx.tenant_id,
          cellId: ctx.cell_id,
          aggregateType: 'FeeQuote',
          aggregateId: row.quote_id,
          aggregateVersion: 1,
          occurredAt: row.issued_at,
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            quote_id: row.quote_id,
            application_id: row.application_id,
            currency: quote.currency,
            total_amount_minor: quote.total_amount_minor,
            amount_source: quote.amount_source,
            client_authoritative_amount: false,
            line_count: lines.length,
            fee_policy_version_id: row.fee_policy_version_id,
            rule_version_id: row.rule_version_id,
            tenant_service_binding_id: row.tenant_service_binding_id,
            calculation_hash: row.calculation_hash,
          },
        }),
        TOPIC_DOMAIN,
      );
      await appendAudit(tx, ctx, {
        action: 'FEE_QUOTE_ISSUE',
        actionClass: 'WRITE',
        resourceType: 'FeeQuote',
        resourceId: row.quote_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: quote };
    });
  }

  private quoteRow(
    ctx: TenantContext,
    pins: PinnedForFee,
    policy: ValidatedPolicy,
    evaluation: FeeRulesEvaluation | null,
    calc: Calculation,
    p: { factsHash: string; calculationHash: string; idempotencyKey: string; issuedAt: string },
  ): QuoteRow {
    return {
      tenant_id: ctx.tenant_id,
      quote_id: randomUUID(),
      application_id: pins.application_id,
      cell_id: ctx.cell_id,
      tenant_service_binding_id: pins.tenant_service_binding_id,
      fee_policy_version_id: pins.fee_policy_version_id,
      fee_policy_content_hash: policy.content_hash,
      rule_version_id: pins.rule_version_id,
      rule_content_hash: evaluation?.rule_pack.content_hash ?? null,
      rule_evaluation_id: evaluation?.evaluation_id ?? null,
      currency: calc.currency,
      total_amount_minor: calc.total_amount_minor,
      amount_source: calc.amount_source,
      waiver_policy_ref: policy.waiver_policy_ref,
      facts_hash: p.factsHash,
      calculation_hash: p.calculationHash,
      idempotency_key: p.idempotencyKey,
      correlation_id: ctx.correlation_id,
      actor_type: ctx.actor.type,
      issued_by: ctx.actor.id,
      issued_at: p.issuedAt,
    };
  }

  async get(ctx: TenantContext, quoteId: string): Promise<CommandResult> {
    await this.guard(ctx, FEE_ACTIONS.read);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getQuote(quoteId);
      if (!row) throw new Cmp020Error('SF-SYS-002');
      return { status: 200, body: feeQuoteView(row, await tx.listLines(quoteId)) };
    });
  }

  async listForApplication(ctx: TenantContext, applicationId: string): Promise<CommandResult> {
    await this.guard(ctx, FEE_ACTIONS.read, applicationId);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const rows = await tx.listByApplication(applicationId);
      const quotes = [];
      for (const row of rows) quotes.push(feeQuoteView(row, await tx.listLines(row.quote_id)));
      return { status: 200, body: { quotes } };
    });
  }
}
