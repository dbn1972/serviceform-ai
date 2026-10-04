import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import {
  composeFingerprint,
  isUuid,
  publishFingerprint,
  validateFingerprint,
} from '../domain/kinds.js';
import { Cmp033Error } from '../errors.js';
import { metadataRateLimitOptions } from '../http/rate-limit.js';
import { composeBundle, publishDocument, validateDocument } from '../service/documents.js';
import type { RouteDeps } from './helpers.js';
import { requireIdempotencyKey, tenantId } from './helpers.js';

export async function registerLifecycleRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const rateLimitOpts = metadataRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  app.post<{ Params: { id: string } }>(
    '/metadata/documents/:id/validate',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp033Error('SF-AUTH-001');
      if (!isUuid(request.params.id)) throw new Cmp033Error('SF-SYS-003');
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const fingerprint = validateFingerprint(request.params.id);
      await authorize(
        deps.authorizer,
        authzInput(ctx, 'METADATA_DOCUMENT_VALIDATE', 'MetadataDocument'),
      );
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /metadata/documents/{id}/validate',
          key: idemKey,
          fingerprint,
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const body = await validateDocument(
          client,
          { ctx, now: deps.clock(), registry: deps.registry },
          request.params.id,
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /metadata/documents/{id}/validate',
          key: idemKey,
          status: 200,
          body,
        });
        return { status: 200, body };
      });
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/metadata/documents/:id/publish',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp033Error('SF-AUTH-001');
      if (!isUuid(request.params.id)) throw new Cmp033Error('SF-SYS-003');
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const fingerprint = publishFingerprint(request.params.id);
      await authorize(
        deps.authorizer,
        authzInput(ctx, 'METADATA_DOCUMENT_PUBLISH', 'MetadataDocument'),
      );
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /metadata/documents/{id}/publish',
          key: idemKey,
          fingerprint,
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const body = await publishDocument(client, { ctx, now: deps.clock() }, request.params.id);
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /metadata/documents/{id}/publish',
          key: idemKey,
          status: 200,
          body,
        });
        return { status: 200, body };
      });
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Body: { bundle_key?: string; document_ids?: string[] } }>(
    '/metadata/bundles',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp033Error('SF-AUTH-001');
      const bundleKey = request.body?.bundle_key;
      const documentIds = request.body?.document_ids;
      if (typeof bundleKey !== 'string' || !Array.isArray(documentIds)) {
        throw new Cmp033Error('SF-SYS-003');
      }
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const fingerprint = composeFingerprint({ bundle_key: bundleKey, document_ids: documentIds });
      await authorize(
        deps.authorizer,
        authzInput(ctx, 'METADATA_BUNDLE_COMPOSE', 'MetadataBundle'),
      );
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /metadata/bundles',
          key: idemKey,
          fingerprint,
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const body = await composeBundle(
          client,
          { ctx, now: deps.clock() },
          {
            bundle_key: bundleKey,
            document_ids: documentIds,
          },
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /metadata/bundles',
          key: idemKey,
          status: 201,
          body,
        });
        return { status: 201, body };
      });
      return reply.code(result.status).send(result.body);
    },
  );
}
