import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { withContextTx } from '../db/tx.js';
import { Cmp032Error } from '../errors.js';
import { storageRateLimitOptions } from '../http/rate-limit.js';
import { accessObject } from '../service/access-object.js';
import type { RouteDeps } from './helpers.js';

export async function registerGetAccess(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const rateLimitOpts = storageRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);
  app.get<{ Params: { id: string } }>(
    '/storage/objects/:id/access',
    {
      config: {
        rateLimit: {
          max: deps.rateLimitMax,
          timeWindow: deps.rateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp032Error('SF-AUTH-001');
      const objectId = request.params.id;
      if (!/^[0-9a-f-]{36}$/i.test(objectId)) throw new Cmp032Error('SF-SYS-003');

      await authorize(deps.authorizer, authzInput(ctx, 'STORAGE_OBJECT_ACCESS', 'StorageObject'));

      const body = await withContextTx(deps.pool, ctx, (client) =>
        accessObject(
          client,
          {
            ctx,
            config: deps.config,
            store: deps.store,
            secrets: deps.secrets,
            now: deps.clock(),
          },
          objectId,
        ),
      );
      return reply.code(200).send(body);
    },
  );
}
