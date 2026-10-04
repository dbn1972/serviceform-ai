import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import {
  createBindingFingerprint,
  isUuid,
  patchFingerprint,
  publishFingerprint,
} from '../domain/pins.js';
import { Cmp052Error } from '../errors.js';
import { versioningRateLimitOptions } from '../http/rate-limit.js';
import {
  createBinding,
  patchBinding,
  publishBinding,
  readArtifact,
  readBinding,
} from '../service/bindings.js';
import type { RouteDeps } from './helpers.js';
import { requireIdempotencyKey, tenantId } from './helpers.js';

export async function registerBindingRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const rateLimitOpts = versioningRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  app.post<{
    Body: {
      binding_key?: string;
      offering_ref?: string;
      metadata_bundle_ref?: string;
      pins?: unknown;
    };
  }>('/tenant-service-bindings', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp052Error('SF-AUTH-001');
    const body = request.body ?? {};
    if (
      typeof body.binding_key !== 'string' ||
      typeof body.offering_ref !== 'string' ||
      typeof body.metadata_bundle_ref !== 'string'
    ) {
      throw new Cmp052Error('SF-SYS-003');
    }
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'TENANT_SERVICE_BINDING_CREATE', 'TenantServiceBinding'),
    );
    const result = await withContextTx(deps.pool, ctx, async (client) => {
      const claim = await claimIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'POST /tenant-service-bindings',
        key: idemKey,
        fingerprint: createBindingFingerprint({
          binding_key: body.binding_key as string,
          offering_ref: body.offering_ref as string,
          metadata_bundle_ref: body.metadata_bundle_ref as string,
          pins: body.pins ?? {},
        }),
        now: deps.clock(),
      });
      if (claim !== 'claimed') return { status: claim.status, body: claim.body };
      const out = await createBinding(
        client,
        { ctx, now: deps.clock() },
        {
          binding_key: body.binding_key as string,
          offering_ref: body.offering_ref as string,
          metadata_bundle_ref: body.metadata_bundle_ref as string,
          pins: body.pins,
        },
      );
      await completeIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'POST /tenant-service-bindings',
        key: idemKey,
        status: 201,
        body: out,
      });
      return { status: 201, body: out };
    });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>('/tenant-service-bindings/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp052Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp052Error('SF-SYS-003');
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'TENANT_SERVICE_BINDING_READ', 'TenantServiceBinding'),
    );
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readBinding(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });

  app.patch<{
    Params: { id: string };
    Body: { offering_ref?: string; metadata_bundle_ref?: string; pins?: unknown };
  }>('/tenant-service-bindings/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp052Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp052Error('SF-SYS-003');
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'TENANT_SERVICE_BINDING_UPDATE', 'TenantServiceBinding'),
    );
    const result = await withContextTx(deps.pool, ctx, async (client) => {
      const claim = await claimIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'PATCH /tenant-service-bindings/{id}',
        key: idemKey,
        fingerprint: patchFingerprint(request.params.id, request.body ?? {}),
        now: deps.clock(),
      });
      if (claim !== 'claimed') return { status: claim.status, body: claim.body };
      const out = await patchBinding(
        client,
        { ctx, now: deps.clock() },
        request.params.id,
        request.body ?? {},
      );
      await completeIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint: 'PATCH /tenant-service-bindings/{id}',
        key: idemKey,
        status: 200,
        body: out,
      });
      return { status: 200, body: out };
    });
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string } }>(
    '/tenant-service-bindings/:id/publish',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp052Error('SF-AUTH-001');
      if (!isUuid(request.params.id)) throw new Cmp052Error('SF-SYS-003');
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      await authorize(
        deps.authorizer,
        authzInput(ctx, 'TENANT_SERVICE_BINDING_PUBLISH', 'TenantServiceBinding'),
      );
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /tenant-service-bindings/{id}/publish',
          key: idemKey,
          fingerprint: publishFingerprint(request.params.id),
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const out = await publishBinding(
          client,
          { ctx, now: deps.clock(), approval: deps.approval },
          request.params.id,
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint: 'POST /tenant-service-bindings/{id}/publish',
          key: idemKey,
          status: 200,
          body: out,
        });
        return { status: 200, body: out };
      });
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>('/artifact-versions/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp052Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp052Error('SF-SYS-003');
    await authorize(deps.authorizer, authzInput(ctx, 'ARTIFACT_VERSION_READ', 'ArtifactVersion'));
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readArtifact(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });
}
