import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import {
  type ConnectorAdapter,
  type SecretResolver,
  assertNoOpenTransaction,
  buildConnectorEnvelope,
  INTEGRATION_HUB_TOPIC,
  resolveMode,
} from '@serviceform/connector-sdk';
import { hubError } from './errors.js';
import type { HubConfig } from './config.js';
import type {
  BindingRepository,
  InboxWriter,
  MetricsPort,
  OutboxWriter,
  TransactionRepository,
  TransactionRow,
  UnitOfWork,
} from './ports.js';
import type { ConnectorEventData } from '@serviceform/connector-sdk';
import type { SimulationMarker } from '@serviceform/contracts';

export class WebhookIntake {
  readonly #hits = new Map<string, { count: number; start: number }>();

  constructor(
    private readonly deps: {
      config: HubConfig;
      uow: UnitOfWork;
      bindings: BindingRepository;
      transactions: TransactionRepository;
      outbox: OutboxWriter;
      inbox: InboxWriter;
      secrets: SecretResolver;
      adapters: Map<string, ConnectorAdapter>;
      metrics: MetricsPort;
      nowSeconds?: () => number;
    },
  ) {}

  async handle(input: {
    bindingId: string;
    rawBody: Uint8Array;
    headers: Record<string, string | string[] | undefined>;
    correlationId: string;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    if (input.rawBody.byteLength > this.deps.config.webhookMaxBytes) {
      throw hubError('SF-SYS-003', 'PAYLOAD_TOO_LARGE', 413);
    }
    const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.correlationId,
    )
      ? input.correlationId
      : randomUUID();
    this.rateLimit(input.bindingId);
    const tenantId = await this.deps.bindings.resolveWebhookTenant(input.bindingId);
    const unauthorized = {
      status: 401,
      body: {
        error_code: 'SF-AUTH-001',
        message: 'Authentication required',
        correlation_id: correlationId,
      },
    };
    if (!tenantId) return unauthorized;

    const ctx: RequestContext = {
      tenant_id: tenantId,
      cell_id: this.deps.config.cellId,
      actor: { type: 'INTEGRATION', id: uuidFrom(input.bindingId) },
      roles: ['CONNECTOR_WEBHOOK'],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY',
      purpose: 'CONNECTOR_WEBHOOK',
      correlation_id: correlationId,
      trace_id: '0'.repeat(32),
    };

    const loaded = await this.deps.uow.withTransaction(ctx, async () =>
      this.deps.bindings.getById(input.bindingId),
    );
    if (!loaded || !loaded.binding.enabled) return unauthorized;
    try {
      resolveMode(loaded.binding, { deploymentEnvironment: this.deps.config.environment });
    } catch {
      return unauthorized;
    }

    assertNoOpenTransaction();
    const adapter = this.deps.adapters.get(loaded.definition.adapter_key);
    if (!adapter) throw hubError('SF-INT-001', 'ADAPTER_MISSING', 503);

    let secretOk = true;
    try {
      await this.deps.secrets.resolve(loaded.binding.secret_ref ?? 'vault://sim/echo-webhook');
    } catch {
      secretOk = false;
    }
    if (!secretOk) throw hubError('SF-INT-001', 'SECRET_UNAVAILABLE', 503);

    const verified = await adapter.verifyWebhook(
      { rawBody: input.rawBody, headers: input.headers },
      {
        binding: loaded.binding,
        secrets: this.deps.secrets,
        signal: AbortSignal.timeout(this.deps.config.webhookReplayWindowSeconds * 1000),
        correlation_id: correlationId,
        attempt: 1,
        guardedFetch: async () => {
          throw hubError('SF-INT-001', 'SSRF_BLOCKED');
        },
      },
    );
    if ('ok' in verified && verified.ok === false) return unauthorized;
    const providerReference = 'provider_reference' in verified ? verified.provider_reference : '';
    const outcome = 'outcome' in verified ? verified.outcome : 'ok';
    const sim: SimulationMarker | null =
      'simulation' in verified && verified.simulation ? verified.simulation : null;
    const fingerprint = createHash('sha256').update(Buffer.from(input.rawBody)).digest('hex');
    const eventId = uuidFrom(`${input.bindingId}:${providerReference}`);
    const row: TransactionRow = {
      connector_transaction_id: randomUUID(),
      tenant_id: tenantId,
      connector_binding_id: input.bindingId,
      direction: 'WEBHOOK',
      operation: 'callback',
      idempotency_key: null,
      request_fingerprint: fingerprint,
      provider_reference: providerReference,
      status: outcome === 'ok' ? 'SUCCEEDED' : 'FAILED',
      attempts: 1,
      error_code: outcome === 'ok' ? null : 'WEBHOOK_FAILED',
      response_ref: null,
      mode: loaded.binding.mode,
      environment: loaded.binding.environment,
      simulation: sim,
      correlation_id: correlationId,
      aggregate_version: 1,
    };

    const saved = await this.deps.uow.withTransaction(ctx, async () => {
      const ins = await this.deps.transactions.insertWebhook(row);
      if (!ins.inserted) {
        if (ins.row.request_fingerprint !== fingerprint) {
          this.deps.metrics.increment('webhook_payload_conflict');
        }
        return { inserted: false, row: ins.row };
      }
      await this.deps.inbox.record('cmp-037.webhook', eventId, tenantId);
      const data: ConnectorEventData = {
        connector_binding_id: input.bindingId,
        connector_type: loaded.binding.connector_type,
        direction: 'WEBHOOK',
        mode: loaded.binding.mode,
        attempts: 1,
        outcome,
        provider_reference: providerReference,
      };
      if (sim) data.simulation = sim;
      await this.deps.outbox.insertTenant({
        topic: INTEGRATION_HUB_TOPIC,
        partition_key: ins.row.connector_transaction_id,
        envelope: buildConnectorEnvelope({
          event_id: eventId,
          event_type:
            outcome === 'ok' ? 'ConnectorInvocationSucceeded' : 'ConnectorInvocationFailed',
          tenant_id: tenantId,
          cell_id: ctx.cell_id,
          aggregate_id: ins.row.connector_transaction_id,
          aggregate_version: 1,
          occurred_at: new Date(
            (this.deps.nowSeconds ?? (() => 0))() * 1000 || Date.now(),
          ).toISOString(),
          correlation_id: correlationId,
          actor: ctx.actor,
          data,
        }),
      });
      return { inserted: true, row: ins.row };
    });

    return {
      status: 200,
      body: {
        status: saved.row.status,
        connector_transaction_id: saved.row.connector_transaction_id,
        duplicate: !saved.inserted,
      },
    };
  }

  private rateLimit(bindingId: string): void {
    const now = (this.deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))() * 1000;
    const cur = this.#hits.get(bindingId);
    if (!cur || now - cur.start > this.deps.config.webhookRateWindowMs) {
      this.#hits.set(bindingId, { count: 1, start: now });
      return;
    }
    cur.count += 1;
    if (cur.count > this.deps.config.webhookRateLimit) throw hubError('SF-RATE-001');
  }
}

function uuidFrom(input: string): string {
  const h = createHash('sha256').update(input).digest('hex');
  const variant = ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
