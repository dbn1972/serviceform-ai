import Fastify from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { describe, expect, it } from 'vitest';
import { composeStudioRules, registerStudioRulesRoutes } from '../src/platform/rules-studio.js';

const TENANT = '0d15ba00-0001-4000-8000-0d15ba0000d1';

function officer(roles: string[]): RequestContext {
  return {
    tenant_id: TENANT,
    cell_id: 'cell-local',
    actor: { type: 'OFFICER', id: '0d15ba00-0f02-4000-8000-0d15ba000f02' },
    roles,
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '0d15ba00-00c3-4000-8000-0d15ba0000c3',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  } as RequestContext;
}

// REQ: Phase C-3 — the CMP-008 test bench is authorised by OPA with session roles only.
describe('SAMPLE_LAB CMP-008 Studio test bench route', () => {
  it('asks OPA for RULE_PACK_TEST with the session roles and passes the caller through', async () => {
    const decisions: unknown[] = [];
    const seen: unknown[] = [];
    const api = composeStudioRules(
      {
        ZenRuleEngine: class StubEngine {
          readonly name = 'stub';
        },
        createStudioRulesApi: (deps) => ({
          async test(caller, body) {
            seen.push(body);
            const allowed = await deps.authorize(caller, 'RULE_PACK_TEST', { type: 'RulePack' });
            return allowed
              ? { status: 200, body: { advisory: true } }
              : { status: 403, body: { error_code: 'SF-AUTH-002' } };
          },
        }),
      },
      {
        async decide(input) {
          decisions.push(input);
          return {
            allow: (input as { subject: { roles: string[] } }).subject.roles.includes(
              'STUDIO_DESIGNER',
            ),
          };
        },
      },
    );
    for (const [roles, status] of [
      [['STUDIO_DESIGNER'], 200],
      [['SAMPLE_LAB_CASE_OFFICER'], 403],
    ] as const) {
      const server = Fastify();
      await registerStudioRulesRoutes(server, {
        api,
        resolveContext: async () => officer([...roles]),
      });
      const res = await server.inject({
        method: 'POST',
        url: '/v1/rule-packs/test',
        headers: { 'x-tenant-id': '22222222-2222-4222-8222-222222222222' },
        payload: { pack: {}, cases: [] },
      });
      expect(res.statusCode).toBe(status);
    }
    expect(decisions[0]).toMatchObject({
      action: 'RULE_PACK_TEST',
      subject: { tenant_id: TENANT, roles: ['STUDIO_DESIGNER'] },
      resource: { resource_type: 'RulePack', tenant_id: TENANT },
    });
    expect(seen).toHaveLength(2);
  });

  it('refuses unauthenticated callers', async () => {
    const server = Fastify();
    await registerStudioRulesRoutes(server, {
      api: { test: async () => ({ status: 200, body: {} }) },
      resolveContext: async () => null,
    });
    const res = await server.inject({ method: 'POST', url: '/v1/rule-packs/test', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});
