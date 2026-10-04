import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { isUuid, sha256Of } from '../domain/canonical.js';
import { parseExecutionRequest, parseInterpretationRequest } from '../domain/inputs.js';
import { Cmp009Error } from '../errors.js';
import { formsRateLimitOptions } from '../http/rate-limit.js';
import {
  interpretForm,
  persistExecution,
  prepareExecution,
  readExecution,
} from '../service/executions.js';
import type { RouteDeps } from './helpers.js';
import { requireIdempotencyKey, tenantId } from './helpers.js';

const ENDPOINT = 'POST /executions';

export async function registerFormRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await app.register(rateLimit, formsRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs));

  app.post('/interpretations', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp009Error('SF-AUTH-001');
    await authorize(deps.authorizer, authzInput(ctx, 'FORM_INTERPRET', 'FormDefinition'));
    const parsed = parseInterpretationRequest(request.body);
    const body = await interpretForm(
      { ctx, config: deps.config, forms: deps.forms, localization: deps.localization },
      parsed,
    );
    return reply.code(200).send(body);
  });

  app.post('/executions', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp009Error('SF-AUTH-001');
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(deps.authorizer, authzInput(ctx, 'FORM_EXECUTION_EXECUTE', 'FormExecution'));
    const parsed = parseExecutionRequest(request.body);
    const prepared = await prepareExecution(
      { ctx, config: deps.config, forms: deps.forms, localization: deps.localization },
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
      const out = await persistExecution(client, { ctx, now }, prepared);
      const status = out.result_code === 'VALID' ? 201 : 422;
      const body =
        status === 201
          ? out
          : {
              error_code: 'SF-FORM-002',
              message: 'Form schema validation failed',
              correlation_id: ctx.correlation_id,
              details: out.errors,
            };
      await completeIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: ENDPOINT,
        key: idemKey,
        status,
        body,
      });
      return { status, body };
    });
    if (result.status === 422) {
      return reply.code(422).send(result.body);
    }
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>('/executions/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp009Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp009Error('SF-SYS-003');
    await authorize(deps.authorizer, authzInput(ctx, 'FORM_EXECUTION_READ', 'FormExecution'));
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readExecution(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });
}
