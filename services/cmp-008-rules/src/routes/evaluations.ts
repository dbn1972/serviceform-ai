import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { isUuid, sha256Of } from '../domain/canonical.js';
import { parseEvaluationRequest } from '../domain/inputs.js';
import { Cmp008Error } from '../errors.js';
import { rulesRateLimitOptions } from '../http/rate-limit.js';
import { persistEvaluation, prepareEvaluation, readEvaluation } from '../service/evaluations.js';
import type { RouteDeps } from './helpers.js';
import { requireIdempotencyKey, tenantId } from './helpers.js';

const ENDPOINT = 'POST /evaluations';

export async function registerEvaluationRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  await app.register(rateLimit, rulesRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs));

  app.post('/evaluations', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp008Error('SF-AUTH-001');
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(deps.authorizer, authzInput(ctx, 'RULE_EVALUATION_EXECUTE', 'RuleEvaluation'));
    const parsed = parseEvaluationRequest(request.body);
    const prepared = await prepareEvaluation(
      { ctx, config: deps.config, rulePacks: deps.rulePacks, engine: deps.engine },
      parsed,
    );
    const now = deps.clock();
    const result = await withContextTx(deps.pool, ctx, async (client) => {
      const claim = await claimIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: ENDPOINT,
        key: idemKey,
        fingerprint: sha256Of(parsed),
        now,
      });
      if (claim !== 'claimed') return { status: claim.status, body: claim.body };
      const out = await persistEvaluation(client, { ctx, now }, prepared);
      await completeIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: ENDPOINT,
        key: idemKey,
        status: 201,
        body: out,
      });
      return { status: 201, body: out };
    });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>('/evaluations/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp008Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp008Error('SF-SYS-003');
    await authorize(deps.authorizer, authzInput(ctx, 'RULE_EVALUATION_READ', 'RuleEvaluation'));
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readEvaluation(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });
}
