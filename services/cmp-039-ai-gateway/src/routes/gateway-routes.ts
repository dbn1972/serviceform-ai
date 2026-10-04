import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { withContextTx } from '../db/tx.js';
import { isUuid } from '../domain/ids.js';
import { Cmp039Error } from '../errors.js';
import { aiGatewayRateLimitOptions } from '../http/rate-limit.js';
import { governedCall, type GatewayDeps } from '../service/gateway.js';
import {
  listCapabilities,
  registerModel,
  registerPolicy,
  retirePolicyVersion,
  revokeModelEntry,
} from '../service/registry.js';
import { parseGatewayRequest, type Operation } from '../service/request.js';
import { idempotentCommand, requireCtx, requireIdempotencyKey } from './helpers.js';

export async function registerGatewayRoutes(
  app: FastifyInstance,
  deps: GatewayDeps,
): Promise<void> {
  const rateLimitOpts = aiGatewayRateLimitOptions(
    deps.config.rateLimitMax,
    deps.config.rateLimitWindowMs,
  );
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  const governed = (path: string, operation: Operation) => {
    app.post(path, async (request, reply) => {
      const ctx = requireCtx(request.sfContext);
      const key = requireIdempotencyKey(request.headers['idempotency-key']);
      const parsed = parseGatewayRequest(operation, request.body);
      const result = await governedCall(deps, ctx, parsed, {
        endpoint: `POST ${path}`,
        key,
      });
      return reply.code(result.status).send(result.body);
    });
  };
  governed('/ai/invoke', 'INVOKE');
  governed('/ai/embed', 'EMBED');

  app.get('/ai/models/capabilities', async (request, reply) => {
    const ctx = requireCtx(request.sfContext);
    await authorize(deps.authorizer, authzInput(ctx, 'AI_MODEL_CAPABILITIES_READ', 'AiGateway'));
    const body = await withContextTx(deps.pool, ctx, (client) => listCapabilities(client, ctx));
    return reply.code(200).send(body);
  });

  app.post('/ai/admin/models', async (request, reply) => {
    const ctx = requireCtx(request.sfContext);
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(deps.authorizer, authzInput(ctx, 'AI_MODEL_REGISTER', 'AiModelRegistryEntry'));
    const now = deps.clock();
    const result = await idempotentCommand(
      deps,
      ctx,
      {
        endpoint: 'POST /ai/admin/models',
        key,
        fingerprintParts: [JSON.stringify(request.body ?? null)],
        successStatus: 201,
      },
      (client) => registerModel(client, { ctx, now }, request.body),
    );
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string } }>('/ai/admin/models/:id/revoke', async (request, reply) => {
    const ctx = requireCtx(request.sfContext);
    if (!isUuid(request.params.id)) throw new Cmp039Error('SF-SYS-003');
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(deps.authorizer, authzInput(ctx, 'AI_MODEL_REVOKE', 'AiModelRegistryEntry'));
    const now = deps.clock();
    const result = await idempotentCommand(
      deps,
      ctx,
      {
        endpoint: 'POST /ai/admin/models/{id}/revoke',
        key,
        fingerprintParts: [request.params.id, JSON.stringify(request.body ?? null)],
        successStatus: 200,
      },
      (client) => revokeModelEntry(client, { ctx, now }, request.params.id, request.body),
    );
    return reply.code(result.status).send(result.body);
  });

  app.post('/ai/admin/policies', async (request, reply) => {
    const ctx = requireCtx(request.sfContext);
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(deps.authorizer, authzInput(ctx, 'AI_POLICY_REGISTER', 'AiPolicy'));
    const now = deps.clock();
    const result = await idempotentCommand(
      deps,
      ctx,
      {
        endpoint: 'POST /ai/admin/policies',
        key,
        fingerprintParts: [JSON.stringify(request.body ?? null)],
        successStatus: 201,
      },
      (client) => registerPolicy(client, { ctx, now }, request.body),
    );
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { policyId: string; version: string } }>(
    '/ai/admin/policies/:policyId/versions/:version/retire',
    async (request, reply) => {
      const ctx = requireCtx(request.sfContext);
      const version = Number(request.params.version);
      if (!Number.isInteger(version) || version < 1) throw new Cmp039Error('SF-SYS-003');
      const key = requireIdempotencyKey(request.headers['idempotency-key']);
      await authorize(deps.authorizer, authzInput(ctx, 'AI_POLICY_RETIRE', 'AiPolicy'));
      const now = deps.clock();
      const result = await idempotentCommand(
        deps,
        ctx,
        {
          endpoint: 'POST /ai/admin/policies/{policyId}/versions/{version}/retire',
          key,
          fingerprintParts: [request.params.policyId, String(version)],
          successStatus: 200,
        },
        (client) => retirePolicyVersion(client, { ctx, now }, request.params.policyId, version),
      );
      return reply.code(result.status).send(result.body);
    },
  );
}
