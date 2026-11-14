import Fastify from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { describe, expect, it } from 'vitest';
import {
  registerStudioWorkflowRoutes,
  studioWorkflowAuthorizer,
  type StudioCallerLike,
} from '../src/platform/workflow-studio.js';

const TENANT = '0d15ba00-0001-4000-8000-0d15ba0000d1';
const OFFICER = '0d15ba00-0f02-4000-8000-0d15ba000f02';

function officer(): RequestContext {
  return {
    tenant_id: TENANT,
    cell_id: 'cell-local',
    actor: { type: 'OFFICER', id: OFFICER },
    roles: ['STUDIO_DESIGNER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '0d15ba00-00c3-4000-8000-0d15ba0000c3',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  } as RequestContext;
}

async function app(ctx: RequestContext | null) {
  const seen: { op: string; caller: StudioCallerLike; body: unknown }[] = [];
  const respond = (op: string) => async (caller: StudioCallerLike, body: unknown) => {
    seen.push({ op, caller, body });
    return op === 'bpmn'
      ? { status: 200, body: '<xml/>', contentType: 'application/xml' }
      : { status: 400, body: { error_code: 'SF-SYS-003', details: [{ code: op }] } };
  };
  const server = Fastify();
  await registerStudioWorkflowRoutes(server, {
    api: {
      check: respond('check'),
      importBpmn: respond('import'),
      createDraft: respond('draft'),
      exportVersionBpmn: respond('bpmn'),
    },
    resolveContext: async () => ctx,
  });
  return { server, seen };
}

// REQ: Phase C-2 — CMP-016 Studio routes take tenant and roles from the session only.
describe('SAMPLE_LAB CMP-016 Studio routes', () => {
  it('passes the server-resolved caller (session roles, never client headers) to CMP-016', async () => {
    const { server, seen } = await app(officer());
    const res = await server.inject({
      method: 'POST',
      url: '/v1/workflow-graphs/check',
      headers: { 'x-tenant-id': '22222222-2222-4222-8222-222222222222' },
      payload: { graph: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error_code: 'SF-SYS-003',
      correlation_id: officer().correlation_id,
    });
    expect(seen[0]?.caller).toMatchObject({
      tenant_id: TENANT,
      roles: ['STUDIO_DESIGNER'],
      actor: { type: 'OFFICER', id: OFFICER },
      assurance: 'MFA',
    });
    for (const url of ['/v1/workflow-graphs/import-bpmn', '/v1/workflow-drafts']) {
      expect((await server.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(400);
    }
    const xml = await server.inject({
      method: 'GET',
      url: `/v1/workflow-versions/${OFFICER}/bpmn`,
    });
    expect(xml.statusCode).toBe(200);
    expect(xml.headers['content-type']).toContain('application/xml');
    expect(xml.headers['cache-control']).toBe('no-store');
    expect(seen.map((s) => s.op)).toEqual(['check', 'import', 'draft', 'bpmn']);
  });

  it('refuses unauthenticated callers before reaching CMP-016', async () => {
    const { server, seen } = await app(null);
    const res = await server.inject({ method: 'POST', url: '/v1/workflow-drafts', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    expect(seen).toEqual([]);
  });

  it('asks OPA with the caller roles and tenant-scoped resource', async () => {
    const inputs: unknown[] = [];
    const authorize = studioWorkflowAuthorizer(
      {
        async decide(input) {
          inputs.push(input);
          return { allow: true };
        },
      },
      () => new Date('2026-11-10T00:00:00.000Z'),
    );
    const ctx = officer();
    const allowed = await authorize(
      {
        tenant_id: TENANT,
        cell_id: ctx.cell_id,
        actor: { type: 'OFFICER', id: OFFICER },
        correlation_id: ctx.correlation_id,
        trace_id: ctx.trace_id,
        roles: ['STUDIO_DESIGNER'],
        jurisdiction_ids: [],
      },
      'WORKFLOW_VERSION_DRAFT',
      { type: 'WorkflowDefinition' },
    );
    expect(allowed).toBe(true);
    expect(inputs[0]).toMatchObject({
      subject: { tenant_id: TENANT, roles: ['STUDIO_DESIGNER'], actor_type: 'OFFICER' },
      resource: { resource_type: 'WorkflowDefinition', tenant_id: TENANT },
      action: 'WORKFLOW_VERSION_DRAFT',
      environment: { request_time: '2026-11-10T00:00:00.000Z' },
    });
  });
});
