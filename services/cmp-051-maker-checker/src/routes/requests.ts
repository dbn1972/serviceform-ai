import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { actionFingerprint, createRequestFingerprint, isUuid } from '../domain/ids.js';
import { Cmp051Error } from '../errors.js';
import { makerCheckerRateLimitOptions } from '../http/rate-limit.js';
import { createRequest, decideRequest, readRequest, submitRequest } from '../service/requests.js';
import type { RouteDeps } from './helpers.js';
import { requireIdempotencyKey, tenantId } from './helpers.js';

export async function registerRequestRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const rateLimitOpts = makerCheckerRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  app.post<{
    Body: { subject_id?: string; proposed_hash?: string; subject_type?: string };
  }>('/publication-requests', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp051Error('SF-AUTH-001');
    const body = request.body ?? {};
    if (body.subject_type !== undefined && body.subject_type !== 'TENANT_SERVICE_BINDING') {
      throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'UNSUPPORTED_SUBJECT_TYPE' }] });
    }
    if (typeof body.subject_id !== 'string' || typeof body.proposed_hash !== 'string') {
      throw new Cmp051Error('SF-SYS-003');
    }
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    const fingerprint = createRequestFingerprint({
      subject_type: 'TENANT_SERVICE_BINDING',
      subject_id: body.subject_id,
      proposed_hash: body.proposed_hash,
    });
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'PUBLICATION_REQUEST_CREATE', 'PublicationRequest'),
    );
    const result = await withContextTx(deps.pool, ctx, async (client) => {
      const claim = await claimIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'POST /publication-requests',
        key: idemKey,
        fingerprint,
        now: deps.clock(),
      });
      if (claim !== 'claimed') return { status: claim.status, body: claim.body };
      const bodyOut = await createRequest(
        client,
        {
          ctx,
          now: deps.clock(),
          metadata: deps.metadata,
          versioning: deps.versioning,
        },
        { subject_id: body.subject_id as string, proposed_hash: body.proposed_hash as string },
      );
      await completeIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'POST /publication-requests',
        key: idemKey,
        status: 201,
        body: bodyOut,
      });
      return { status: 201, body: bodyOut };
    });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>('/publication-requests/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp051Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp051Error('SF-SYS-003');
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'PUBLICATION_REQUEST_READ', 'PublicationRequest'),
    );
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readRequest(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/publication-requests/:id/submit',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp051Error('SF-AUTH-001');
      if (!isUuid(request.params.id)) throw new Cmp051Error('SF-SYS-003');
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      await authorize(
        deps.authorizer,
        authzInput(ctx, 'PUBLICATION_REQUEST_SUBMIT', 'PublicationRequest'),
      );
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /publication-requests/{id}/submit',
          key: idemKey,
          fingerprint: actionFingerprint('submit', request.params.id),
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const bodyOut = await submitRequest(
          client,
          {
            ctx,
            now: deps.clock(),
            metadata: deps.metadata,
            versioning: deps.versioning,
            ai: deps.ai,
          },
          request.params.id,
          request.body?.reason,
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /publication-requests/{id}/submit',
          key: idemKey,
          status: 200,
          body: bodyOut,
        });
        return { status: 200, body: bodyOut };
      });
      return reply.code(result.status).send(result.body);
    },
  );

  for (const decision of ['approve', 'reject'] as const) {
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    const action =
      decision === 'approve' ? 'PUBLICATION_REQUEST_APPROVE' : 'PUBLICATION_REQUEST_REJECT';
    app.post<{ Params: { id: string }; Body: { reason?: string } }>(
      `/publication-requests/:id/${decision}`,
      async (request, reply) => {
        const ctx = request.sfContext;
        if (!ctx) throw new Cmp051Error('SF-AUTH-001');
        if (!isUuid(request.params.id)) throw new Cmp051Error('SF-SYS-003');
        const reason = request.body?.reason;
        if (typeof reason !== 'string') {
          throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'DECISION_REASON_REQUIRED' }] });
        }
        const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
        await authorize(deps.authorizer, authzInput(ctx, action, 'PublicationRequest'));
        const result = await withContextTx(deps.pool, ctx, async (client) => {
          const claim = await claimIdempotency(client, {
            tenantId: tenantId(ctx),
            principalId: ctx.actor.id,
            endpoint: `POST /publication-requests/{id}/${decision}`,
            key: idemKey,
            fingerprint: actionFingerprint(decision, request.params.id, reason),
            now: deps.clock(),
          });
          if (claim !== 'claimed') return { status: claim.status, body: claim.body };
          const bodyOut = await decideRequest(
            client,
            { ctx, now: deps.clock() },
            request.params.id,
            status,
            reason,
          );
          await completeIdempotency(client, {
            tenantId: tenantId(ctx),
            principalId: ctx.actor.id,
            endpoint: `POST /publication-requests/{id}/${decision}`,
            key: idemKey,
            status: 200,
            body: bodyOut,
          });
          return { status: 200, body: bodyOut };
        });
        return reply.code(result.status).send(result.body);
      },
    );
  }
}
