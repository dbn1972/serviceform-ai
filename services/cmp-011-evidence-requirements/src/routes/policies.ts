import type { FastifyInstance } from 'fastify';
import { authorize, authzInput } from '../authz.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { canonicalJson, isUuid, sha256Fingerprint } from '../domain/canonical.js';
import { Cmp011Error } from '../errors.js';
import { createPolicy, patchPolicy, publishPolicy, readPolicy } from '../service/policies.js';
import type { EvidenceDeps } from '../service/deps.js';
import { calculateEvidence, readResolution } from '../service/resolve.js';
import { requireIdempotencyKey, tenantId } from './helpers.js';

export async function registerEvidenceRoutes(
  app: FastifyInstance,
  deps: EvidenceDeps,
): Promise<void> {
  app.post<{ Body: { policy_key?: string; definition?: unknown } }>(
    '/evidence-policies',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp011Error('SF-AUTH-001');
      const body = request.body ?? {};
      if (typeof body.policy_key !== 'string') throw new Cmp011Error('SF-SYS-003');
      const policyKey = body.policy_key;
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      await authorize(deps.authorizer, authzInput(ctx, 'EVIDENCE_POLICY_CREATE', 'EvidencePolicy'));
      const endpoint = 'POST /evidence-policies';
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint,
          key: idemKey,
          fingerprint: sha256Fingerprint([
            endpoint,
            policyKey,
            canonicalJson(body.definition ?? null),
          ]),
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const out = await createPolicy(
          client,
          { ctx, now: deps.clock() },
          { policy_key: policyKey, definition: body.definition },
        );
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint,
          key: idemKey,
          status: 201,
          body: out,
        });
        return { status: 201, body: out };
      });
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>('/evidence-policies/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp011Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp011Error('SF-SYS-003');
    await authorize(deps.authorizer, authzInput(ctx, 'EVIDENCE_POLICY_READ', 'EvidencePolicy'));
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readPolicy(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });

  app.patch<{ Params: { id: string }; Body: { definition?: unknown } }>(
    '/evidence-policies/:id',
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx) throw new Cmp011Error('SF-AUTH-001');
      if (!isUuid(request.params.id)) throw new Cmp011Error('SF-SYS-003');
      const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
      await authorize(deps.authorizer, authzInput(ctx, 'EVIDENCE_POLICY_UPDATE', 'EvidencePolicy'));
      const id = request.params.id;
      const endpoint = 'PATCH /evidence-policies/{id}';
      const definition = request.body?.definition;
      const result = await withContextTx(deps.pool, ctx, async (client) => {
        const claim = await claimIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint,
          key: idemKey,
          fingerprint: sha256Fingerprint([endpoint, id, canonicalJson(definition ?? null)]),
          now: deps.clock(),
        });
        if (claim !== 'claimed') return { status: claim.status, body: claim.body };
        const out = await patchPolicy(client, { ctx, now: deps.clock() }, id, { definition });
        await completeIdempotency(client, {
          tenantId: tenantId(ctx),
          principalId: ctx.actor.id,
          endpoint,
          key: idemKey,
          status: 200,
          body: out,
        });
        return { status: 200, body: out };
      });
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>('/evidence-policies/:id/publish', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp011Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp011Error('SF-SYS-003');
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    await authorize(deps.authorizer, authzInput(ctx, 'EVIDENCE_POLICY_PUBLISH', 'EvidencePolicy'));
    const id = request.params.id;
    const endpoint = 'POST /evidence-policies/{id}/publish';
    const result = await withContextTx(deps.pool, ctx, async (client) => {
      const claim = await claimIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint,
        key: idemKey,
        fingerprint: sha256Fingerprint([endpoint, id]),
        now: deps.clock(),
      });
      if (claim !== 'claimed') return { status: claim.status, body: claim.body };
      const out = await publishPolicy(
        client,
        { ctx, now: deps.clock(), approval: deps.approval },
        id,
      );
      await completeIdempotency(client, {
        tenantId: tenantId(ctx),
        principalId: ctx.actor.id,
        endpoint,
        key: idemKey,
        status: 200,
        body: out,
      });
      return { status: 200, body: out };
    });
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Body: unknown }>('/evidence-requirements/calculate', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp011Error('SF-AUTH-001');
    const idemKey = requireIdempotencyKey(request.headers['idempotency-key']);
    const result = await calculateEvidence(deps, ctx, request.body, idemKey);
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>('/evidence-resolutions/:id', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx) throw new Cmp011Error('SF-AUTH-001');
    if (!isUuid(request.params.id)) throw new Cmp011Error('SF-SYS-003');
    await authorize(
      deps.authorizer,
      authzInput(ctx, 'EVIDENCE_RESOLUTION_READ', 'EvidenceResolution'),
    );
    const body = await withContextTx(deps.pool, ctx, (client) =>
      readResolution(client, ctx, request.params.id),
    );
    return reply.code(200).send(body);
  });
}
