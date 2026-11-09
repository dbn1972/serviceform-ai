import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  composeLabPrivacy,
  parseConsentFixture,
  type Cmp030Module,
  type LabConsentFixture,
} from '../src/platform/profile.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const LAB = join(ROOT, 'fixtures/lab/platform');
const fixture = parseConsentFixture(
  JSON.parse(readFileSync(join(LAB, 'consent.json'), 'utf8')) as unknown,
);
const placement = { tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1', cell_id: 'cell-01' };
const SUBJECT = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const CORRELATION = '9b2f5c0e-4f6a-4c1e-9d3b-2a1b3c4d5e6f';

type Resolver = (request: FastifyRequest) => Promise<Record<string, unknown> | null>;
interface Seen {
  method: string;
  url: string;
  key?: string;
  ctx: Record<string, unknown> | null;
  body: unknown;
}

/** Stand-in for the CMP-030 plugin: records the context it would run under and replies per route. */
function fakeCmp030(
  reply: (seen: Seen) => { status: number; body: Record<string, unknown> },
  seen: Seen[] = [],
): { module: Cmp030Module; seen: Seen[]; opts: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  return {
    seen,
    opts: () => captured,
    module: {
      async registerConsentPrivacy(app: FastifyInstance, opts: unknown) {
        captured = opts as Record<string, unknown>;
        const resolve = captured['resolveContext'] as Resolver;
        app.all('/v1/*', async (request, res) => {
          const keyHeader = request.headers['idempotency-key'];
          const entry: Seen = {
            method: request.method,
            url: request.url,
            ctx: await resolve(request),
            body: request.body,
            ...(typeof keyHeader === 'string' ? { key: keyHeader } : {}),
          };
          seen.push(entry);
          if (!entry.ctx) return res.code(401).send({ error_code: 'SF-AUTH-001' });
          const out = reply(entry);
          return res.code(out.status).send(out.body);
        });
      },
    },
  };
}

const pdp = { decide: async () => ({ allow: true }) };

function compose(cmp030: Cmp030Module, environment = 'LOCAL', f: LabConsentFixture = fixture) {
  return composeLabPrivacy({ environment, cmp030, pool: {}, pdp, fixture: f, placement });
}

describe('SAMPLE_LAB consent fixture (SF-M10-B-2d)', () => {
  it('is SIMULATED, with distinct publisher and gate workloads', () => {
    expect(fixture.simulation).toBe('SIMULATED');
    expect(fixture.publisher.actor_id).not.toBe(fixture.gate.actor_id);
    expect(fixture.gate.roles).toEqual(['SAMPLE_LAB_CONSENT_GATE']);
    expect(fixture.purposes.map((p) => p.code)).toContain('SAMPLE_LAB_PROFILE_PREFILL');
  });

  it('rejects a non-simulated, shared-identity or empty fixture', () => {
    expect(() => parseConsentFixture({ ...fixture, simulation: 'REAL' })).toThrow(/SIMULATED/);
    expect(() =>
      parseConsentFixture({
        ...fixture,
        gate: { ...fixture.gate, actor_id: fixture.publisher.actor_id },
      }),
    ).toThrow(/distinct/);
    expect(() => parseConsentFixture({ ...fixture, purposes: [] })).toThrow(/no purposes/);
    expect(() =>
      parseConsentFixture({
        ...fixture,
        purposes: [{ ...fixture.purposes[0], code: 'lower-case' }],
      }),
    ).toThrow(/purpose is invalid/);
  });

  it('refuses environments other than LOCAL/CI', () => {
    const fake = fakeCmp030(() => ({ status: 200, body: {} }));
    for (const env of ['SIT', 'UAT', 'PREPROD', 'PRODUCTION']) {
      expect(() => compose(fake.module, env)).toThrow(/refused/);
    }
  });
});

describe('CMP-005 ConsentAccessPort over the CMP-030 access-check contract', () => {
  it('runs as the gate workload in the placement tenant and returns the CMP-030 decision', async () => {
    const fake = fakeCmp030(() => ({
      status: 200,
      body: { allowed: true, reason_code: 'OK', consent_status: 'GRANTED' },
    }));
    const privacy = compose(fake.module);
    try {
      const result = await privacy.consentAccess.check({
        tenant_id: placement.tenant_id,
        subject_id: SUBJECT,
        purpose_code: 'SAMPLE_LAB_PROFILE_PREFILL',
        correlation_id: CORRELATION,
      });
      expect(result).toEqual({ allowed: true, reason_code: 'OK' });
      expect(fake.seen).toHaveLength(1);
      expect(fake.seen[0]).toMatchObject({
        method: 'POST',
        url: '/v1/privacy/access-check',
        body: { subject_id: SUBJECT, purpose_code: 'SAMPLE_LAB_PROFILE_PREFILL' },
        ctx: {
          tenant_id: placement.tenant_id,
          cell_id: placement.cell_id,
          actor: { type: 'SYSTEM', id: fixture.gate.actor_id },
          roles: ['SAMPLE_LAB_CONSENT_GATE'],
          jurisdiction_ids: [],
          auth_assurance: 'WORKLOAD_IDENTITY',
          correlation_id: CORRELATION,
        },
      });
      expect(fake.opts()['authorizer']).toBe(pdp);
    } finally {
      await privacy.close();
    }
  });

  it('denies a foreign tenant without calling CMP-030', async () => {
    const fake = fakeCmp030(() => ({ status: 200, body: { allowed: true, reason_code: 'OK' } }));
    const privacy = compose(fake.module);
    const result = await privacy.consentAccess.check({
      tenant_id: '22222222-2222-4222-8222-222222222222',
      subject_id: SUBJECT,
      purpose_code: 'SAMPLE_LAB_PROFILE_PREFILL',
      correlation_id: CORRELATION,
    });
    expect(result).toEqual({ allowed: false, reason_code: 'TENANT_MISMATCH' });
    expect(fake.seen).toHaveLength(0);
    await privacy.close();
  });

  it('fails closed when CMP-030 refuses or is unavailable, and on a non-boolean answer', async () => {
    const denied = compose(
      fakeCmp030(() => ({ status: 403, body: { error_code: 'SF-AUTH-002' } })).module,
    );
    await expect(
      denied.consentAccess.check({
        tenant_id: placement.tenant_id,
        subject_id: SUBJECT,
        purpose_code: 'SAMPLE_LAB_PROFILE_PREFILL',
        correlation_id: CORRELATION,
      }),
    ).rejects.toThrow(/403 SF-AUTH-002/);
    await denied.close();
    const odd = compose(
      fakeCmp030(() => ({ status: 200, body: { allowed: 'yes', reason_code: 'OK' } })).module,
    );
    expect(
      (
        await odd.consentAccess.check({
          tenant_id: placement.tenant_id,
          subject_id: SUBJECT,
          purpose_code: 'SAMPLE_LAB_PROFILE_PREFILL',
          correlation_id: CORRELATION,
        })
      ).allowed,
    ).toBe(false);
    await odd.close();
  });

  it('gives no context to an unknown bearer on the internal instance', async () => {
    const fake = fakeCmp030(() => ({ status: 200, body: {} }));
    const privacy = compose(fake.module);
    await privacy.consentAccess
      .check({
        tenant_id: placement.tenant_id,
        subject_id: SUBJECT,
        purpose_code: 'SAMPLE_LAB_PROFILE_PREFILL',
        correlation_id: CORRELATION,
      })
      .catch(() => undefined);
    const resolve = fake.opts()['resolveContext'] as Resolver;
    for (const authorization of [undefined, 'Bearer forged', 'Basic x']) {
      const ctx = await resolve({
        headers: authorization ? { authorization } : {},
      } as unknown as FastifyRequest);
      expect(ctx).toBeNull();
    }
    await privacy.close();
  });
});

describe('SIMULATED privacy publication (CMP-030 purpose + notice)', () => {
  const PURPOSE_ID = '0d15ba00-3030-4000-8000-0d15ba003030';
  const NOTICE_ID = '0d15ba00-3031-4000-8000-0d15ba003031';

  it('creates the purpose and notice under stable idempotency keys and publishes the notice', async () => {
    const fake = fakeCmp030((s) => {
      if (s.method === 'GET') return { status: 200, body: { items: [] } };
      if (s.url === '/v1/purposes') return { status: 201, body: { purpose_id: PURPOSE_ID } };
      if (s.url === '/v1/privacy/notices')
        return { status: 201, body: { notice_id: NOTICE_ID, status: 'DRAFT' } };
      return { status: 200, body: { notice_id: NOTICE_ID, status: 'PUBLISHED' } };
    });
    const privacy = compose(fake.module);
    const out = await privacy.publish();
    expect(out).toEqual([
      { code: 'SAMPLE_LAB_PROFILE_PREFILL', purpose_id: PURPOSE_ID, notice_id: NOTICE_ID },
    ]);
    expect(fake.seen.map((s) => [s.method, s.url, s.key])).toEqual([
      ['GET', '/v1/purposes', undefined],
      ['POST', '/v1/purposes', 'sample-lab:purpose:SAMPLE_LAB_PROFILE_PREFILL'],
      ['POST', '/v1/privacy/notices', 'sample-lab:notice:SAMPLE_LAB_PROFILE_PREFILL:v1'],
      [
        'POST',
        `/v1/privacy/notices/${NOTICE_ID}/publish`,
        'sample-lab:notice-publish:SAMPLE_LAB_PROFILE_PREFILL:v1',
      ],
    ]);
    for (const s of fake.seen) {
      expect(s.ctx).toMatchObject({
        actor: { type: 'SYSTEM', id: fixture.publisher.actor_id },
        roles: ['SAMPLE_LAB_PRIVACY_PUBLISHER'],
        tenant_id: placement.tenant_id,
      });
    }
    await privacy.close();
  });

  it('reuses an existing purpose and skips publishing an already published notice', async () => {
    const fake = fakeCmp030((s) => {
      if (s.method === 'GET')
        return {
          status: 200,
          body: { items: [{ code: 'SAMPLE_LAB_PROFILE_PREFILL', purpose_id: PURPOSE_ID }] },
        };
      return { status: 201, body: { notice_id: NOTICE_ID, status: 'PUBLISHED' } };
    });
    const privacy = compose(fake.module);
    await privacy.publish();
    expect(fake.seen.map((s) => s.url)).toEqual(['/v1/purposes', '/v1/privacy/notices']);
    expect(fake.seen[1]?.body).toMatchObject({ purpose_id: PURPOSE_ID, version_no: 1 });
    await privacy.close();
  });

  it('fails loudly when CMP-030 or OPA refuses the publication', async () => {
    const fake = fakeCmp030(() => ({ status: 403, body: { error_code: 'SF-AUTH-002' } }));
    const privacy = compose(fake.module);
    await expect(privacy.publish()).rejects.toThrow(/403 SF-AUTH-002/);
    await privacy.close();
  });
});
