import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { DEFAULT_GATEWAY_EDGE, type GatewayEdgeConfig } from './config.js';
import { edgeRateLimitPlugin } from './edge-rate-limit.js';
import { denyForgedTenantHeaders } from './tenant-headers.js';

export interface ApiGatewayPluginOptions {
  edge?: GatewayEdgeConfig;
}

/**
 * CMP-036 edge plugin: rate limits + forged tenant/identity header denial.
 * Does not own domain authorization (OPA stays CMP-048) and does not transform business semantics.
 * CloudFront/WAF/ALB REAL infra is out of scope without ADR.
 */
export const apiGatewayPlugin = fp(
  async (app: FastifyInstance, opts: ApiGatewayPluginOptions) => {
    const edge = opts.edge ?? DEFAULT_GATEWAY_EDGE;
    await app.register(edgeRateLimitPlugin, { rateLimit: edge.rateLimit });

    app.addHook('onRequest', async (request, reply) => {
      // Health probes stay reachable for orchestration; identity forgery still denied elsewhere.
      if (request.url.startsWith('/health/')) return;
      const denied = await denyForgedTenantHeaders(request, reply);
      if (denied) return denied;
    });
  },
  { name: 'cmp-036-api-gateway', fastify: '5.x' },
);

export async function registerApiGateway(
  app: FastifyInstance,
  opts: ApiGatewayPluginOptions = {},
): Promise<void> {
  await app.register(apiGatewayPlugin, opts);
}
