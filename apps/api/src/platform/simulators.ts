import type { FastifyInstance } from 'fastify';

/** Environments where the lab simulators may be mounted (INT-013: never in UAT/PREPROD/PRODUCTION). */
export const SIMULATOR_ENVIRONMENTS: readonly string[] = ['LOCAL', 'CI'];

export function assertSimulatorEnvironment(environment: string): void {
  if (!SIMULATOR_ENVIRONMENTS.includes(environment)) {
    throw new Error(`SF-M10-B: SIMULATED lab simulators are refused in ${environment}`);
  }
}

/** Structural subset of CMP-004 OtpAdapter. */
export interface OtpAdapterLike {
  createChallenge(input: { challengeId: string; channelHash: string; testRunId: string }): {
    code: string;
    simulation: unknown;
  };
  dispatch(input: { challengeId: string; channelHash: string }): Promise<void>;
}

const INBOX_TTL_MS = 5 * 60 * 1000;
const INBOX_MAX = 10_000;

/**
 * SIMULATED SMS inbox. CMP-004 never returns an OTP; in the lab the code is readable only by
 * whoever holds the challenge id, which CMP-004 returns solely to the requester.
 */
export class SimulatedOtpInbox {
  private readonly codes = new Map<string, { code: string; expiresAt: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  wrap(inner: OtpAdapterLike): OtpAdapterLike {
    return {
      createChallenge: (input) => {
        const out = inner.createChallenge(input);
        this.record(input.challengeId, out.code);
        return out;
      },
      dispatch: (input) => inner.dispatch(input),
    };
  }

  record(challengeId: string, code: string): void {
    const now = this.clock();
    for (const [id, entry] of this.codes) {
      if (entry.expiresAt <= now) this.codes.delete(id);
    }
    if (this.codes.size >= INBOX_MAX) {
      const oldest = this.codes.keys().next();
      if (!oldest.done) this.codes.delete(oldest.value);
    }
    this.codes.set(challengeId, { code, expiresAt: now + INBOX_TTL_MS });
  }

  read(challengeId: string): string | null {
    const entry = this.codes.get(challengeId);
    if (!entry || entry.expiresAt <= this.clock()) return null;
    return entry.code;
  }
}

export interface LabOfficer {
  officer_id: string;
  subject: string;
  display_name: string;
  tenant_id: string;
  roles: string[];
}

export type MintAssertion = (claims: {
  sub: string;
  tenant_id: string;
  officer_id: string;
  roles: string[];
  assurance?: 'MFA' | 'PASSWORD';
  exp?: number;
}) => string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorBody(code: string, message: string, correlationId: string) {
  return { error_code: code, message, correlation_id: correlationId };
}

/** Mounts `/v1/simulated/*` lab endpoints. Responses are always labelled SIMULATED. */
export async function registerLabSimulators(
  app: FastifyInstance,
  opts: {
    environment: string;
    inbox: SimulatedOtpInbox;
    officers: readonly LabOfficer[];
    mint: MintAssertion;
    clock?: () => number;
  },
): Promise<void> {
  assertSimulatorEnvironment(opts.environment);
  const clock = opts.clock ?? Date.now;

  app.get<{ Params: { challengeId: string } }>(
    '/v1/simulated/otp-inbox/:challengeId',
    async (request, reply) => {
      const { challengeId } = request.params;
      const code = UUID.test(challengeId) ? opts.inbox.read(challengeId) : null;
      if (!code) {
        return reply
          .code(404)
          .send(errorBody('SF-SYS-002', 'Resource or route not found', request.id));
      }
      return reply
        .header('cache-control', 'no-store')
        .send({ challenge_id: challengeId, code, channel: 'SIMULATED_SMS', simulation: true });
    },
  );

  app.get('/v1/simulated/idp/officers', async (_request, reply) =>
    reply.header('cache-control', 'no-store').send({
      simulation: true,
      officers: opts.officers.map((o) => ({
        subject: o.subject,
        display_name: o.display_name,
        roles: o.roles,
      })),
    }),
  );

  app.post<{ Body: unknown }>('/v1/simulated/idp/assertions', async (request, reply) => {
    const body = request.body as { subject?: unknown } | null;
    const officer = opts.officers.find((o) => o.subject === body?.subject);
    if (!officer) {
      return reply.code(401).send(errorBody('SF-AUTH-001', 'Authentication required', request.id));
    }
    const assertion = opts.mint({
      sub: officer.subject,
      tenant_id: officer.tenant_id,
      officer_id: officer.officer_id,
      roles: officer.roles,
      assurance: 'MFA',
      exp: Math.floor(clock() / 1000) + 120,
    });
    return reply
      .header('cache-control', 'no-store')
      .send({ assertion, display_name: officer.display_name, simulation: true });
  });

  /**
   * SF-M10-B-4: Lab-only Studio/Admin session bootstrap. Accepts the same
   * { tenant_id, actor_id, roles } body that the Studio/Admin BFF sends, finds a matching
   * officer in the SIMULATED IdP directory, mints a CMP-004 assertion and exchanges it for an
   * opaque officer session token. Refused in production per assertSimulatorEnvironment above.
   *
   * The BFF stores only the opaque token in its cookie and forwards it as Authorization: Bearer
   * on every platform proxy call, so context resolution goes through CMP-004 (ADR-0007 D-1).
   */
  app.post<{ Body: unknown }>('/v1/simulated/studio-auth', async (request, reply) => {
    const body = request.body as {
      tenant_id?: unknown;
      actor_id?: unknown;
      roles?: unknown;
    } | null;
    if (
      typeof body?.tenant_id !== 'string' ||
      typeof body?.actor_id !== 'string' ||
      !Array.isArray(body?.roles)
    ) {
      return reply.code(400).send(errorBody('SF-SYS-003', 'Invalid request body', request.id));
    }
    if (!UUID.test(body.tenant_id) || !UUID.test(body.actor_id)) {
      return reply.code(400).send(errorBody('SF-SYS-003', 'Invalid UUID fields', request.id));
    }
    const roles = (body.roles as unknown[]).filter((r): r is string => typeof r === 'string');
    if (roles.length === 0) {
      return reply.code(400).send(errorBody('SF-SYS-003', 'At least one role required', request.id));
    }

    // Find the matching lab officer (match by tenant_id; actor_id maps to officer_id)
    const officer = opts.officers.find(
      (o) => o.tenant_id === body.tenant_id && o.officer_id === body.actor_id,
    ) ?? opts.officers.find((o) => o.tenant_id === body.tenant_id);

    const sub = officer?.subject ?? `lab-studio-${body.actor_id}`;
    const displayName = officer?.display_name ?? 'SAMPLE LAB Studio User';
    const effectiveRoles = roles.length > 0 ? roles : (officer?.roles ?? roles);

    // Mint a SIMULATED IdP assertion for this actor
    const assertion = opts.mint({
      sub,
      tenant_id: body.tenant_id,
      officer_id: body.actor_id,
      roles: effectiveRoles,
      assurance: 'MFA',
      exp: Math.floor(clock() / 1000) + 120,
    });

    // Exchange assertion for a CMP-004 officer session via inject() (no network round-trip)
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions',
      payload: { assertion },
      headers: { 'content-type': 'application/json', 'x-correlation-id': request.id },
    });

    if (sessionRes.statusCode !== 200) {
      let errCode = 'SF-SYS-004';
      try {
        const errBody = sessionRes.json<{ error_code?: string }>();
        if (typeof errBody === 'object' && errBody !== null && typeof errBody.error_code === 'string') {
          errCode = errBody.error_code;
        }
      } catch { /* ignore parse failures */ }
      return reply
        .code(sessionRes.statusCode >= 400 ? sessionRes.statusCode : 503)
        .send(errorBody(errCode, 'Session exchange failed', request.id));
    }

    let sessionToken: string | undefined;
    try {
      const sessionJson = sessionRes.json<{ session_token?: string }>();
      if (typeof sessionJson === 'object' && sessionJson !== null) {
        sessionToken = sessionJson.session_token;
      }
    } catch { /* ignore parse failures */ }
    if (!sessionToken) {
      return reply
        .code(503)
        .send(errorBody('SF-SYS-004', 'Session exchange returned no token', request.id));
    }

    return reply
      .header('cache-control', 'no-store')
      .send({
        session_token: sessionToken,
        display_name: displayName,
        simulation: true,
        g6_issued: false,
      });
  });
}
