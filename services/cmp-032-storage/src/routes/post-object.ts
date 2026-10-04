import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { storeFingerprint } from '../domain/fingerprint.js';
import { Cmp032Error } from '../errors.js';
import { storageRateLimitOptions } from '../http/rate-limit.js';
import { storeObject } from '../service/store-object.js';
import type { RouteDeps } from './helpers.js';
import { tenantId } from './helpers.js';

export async function registerPostObject(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const rateLimitOpts = storageRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);
  app.post<{
    Body: { content_type?: string; content_base64?: string; checksum_sha256?: string };
  }>(
    '/storage/objects',
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
      const body = request.body ?? {};
      const contentType = body.content_type;
      const contentBase64 = body.content_base64;
      if (
        typeof contentType !== 'string' ||
        typeof contentBase64 !== 'string' ||
        contentType.length === 0 ||
        contentBase64.length === 0
      ) {
        throw new Cmp032Error('SF-SYS-003');
      }
      const idemKey = request.headers['idempotency-key'];
      if (typeof idemKey !== 'string' || idemKey.length < 1 || idemKey.length > 128) {
        throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
      }
      const fingerprint = storeFingerprint({
        content_type: contentType,
        checksum_sha256: body.checksum_sha256 ?? '',
        content_base64: contentBase64,
      });

      await authorize(deps.authorizer, authzInput(ctx, 'STORAGE_OBJECT_CREATE', 'StorageObject'));

      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /storage/objects',
          key: idemKey,
          fingerprint,
          now: deps.clock(),
        });
        if (claim !== 'claimed') {
          return { replay: true as const, status: claim.status, body: claim.body };
        }
        const stored = await storeObject(
          client,
          {
            ctx,
            config: deps.config,
            store: deps.store,
            kms: deps.kms,
            now: deps.clock(),
          },
          {
            contentType,
            contentBase64,
            ...(body.checksum_sha256 ? { checksumSha256: body.checksum_sha256 } : {}),
          },
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /storage/objects',
          key: idemKey,
          status: 201,
          body: stored,
        });
        return { replay: false as const, status: 201, body: stored };
      });

      return reply.code(result.status).send(result.body);
    },
  );
}
