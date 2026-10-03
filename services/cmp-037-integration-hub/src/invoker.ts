import { createHash, randomUUID } from 'node:crypto';
import type { ConnectorBinding, RequestContext, SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import {
  type ConnectorAdapter,
  type SecretResolver,
  type CircuitBreakerRegistry,
  CircuitOpenError,
  ConnectorModeForbiddenError,
  ProductionSimulatedCriticalConnectorError,
  BindingInvalidError,
  assertNoOpenTransaction,
  buildConnectorEnvelope,
  createGuardedFetch,
  executeWithResilience,
  INTEGRATION_HUB_TOPIC,
  resolveMode,
  DEFAULT_RETRY_POLICY,
} from '@serviceform/connector-sdk';
import { hubError } from './errors.js';
import type { HubConfig } from './config.js';
import type {
  AuthorizationPort,
  BindingRepository,
  MetricsPort,
  OutboxWriter,
  TransactionRepository,
  TransactionRow,
  UnitOfWork,
} from './ports.js';

const SIM_LABEL = 'TEST/SIMULATED';

export function fingerprintOf(raw: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof raw === 'string' ? raw : Buffer.from(raw))
    .digest('hex');
}

function assertNoModeOverride(body: Record<string, unknown>): void {
  for (const key of ['mode', 'environment', 'simulation']) {
    if (key in body) throw hubError('SF-SYS-003', 'MODE_OVERRIDE');
  }
}

export class ConnectorInvoker {
  constructor(
    private readonly deps: {
      config: HubConfig;
      uow: UnitOfWork;
      bindings: BindingRepository;
      transactions: TransactionRepository;
      outbox: OutboxWriter;
      authz: AuthorizationPort;
      secrets: SecretResolver;
      adapters: Map<string, ConnectorAdapter>;
      breaker: CircuitBreakerRegistry;
      metrics: MetricsPort;
      now?: () => Date;
    },
  ) {}

  async invoke(input: {
    bindingId: string;
    ctx: RequestContext;
    body: Record<string, unknown>;
    idempotencyKey: string | undefined;
    rawFingerprint: string;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!input.ctx.tenant_id) throw hubError('SF-TEN-001');
    const tenantId = input.ctx.tenant_id;
    if ('tenant_id' in input.body) throw hubError('SF-SYS-003', 'TENANT_IN_BODY');
    assertNoModeOverride(input.body);

    const decision = await this.deps.authz.decide({
      subject: {
        user_id: input.ctx.actor.id,
        actor_type: input.ctx.actor.type,
        tenant_id: input.ctx.tenant_id,
        roles: input.ctx.roles,
        jurisdiction_ids: input.ctx.jurisdiction_ids,
        assurance: input.ctx.auth_assurance,
      },
      resource: {
        resource_type: 'ConnectorBinding',
        tenant_id: input.ctx.tenant_id,
      },
      action: 'CONNECTOR_INVOKE',
    });
    if (!decision.allow) throw hubError('SF-AUTH-002');

    const operation =
      typeof input.body['operation'] === 'string' ? input.body['operation'] : 'invoke';
    const tx1 = await this.deps.uow.withTransaction(input.ctx, async () => {
      const loaded = await this.deps.bindings.getById(input.bindingId);
      if (!loaded || !loaded.binding.enabled || loaded.binding.tenant_id !== input.ctx.tenant_id) {
        throw hubError('SF-SYS-002');
      }
      this.guardBinding(loaded.binding);
      const mode = resolveMode(loaded.binding, {
        deploymentEnvironment: this.deps.config.environment,
      });
      if (mode === 'SIMULATED') {
        const testRun = input.body['test_run_id'];
        if (typeof testRun !== 'string' || testRun.length === 0)
          throw hubError('SF-SYS-003', 'TEST_RUN_REQUIRED');
      } else if ('scenario' in input.body || 'test_run_id' in input.body) {
        throw hubError('SF-SYS-003', 'MODE_OVERRIDE');
      }
      const row: TransactionRow = {
        connector_transaction_id: randomUUID(),
        tenant_id: tenantId,
        connector_binding_id: loaded.binding.connector_binding_id,
        direction: 'INVOKE',
        operation,
        idempotency_key: input.idempotencyKey ?? null,
        request_fingerprint: input.rawFingerprint,
        provider_reference: null,
        status: 'IN_PROGRESS',
        attempts: 0,
        error_code: null,
        response_ref: null,
        mode,
        environment: loaded.binding.environment,
        simulation: null,
        correlation_id: input.ctx.correlation_id,
        aggregate_version: 1,
      };
      const saved = await this.deps.transactions.insertInvoke(row);
      if (!saved.inserted) {
        if (saved.row.request_fingerprint !== input.rawFingerprint) throw hubError('SF-APP-002');
        return { replay: true as const, row: saved.row, loaded };
      }
      await this.deps.outbox.insertTenant({
        topic: INTEGRATION_HUB_TOPIC,
        partition_key: saved.row.connector_transaction_id,
        envelope: buildConnectorEnvelope({
          event_id: randomUUID(),
          event_type: 'ConnectorInvocationStarted',
          tenant_id: tenantId,
          cell_id: input.ctx.cell_id,
          aggregate_id: saved.row.connector_transaction_id,
          aggregate_version: 1,
          occurred_at: (this.deps.now ?? (() => new Date()))().toISOString(),
          correlation_id: input.ctx.correlation_id,
          actor: input.ctx.actor,
          data: {
            connector_binding_id: loaded.binding.connector_binding_id,
            connector_type: loaded.binding.connector_type,
            direction: 'INVOKE',
            mode,
            attempts: 0,
          },
        }),
      });
      return { replay: false as const, row: saved.row, loaded };
    });

    if (tx1.replay) {
      if (tx1.row.status === 'IN_PROGRESS' || tx1.row.status === 'PENDING') {
        return {
          status: 409,
          body: {
            status: 'IN_PROGRESS',
            connector_transaction_id: tx1.row.connector_transaction_id,
          },
        };
      }
      return {
        status: 200,
        body: {
          status: tx1.row.status,
          connector_transaction_id: tx1.row.connector_transaction_id,
          provider_reference: tx1.row.provider_reference,
        },
      };
    }

    const adapter = this.deps.adapters.get(tx1.loaded.definition.adapter_key);
    if (!adapter) throw hubError('SF-INT-001', 'ADAPTER_MISSING');

    assertNoOpenTransaction();
    try {
      this.deps.breaker.beforeCall(input.bindingId);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        await this.fail(input.ctx, tx1.row, tx1.loaded.binding, 'CIRCUIT_OPEN', 0, null);
        throw hubError('SF-INT-001', 'CIRCUIT_OPEN');
      }
      throw err;
    }

    const policy = tx1.loaded.definition.retry_policy ?? DEFAULT_RETRY_POLICY;
    const guardedFetch = createGuardedFetch({ allowlist: tx1.loaded.definition.egress_allowlist });
    const simulation =
      tx1.loaded.binding.mode === 'SIMULATED'
        ? {
            scenario:
              typeof input.body['scenario'] === 'string' ? input.body['scenario'] : 'success',
            test_run_id: String(input.body['test_run_id']),
          }
        : undefined;

    const ran = await executeWithResilience(
      async (attempt, signal) =>
        adapter.invoke(
          {
            operation,
            payload: input.body['payload'] ?? {},
            request_fingerprint: input.rawFingerprint,
          },
          {
            binding: tx1.loaded.binding,
            secrets: this.deps.secrets,
            signal,
            correlation_id: input.ctx.correlation_id,
            ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
            ...(simulation ? { simulation } : {}),
            attempt,
            guardedFetch,
          },
        ),
      policy,
    );

    const result = ran.value;
    if (tx1.loaded.binding.mode === 'SIMULATED') {
      this.assertMarker(tx1.loaded.binding, result.simulation);
    } else if (result.simulation) {
      await this.fail(
        input.ctx,
        tx1.row,
        tx1.loaded.binding,
        'MARKER_ON_REAL',
        ran.attempts,
        result.provider_reference ?? null,
      );
      throw hubError('SF-SYS-003', 'MARKER_ON_REAL');
    }

    if (result.outcome === 'ok') {
      this.deps.breaker.recordSuccess(input.bindingId);
      await this.succeed(input.ctx, tx1.row, tx1.loaded.binding, ran.attempts, result);
      return {
        status: 200,
        body: {
          status: 'SUCCEEDED',
          connector_transaction_id: tx1.row.connector_transaction_id,
          provider_reference: result.provider_reference,
          ...(result.simulation ? { simulation: result.simulation, label: SIM_LABEL } : {}),
        },
      };
    }
    this.deps.breaker.recordFailure(input.bindingId);
    const code =
      result.outcome === 'timeout' || ran.attempts >= policy.maxAttempts
        ? 'CIRCUIT_OPEN'
        : (result.error_code ?? 'PROVIDER_UNAVAILABLE');
    if (code === 'CIRCUIT_OPEN' || result.outcome === 'timeout') {
      this.deps.breaker.recordFailure(input.bindingId);
    }
    await this.fail(
      input.ctx,
      tx1.row,
      tx1.loaded.binding,
      code,
      ran.attempts,
      result.provider_reference ?? null,
      result.simulation,
    );
    throw hubError('SF-INT-001', code);
  }

  private guardBinding(binding: ConnectorBinding & { enabled?: boolean }): void {
    if (this.deps.config.environment === 'PRODUCTION' && binding.mode !== 'REAL') {
      throw new ProductionSimulatedCriticalConnectorError();
    }
    try {
      resolveMode(binding, { deploymentEnvironment: this.deps.config.environment });
    } catch (err) {
      if (err instanceof ProductionSimulatedCriticalConnectorError) throw err;
      if (err instanceof BindingInvalidError) throw hubError('SF-SYS-003', 'BINDING_INVALID');
      if (err instanceof ConnectorModeForbiddenError)
        throw hubError('SF-INT-001', 'CONNECTOR_MODE_FORBIDDEN');
      throw err;
    }
  }

  private assertMarker(binding: ConnectorBinding, marker: SimulationMarker | undefined): void {
    if (!marker) throw hubError('SF-SYS-003', 'MARKER_MISSING');
    const result = validate('simulation-marker', marker);
    if (!result.valid || marker.connector_binding_id !== binding.connector_binding_id) {
      throw hubError('SF-SYS-003', 'MARKER_MISMATCH');
    }
  }

  private async succeed(
    ctx: RequestContext,
    row: TransactionRow,
    binding: ConnectorBinding,
    attempts: number,
    result: { provider_reference?: string; response_ref?: string; simulation?: SimulationMarker },
  ): Promise<void> {
    await this.deps.uow.withTransaction(ctx, async () => {
      await this.deps.transactions.finalize(row.connector_transaction_id, {
        status: 'SUCCEEDED',
        attempts,
        error_code: null,
        response_ref: result.response_ref ?? null,
        provider_reference: result.provider_reference ?? null,
        simulation: result.simulation ?? null,
        aggregate_version: row.aggregate_version + 1,
      });
      await this.deps.outbox.insertTenant({
        topic: INTEGRATION_HUB_TOPIC,
        partition_key: row.connector_transaction_id,
        envelope: buildConnectorEnvelope({
          event_id: randomUUID(),
          event_type: 'ConnectorInvocationSucceeded',
          tenant_id: row.tenant_id,
          cell_id: ctx.cell_id,
          aggregate_id: row.connector_transaction_id,
          aggregate_version: row.aggregate_version + 1,
          occurred_at: (this.deps.now ?? (() => new Date()))().toISOString(),
          correlation_id: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            connector_binding_id: binding.connector_binding_id,
            connector_type: binding.connector_type,
            direction: 'INVOKE',
            mode: binding.mode,
            attempts,
            outcome: 'ok',
            ...(result.provider_reference ? { provider_reference: result.provider_reference } : {}),
            ...(result.simulation ? { simulation: result.simulation } : {}),
          },
        }),
      });
    });
  }

  private async fail(
    ctx: RequestContext,
    row: TransactionRow,
    binding: ConnectorBinding,
    errorCode: string,
    attempts: number,
    providerReference: string | null,
    simulation?: SimulationMarker,
  ): Promise<void> {
    const status = errorCode === 'CIRCUIT_OPEN' ? 'CIRCUIT_OPEN' : 'FAILED';
    await this.deps.uow.withTransaction(ctx, async () => {
      await this.deps.transactions.finalize(row.connector_transaction_id, {
        status,
        attempts,
        error_code: errorCode,
        response_ref: null,
        provider_reference: providerReference,
        simulation: simulation ?? null,
        aggregate_version: row.aggregate_version + 1,
      });
      await this.deps.outbox.insertTenant({
        topic: INTEGRATION_HUB_TOPIC,
        partition_key: row.connector_transaction_id,
        envelope: buildConnectorEnvelope({
          event_id: randomUUID(),
          event_type: 'ConnectorInvocationFailed',
          tenant_id: row.tenant_id,
          cell_id: ctx.cell_id,
          aggregate_id: row.connector_transaction_id,
          aggregate_version: row.aggregate_version + 1,
          occurred_at: (this.deps.now ?? (() => new Date()))().toISOString(),
          correlation_id: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            connector_binding_id: binding.connector_binding_id,
            connector_type: binding.connector_type,
            direction: 'INVOKE',
            mode: binding.mode,
            attempts,
            outcome: 'failed',
            error_code: errorCode,
            ...(providerReference ? { provider_reference: providerReference } : {}),
            ...(simulation ? { simulation } : {}),
          },
        }),
      });
    });
  }
}
