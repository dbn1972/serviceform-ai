import type { RequestContext } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { sha256Fingerprint } from '../domain/ids.js';
import { Cmp039Error } from '../errors.js';
import type { GatewayDeps, ServiceResult } from '../service/gateway.js';

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.length < 1 || header.length > 128) {
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
  }
  return header;
}

export function requireCtx(ctx: RequestContext | undefined): RequestContext {
  if (!ctx) throw new Cmp039Error('SF-AUTH-001');
  return ctx;
}

/** Idempotent admin command: claim, mutate and complete in one tenant-scoped transaction. */
export async function idempotentCommand(
  deps: GatewayDeps,
  ctx: RequestContext,
  params: {
    endpoint: string;
    key: string;
    fingerprintParts: readonly string[];
    successStatus: number;
  },
  run: (client: PoolClient) => Promise<Record<string, unknown>>,
): Promise<ServiceResult> {
  return withContextTx(deps.pool, ctx, async (client) => {
    const claim = await claimIdempotency(client, {
      tenantId: ctx.tenant_id as string,
      principalId: ctx.actor.id,
      endpoint: params.endpoint,
      key: params.key,
      fingerprint: sha256Fingerprint([params.endpoint, ...params.fingerprintParts]),
      now: deps.clock(),
    });
    if (claim !== 'claimed') return { status: claim.status, body: claim.body };
    const body = await run(client);
    await completeIdempotency(client, {
      tenantId: ctx.tenant_id as string,
      principalId: ctx.actor.id,
      endpoint: params.endpoint,
      key: params.key,
      status: params.successStatus,
      body,
    });
    return { status: params.successStatus, body };
  });
}
