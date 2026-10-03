import { errorEntry } from '@serviceform/contracts';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { Logger } from '@serviceform/observability';
import type { Pool } from 'pg';
import { loadConfig, type AuditServiceConfig } from './config.js';
import { handleEnvelope } from './consumer/handle-envelope.js';
import { AuditError, DuplicateContentError } from './domain/errors.js';
import { createMetrics, type Metrics } from './domain/metrics.js';
import { denyAllAuthz, type AuthzPort } from './ports/authz-port.js';
import type { RequestContextResolver } from './ports/request-context-port.js';
import { registerGetAudit } from './routes/get-audit.js';
import { registerGetAuditByResource } from './routes/get-audit-by-resource.js';
import { registerPostAuditEvent } from './routes/post-audit-event.js';

export interface AuditPluginOptions {
  pool: Pool;
  resolveRequestContext: RequestContextResolver;
  authz?: AuthzPort;
  logger: Logger;
  clock?: () => Date;
  config?: AuditServiceConfig;
  platformSources?: readonly string[];
  prefix?: string;
}

export interface AuditPluginHandle {
  metrics: Metrics;
  handleEnvelope: typeof handleEnvelope;
}

const pluginImpl: FastifyPluginAsync<AuditPluginOptions> = async (app, opts) => {
  const config = opts.config ?? loadConfig();
  const authz = opts.authz ?? denyAllAuthz();
  const metrics = createMetrics();
  const now = opts.clock ?? (() => new Date());
  const platformSources = opts.platformSources ?? [];
  const prefix = opts.prefix ?? '/v1';

  app.decorate('auditMetrics', metrics);
  app.decorate(
    'handleAuditEnvelope',
    (envelope: Parameters<typeof handleEnvelope>[1], source?: string) =>
      handleEnvelope(
        opts.pool,
        envelope,
        source === undefined ? { platformSources } : { source, platformSources },
      ),
  );

  await app.register(
    async (scoped) => {
      scoped.decorateRequest('ctx', null);
      scoped.addHook('onRequest', async (request) => {
        request.ctx = opts.resolveRequestContext(request.headers as Record<string, unknown>);
      });

      scoped.setErrorHandler((error: unknown, request, reply) => {
        const correlation_id = request.id;
        if (error instanceof DuplicateContentError) {
          const entry = errorEntry(error.code);
          return reply.code(409).send({
            error_code: error.code,
            message: entry.message,
            correlation_id,
          });
        }
        if (error instanceof AuditError) {
          const body: Record<string, unknown> = {
            error_code: error.code,
            message: error.message,
            correlation_id,
          };
          if (error.details) body['details'] = error.details;
          return reply.code(error.statusCode).send(body);
        }
        opts.logger.error({ err: error }, 'unhandled audit error');
        return reply.code(500).send({
          error_code: 'SF-SYS-001',
          message: errorEntry('SF-SYS-001').message,
          correlation_id,
        });
      });

      registerPostAuditEvent(scoped, {
        pool: opts.pool,
        authz,
        metrics,
        clockSkewSeconds: config.clockSkewSeconds,
        now,
      });
      registerGetAudit(scoped, {
        pool: opts.pool,
        authz,
        queryMaxDays: config.queryMaxDays,
        queryMaxLimit: config.queryMaxLimit,
      });
      registerGetAuditByResource(scoped, {
        pool: opts.pool,
        authz,
        queryMaxDays: config.queryMaxDays,
        queryMaxLimit: config.queryMaxLimit,
      });
    },
    { prefix },
  );
};

export const cmp031AuditLedgerPlugin = fp(pluginImpl, {
  name: 'cmp-031-audit-ledger',
});

export async function registerAuditPlugin(
  app: FastifyInstance,
  opts: AuditPluginOptions,
): Promise<void> {
  await app.register(cmp031AuditLedgerPlugin, opts);
}

declare module 'fastify' {
  interface FastifyInstance {
    auditMetrics: Metrics;
    handleAuditEnvelope: (
      envelope: Parameters<typeof handleEnvelope>[1],
      source?: string,
    ) => ReturnType<typeof handleEnvelope>;
  }
}
