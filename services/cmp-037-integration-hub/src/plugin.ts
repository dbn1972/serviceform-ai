import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ConnectorAdapter, SecretResolver } from '@serviceform/connector-sdk';
import {
  assertProductionSafe,
  CircuitBreakerRegistry,
  ProductionSimulatedCriticalConnectorError,
} from '@serviceform/connector-sdk';
import type { RequestContext } from '@serviceform/contracts';
import { errorEntry } from '@serviceform/contracts';
import type { Logger } from '@serviceform/observability';
import type { HubConfig } from './config.js';
import { HubError } from './errors.js';
import { ConnectorInvoker, fingerprintOf } from './invoker.js';
import type {
  AuthorizationPort,
  BindingRepository,
  InboxWriter,
  MetricsPort,
  OutboxWriter,
  TransactionRepository,
  UnitOfWork,
} from './ports.js';
import { denyAllAuthorization, noopMetrics } from './ports.js';
import { WebhookIntake } from './webhook-intake.js';

export interface IntegrationHubDeps {
  config: HubConfig;
  logger: Logger;
  uow: UnitOfWork;
  bindings: BindingRepository;
  transactions: TransactionRepository;
  outbox: OutboxWriter;
  inbox: InboxWriter;
  secrets: SecretResolver;
  adapters: Map<string, ConnectorAdapter>;
  authorization?: AuthorizationPort;
  metrics?: MetricsPort;
  requestContext: (req: FastifyRequest) => RequestContext | null;
  breaker?: CircuitBreakerRegistry;
  now?: () => Date;
}

/** Client tenant headers are never authoritative; any such header is refused (TI v1.0 s6). */
const CLIENT_TENANT_HEADER = /^(x-)?(sf-)?tenant(-id)?$/i;

function clientSentTenantHeader(headers: FastifyRequest['headers']): boolean {
  return Object.keys(headers).some((name) => CLIENT_TENANT_HEADER.test(name));
}

function sendError(request: FastifyRequest, reply: FastifyReply, err: HubError) {
  const entry = errorEntry(err.code);
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: entry.message,
    correlation_id: request.id,
  };
  if (err.details) body['details'] = err.details;
  return reply.code(err.statusCode).send(body);
}

export const integrationHubPlugin = fp(
  async (app: FastifyInstance, opts: IntegrationHubDeps & { prefix?: string }) => {
    const enabled = await opts.bindings.listEnabledIndex();
    try {
      assertProductionSafe(enabled, opts.config.environment);
    } catch (err) {
      if (err instanceof ProductionSimulatedCriticalConnectorError) {
        throw err;
      }
      throw err;
    }

    const breaker = opts.breaker ?? new CircuitBreakerRegistry();
    const invoker = new ConnectorInvoker({
      config: opts.config,
      uow: opts.uow,
      bindings: opts.bindings,
      transactions: opts.transactions,
      outbox: opts.outbox,
      authz: opts.authorization ?? denyAllAuthorization,
      secrets: opts.secrets,
      adapters: opts.adapters,
      breaker,
      metrics: opts.metrics ?? noopMetrics,
      ...(opts.now ? { now: opts.now } : {}),
    });
    const webhooks = new WebhookIntake({
      config: opts.config,
      uow: opts.uow,
      bindings: opts.bindings,
      transactions: opts.transactions,
      outbox: opts.outbox,
      inbox: opts.inbox,
      secrets: opts.secrets,
      adapters: opts.adapters,
      metrics: opts.metrics ?? noopMetrics,
    });

    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });

    app.setErrorHandler(async (error: Error, request, reply) => {
      if (error instanceof HubError) return sendError(request, reply, error);
      if (error instanceof ProductionSimulatedCriticalConnectorError) {
        return sendError(
          request,
          reply,
          new HubError('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] }),
        );
      }
      const fe = error as { statusCode?: number };
      if (fe.statusCode === 413) {
        return sendError(
          request,
          reply,
          new HubError('SF-SYS-003', { statusCode: 413, details: [{ code: 'PAYLOAD_TOO_LARGE' }] }),
        );
      }
      request.log.error({ err: error }, 'unhandled hub error');
      return sendError(request, reply, new HubError('SF-SYS-001'));
    });

    const prefix = opts.prefix ?? '/v1';

    app.post(`${prefix}/connectors/:id/invoke`, async (request, reply) => {
      if (clientSentTenantHeader(request.headers)) {
        throw new HubError('SF-TEN-002');
      }
      if (request.headers['x-sf-simulation'] === 'true') {
        throw new HubError('SF-SYS-003', { details: [{ code: 'MODE_OVERRIDE' }] });
      }
      const ctx = opts.requestContext(request);
      if (!ctx) throw new HubError('SF-TEN-001');
      const raw = request.body as Buffer;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        throw new HubError('SF-SYS-003');
      }
      const keyHeader = request.headers['idempotency-key'];
      const idempotencyKey = typeof keyHeader === 'string' ? keyHeader : undefined;
      const result = await invoker.invoke({
        bindingId: (request.params as { id: string }).id,
        ctx,
        body: parsed,
        idempotencyKey,
        rawFingerprint: fingerprintOf(raw),
      });
      return reply.code(result.status).send(result.body);
    });

    app.get(`${prefix}/connectors/:id/health`, async (request, reply) => {
      const ctx = opts.requestContext(request);
      if (!ctx?.tenant_id) throw new HubError('SF-TEN-001');
      const decision = await (opts.authorization ?? denyAllAuthorization).decide({
        subject: {
          user_id: ctx.actor.id,
          actor_type: ctx.actor.type,
          tenant_id: ctx.tenant_id,
          roles: ctx.roles,
          jurisdiction_ids: ctx.jurisdiction_ids,
        },
        resource: { resource_type: 'ConnectorBinding', tenant_id: ctx.tenant_id },
        action: 'CONNECTOR_HEALTH',
      });
      if (!decision.allow) throw new HubError('SF-AUTH-002');
      const loaded = await opts.uow.withTransaction(ctx, async () =>
        opts.bindings.getById((request.params as { id: string }).id),
      );
      if (!loaded) throw new HubError('SF-SYS-002');
      const adapter = opts.adapters.get(loaded.definition.adapter_key);
      const health = adapter
        ? await adapter.health({ binding: loaded.binding, signal: AbortSignal.timeout(1000) })
        : { healthy: false };
      return reply.send({
        status: health.healthy ? 'ok' : 'down',
        circuit: breaker.snapshot(loaded.binding.connector_binding_id),
      });
    });

    app.post(`${prefix}/webhooks/:connectorId`, async (request, reply) => {
      const raw = request.body as Buffer;
      const result = await webhooks.handle({
        bindingId: (request.params as { connectorId: string }).connectorId,
        rawBody: new Uint8Array(raw),
        headers: request.headers,
        correlationId: request.id,
      });
      return reply.code(result.status).send(result.body);
    });
  },
  { name: 'sf-cmp-037-integration-hub' },
);

export async function registerIntegrationHub(
  app: FastifyInstance,
  deps: IntegrationHubDeps & { prefix?: string },
): Promise<void> {
  await app.register(integrationHubPlugin, deps);
}
