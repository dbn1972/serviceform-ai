import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { archiveFingerprint } from '../domain/fingerprint.js';
import { Cmp032Error } from '../errors.js';
import { storageRateLimitOptions } from '../http/rate-limit.js';
import { archiveObject } from '../service/archive-object.js';
import type { RouteDeps } from './helpers.js';
import { tenantId } from './helpers.js';

export async function registerPostArchive(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const rateLimitOpts = storageRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);
  app.post<{ Params: { id: string } }>(
    '/storage/objects/:id/archive',
    {
      config: {
        rateLimit: {
          max: deps.rateLimitMax,
          timeWindow: deps.rateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const ctx = request.sfContext!;
      const objectId = request.params.id;
      if (!/^[0-9a-f-]{36}$/i.test(objectId)) throw new Cmp032Error('SF-SYS-003');
      const idemKey = request.headers['idempotency-key'];
      if (typeof idemKey !== 'string' || idemKey.length < 1 || idemKey.length > 128) {
        throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
      }
      const fingerprint = archiveFingerprint(objectId);

      await authorize(deps.authorizer, authzInput(ctx, 'STORAGE_OBJECT_ARCHIVE', 'StorageObject'));

      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /storage/objects/{id}/archive',
          key: idemKey,
          fingerprint,
          now: deps.clock(),
        });
        if (claim !== 'claimed') {
          return { status: claim.status, body: claim.body };
        }
        const archived = await archiveObject(
          client,
          { ctx, store: deps.store, now: deps.clock() },
          objectId,
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /storage/objects/{id}/archive',
          key: idemKey,
          status: 200,
          body: archived,
        });
        return { status: 200, body: archived };
      });

      return reply.code(result.status).send(result.body);
    },
  );
}
