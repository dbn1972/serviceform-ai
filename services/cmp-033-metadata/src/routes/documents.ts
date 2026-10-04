import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { createFingerprint, isUuid } from '../domain/kinds.js';
import { Cmp033Error } from '../errors.js';
import { metadataRateLimitOptions } from '../http/rate-limit.js';
import { createDocument, patchDocument, readDocument } from '../service/documents.js';
import { patchFingerprint } from '../domain/kinds.js';
import type { RouteDeps } from './helpers.js';
import { requireIdempotencyKey, tenantId } from './helpers.js';

function rl(deps: RouteDeps) {
  return metadataRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
}

export async function registerDocumentRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const rateLimitOpts = rl(deps);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  app.post<{
    Body: { kind?: string; document_key?: string; payload?: unknown; schema_id?: string };
  }>('/metadata/documents', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp033Error('SF-AUTH-001');
    const body = request.body ?? {};
    const kind = body.kind;
    const documentKey = body.document_key;
    if (typeof kind !== 'string' || typeof documentKey !== 'string') {
      throw new Cmp033Error('SF-SYS-003');
    }
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    const fingerprint = createFingerprint({
      kind,
      document_key: documentKey,
      schema_id: typeof body.schema_id === 'string' ? body.schema_id : '',
      payload: body.payload ?? {},
    });
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'METADATA_DOCUMENT_CREATE', 'MetadataDocument'),
    );
    const result = await withContextTx(deps.pool, ctx, async (client) => {
      const claim = await claimIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'POST /metadata/documents',
        key: idemKey,
        fingerprint,
        now: deps.clock(),
      });
      if (claim !== 'claimed')
        return { replay: true as const, status: claim.status, body: claim.body };
      const created = await createDocument(
        client,
        { ctx, now: deps.clock() },
        {
          kind,
          document_key: documentKey,
          payload: body.payload ?? {},
          ...(typeof body.schema_id === 'string' ? { schema_id: body.schema_id } : {}),
        },
      );
      await completeIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'POST /metadata/documents',
        key: idemKey,
        status: 201,
        body: created,
      });
      return { replay: false as const, status: 201, body: created };
    });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>('/metadata/documents/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp033Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp033Error('SF-SYS-003');
    await authorize(deps.authorizer, authzInput(ctx, 'METADATA_DOCUMENT_READ', 'MetadataDocument'));
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readDocument(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });

  app.patch<{ Params: { id: string }; Body: { payload?: unknown } }>(
    '/metadata/documents/:id',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp033Error('SF-AUTH-001');
      if (!isUuid(request.params.id)) throw new Cmp033Error('SF-SYS-003');
      const payload = request.body?.payload;
      if (payload === undefined) throw new Cmp033Error('SF-SYS-003');
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const fingerprint = patchFingerprint(request.params.id, payload);
      await authorize(
        deps.authorizer,
        authzInput(ctx, 'METADATA_DOCUMENT_UPDATE', 'MetadataDocument'),
      );
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'PATCH /metadata/documents/{id}',
          key: idemKey,
          fingerprint,
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const updated = await patchDocument(
          client,
          { ctx, now: deps.clock() },
          request.params.id,
          payload,
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'PATCH /metadata/documents/{id}',
          key: idemKey,
          status: 200,
          body: updated,
        });
        return { status: 200, body: updated };
      });
      return reply.code(result.status).send(result.body);
    },
  );
}
