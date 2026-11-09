import { randomBytes, randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { PortalPlacement } from './placement.js';
import { assertSimulatorEnvironment } from './simulators.js';

/**
 * SF-M10-B-2d host composition for CMP-005 citizen profile and CMP-030 consent on the SAMPLE_LAB
 * platform path. CMP-005 reaches CMP-030 only through CMP-030's own HTTP contract: an in-process
 * CMP-030 instance that never listens serves the consent gate (POST /v1/privacy/access-check) and
 * the SIMULATED privacy publication (purpose + notice). Its callers are two workload identities
 * whose bearer credentials exist only in this process; OPA still decides every action.
 */
export interface LabConsentFixture {
  simulation: 'SIMULATED';
  publisher: { actor_id: string; roles: string[] };
  gate: { actor_id: string; roles: string[] };
  purposes: {
    code: string;
    label: string;
    requires_consent: boolean;
    notice: { content_ref: string; version_no: number };
  }[];
}

export interface Cmp030Module {
  registerConsentPrivacy: (instance: FastifyInstance, opts: unknown) => Promise<void>;
}

export interface ConsentAccessPortLike {
  check(input: {
    tenant_id: string;
    subject_id: string;
    purpose_code: string;
    correlation_id: string;
  }): Promise<{ allowed: boolean; reason_code: string }>;
}

export interface LabPrivacy {
  consentAccess: ConsentAccessPortLike;
  /**
   * Ensures every fixture purpose exists with a PUBLISHED notice. Idempotent across restarts;
   * `notice_id` is null when the notice version was recorded by an earlier start.
   */
  publish(): Promise<{ code: string; purpose_id: string; notice_id: string | null }[]>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function parseConsentFixture(raw: unknown): LabConsentFixture {
  const f = raw as LabConsentFixture;
  if (f?.simulation !== 'SIMULATED') throw new Error('SF-M10: consent fixture must be SIMULATED');
  for (const actor of [f.publisher, f.gate]) {
    if (!actor || !UUID.test(actor.actor_id) || !Array.isArray(actor.roles)) {
      throw new Error('SF-M10: consent fixture workload is invalid');
    }
  }
  if (f.publisher.actor_id === f.gate.actor_id) {
    throw new Error('SF-M10: consent publisher and gate must be distinct workloads');
  }
  if (!Array.isArray(f.purposes) || f.purposes.length === 0) {
    throw new Error('SF-M10: consent fixture has no purposes');
  }
  for (const p of f.purposes) {
    if (!CODE.test(p.code) || !p.notice || !Number.isInteger(p.notice.version_no)) {
      throw new Error('SF-M10: consent fixture purpose is invalid');
    }
  }
  return f;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

class ConsentPortError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`CMP-030 ${status} ${code}`);
    this.name = 'ConsentPortError';
  }
}

export function composeLabPrivacy(params: {
  environment: string;
  cmp030: Cmp030Module;
  pool: unknown;
  pdp: { decide: (input: unknown) => Promise<unknown> };
  fixture: LabConsentFixture;
  placement: Pick<PortalPlacement, 'tenant_id' | 'cell_id'>;
}): LabPrivacy {
  assertSimulatorEnvironment(params.environment);
  const { fixture, placement } = params;
  const credentials = new Map<string, { actor_id: string; roles: string[] }>();
  const tokenFor = (actor: { actor_id: string; roles: string[] }) => {
    const token = randomBytes(32).toString('base64url');
    credentials.set(token, actor);
    return token;
  };
  const publisherToken = tokenFor(fixture.publisher);
  const gateToken = tokenFor(fixture.gate);

  let app: FastifyInstance | undefined;
  const internal = async (): Promise<FastifyInstance> => {
    if (app) return app;
    const instance = Fastify({ logger: false });
    await params.cmp030.registerConsentPrivacy(instance, {
      prefix: '/v1',
      pool: params.pool,
      authorizer: params.pdp,
      resolveContext: async (request: FastifyRequest): Promise<RequestContext | null> => {
        const auth = header(request, 'authorization') ?? '';
        const actor = auth.startsWith('Bearer ') ? credentials.get(auth.slice(7)) : undefined;
        if (!actor) return null;
        const supplied = header(request, 'x-correlation-id');
        const correlation_id = supplied && UUID.test(supplied) ? supplied : randomUUID();
        return {
          tenant_id: placement.tenant_id,
          cell_id: placement.cell_id,
          actor: { type: 'SYSTEM', id: actor.actor_id },
          roles: [...actor.roles],
          jurisdiction_ids: [],
          auth_assurance: 'WORKLOAD_IDENTITY',
          correlation_id,
          trace_id: correlation_id.replace(/-/g, ''),
        };
      },
    });
    await instance.ready();
    app = instance;
    return instance;
  };

  const call = async (
    token: string,
    method: 'GET' | 'POST',
    url: string,
    opts: { body?: unknown; key?: string; correlationId?: string } = {},
  ) => {
    const res = await (
      await internal()
    ).inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.key ? { 'idempotency-key': opts.key } : {}),
        ...(opts.correlationId ? { 'x-correlation-id': opts.correlationId } : {}),
      },
      ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
    });
    const body = res.json() as Record<string, unknown>;
    return { status: res.statusCode, body };
  };
  const expect2xx = (res: { status: number; body: Record<string, unknown> }) => {
    if (res.status < 200 || res.status > 299) {
      throw new ConsentPortError(res.status, String(res.body['error_code'] ?? 'UNKNOWN'));
    }
    return res.body;
  };

  return {
    consentAccess: {
      async check(input) {
        if (input.tenant_id !== placement.tenant_id) {
          return { allowed: false, reason_code: 'TENANT_MISMATCH' };
        }
        const body = expect2xx(
          await call(gateToken, 'POST', '/v1/privacy/access-check', {
            body: { subject_id: input.subject_id, purpose_code: input.purpose_code },
            correlationId: input.correlation_id,
          }),
        );
        return {
          allowed: body['allowed'] === true,
          reason_code: typeof body['reason_code'] === 'string' ? body['reason_code'] : 'UNKNOWN',
        };
      },
    },
    async publish() {
      const listed = expect2xx(await call(publisherToken, 'GET', '/v1/purposes'));
      const existing = new Map(
        ((listed['items'] as { code: string; purpose_id: string }[] | undefined) ?? []).map((p) => [
          p.code,
          p.purpose_id,
        ]),
      );
      const out: { code: string; purpose_id: string; notice_id: string | null }[] = [];
      for (const p of fixture.purposes) {
        let purposeId = existing.get(p.code);
        if (!purposeId) {
          const created = expect2xx(
            await call(publisherToken, 'POST', '/v1/purposes', {
              body: { code: p.code, label: p.label, requires_consent: p.requires_consent },
              key: `sample-lab:purpose:${p.code}`,
            }),
          );
          purposeId = String(created['purpose_id']);
        }
        const created = await call(publisherToken, 'POST', '/v1/privacy/notices', {
          body: {
            purpose_id: purposeId,
            content_ref: p.notice.content_ref,
            version_no: p.notice.version_no,
          },
          key: `sample-lab:notice:${p.code}:v${p.notice.version_no}`,
        });
        // CMP-030 declares a 24h idempotency TTL and has no notice read route: once the record is
        // gone, the version already recorded for an existing purpose answers with a conflict.
        if (
          existing.has(p.code) &&
          created.status === 409 &&
          created.body['error_code'] === 'SF-APP-002'
        ) {
          out.push({ code: p.code, purpose_id: purposeId, notice_id: null });
          continue;
        }
        const notice = expect2xx(created);
        const noticeId = String(notice['notice_id']);
        if (notice['status'] !== 'PUBLISHED') {
          expect2xx(
            await call(publisherToken, 'POST', `/v1/privacy/notices/${noticeId}/publish`, {
              key: `sample-lab:notice-publish:${p.code}:v${p.notice.version_no}`,
            }),
          );
        }
        out.push({ code: p.code, purpose_id: purposeId, notice_id: noticeId });
      }
      return out;
    },
    async close() {
      await app?.close();
      app = undefined;
    },
  };
}
