import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpaPdpClient } from '@serviceform/security';
import type { AuthzDecisionInput } from '@serviceform/contracts';
import { T1, U1, startOpa, waitOpa } from './helpers.js';
import type { ChildProcess } from 'node:child_process';

const PORT = 18281;
const input: AuthzDecisionInput = {
  subject: {
    user_id: U1,
    actor_type: 'OFFICER',
    tenant_id: T1,
    roles: ['ROLE_A'],
    jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
    assurance: 'MFA',
  },
  resource: {
    resource_type: 'ExampleAggregate',
    tenant_id: T1,
    classification: 'TENANT_SCOPED',
    jurisdiction_id: '55555555-5555-4555-8555-555555555555',
  },
  action: 'VIEW',
  environment: {
    request_time: '2026-06-01T00:00:00Z',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  },
};

describe('real OPA 002-15 / fail-closed', () => {
  let child: ChildProcess | undefined;

  beforeAll(async () => {
    child = startOpa({ pepToken: 'pep', grantToken: 'grant-publisher', port: PORT });
    await waitOpa(PORT, 'pep');
  });

  afterAll(() => {
    child?.kill('SIGTERM');
  });

  it('unauthenticated Data API writes are denied', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/data/sf_runtime/privileged_grants/x`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    const pol = await fetch(`http://127.0.0.1:${PORT}/v1/policies/x`, {
      method: 'PUT',
      headers: { authorization: 'Bearer pep', 'content-type': 'text/plain' },
      body: 'package x\nallow := true',
    });
    expect(pol.status).toBeGreaterThanOrEqual(401);
  });

  it('PEP token may decide; unknown action denies', async () => {
    const pdp = new OpaPdpClient({
      opaUrl: `http://127.0.0.1:${PORT}`,
      token: 'pep',
      timeoutMs: 500,
    });
    const deny = await pdp.decide({ ...input, action: 'VIEW' });
    expect(deny.allow).toBe(false);
    expect(['POLICY_DATA_MISSING', 'ROLE_NOT_PERMITTED', 'INPUT_MISSING']).toContain(
      deny.reason_code,
    );
    const tenants = {
      [T1]: {
        roles: {
          ROLE_A: {
            actions: ['VIEW'],
            resource_types: ['ExampleAggregate'],
            jurisdiction_scope: 'TENANT_WIDE',
            all_services: true,
          },
        },
      },
    };
    const put = await fetch(`http://127.0.0.1:${PORT}/v1/data/sf/tenants`, {
      method: 'PUT',
      headers: { authorization: 'Bearer grant-publisher', 'content-type': 'application/json' },
      body: JSON.stringify(tenants),
    });
    expect(put.status).toBeGreaterThanOrEqual(401);
    const ok = await pdp.decide({ ...input, action: 'NOT_A_REAL_ACTION' });
    expect(ok.allow).toBe(false);
    expect(ok.reason_code).toBe('UNKNOWN_ACTION');
  });
});
