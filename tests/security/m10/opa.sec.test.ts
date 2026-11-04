import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { API, BINDING_A, call, citizenOnHost, OPA, ROOT, TENANT_A } from './lib/lab';

async function decide(input: unknown): Promise<{ allow: boolean; reason_code: string }> {
  const res = await fetch(`${OPA}/v1/data/sf/authz/decision`, {
    method: 'POST',
    headers: { authorization: 'Bearer pep', 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const body = (await res.json()) as { result: { allow: boolean; reason_code: string } };
  return body.result;
}

const OWNER = '0d15ba00-cccc-4000-8000-00000000c001';
function citizenInput(over: { subject?: object; resource?: object; action?: string } = {}) {
  return {
    subject: {
      user_id: OWNER,
      actor_type: 'CITIZEN',
      tenant_id: TENANT_A,
      roles: [],
      jurisdiction_ids: [],
      assurance: 'OTP',
      ...over.subject,
    },
    resource: {
      resource_type: 'ApplicationCase',
      tenant_id: TENANT_A,
      classification: 'TENANT_SCOPED',
      owner_id: OWNER,
      ...over.resource,
    },
    action: over.action ?? 'APPLICATION_READ',
    environment: { request_time: new Date().toISOString() },
  };
}

describe('SEC-OPA citizen owner path (real OPA, m10-b1 bundle + lab tenant data)', () => {
  it('owner read is allowed (control)', async () => {
    expect((await decide(citizenInput())).allow).toBe(true);
  });
  it('non-owner citizen is denied', async () => {
    const d = await decide(
      citizenInput({ resource: { owner_id: '0d15ba00-cccc-4000-8000-00000000c002' } }),
    );
    expect(d).toMatchObject({ allow: false });
  });
  it('missing, empty or non-string owner_id is denied', async () => {
    for (const owner_id of [undefined, '', null, 1, [OWNER]]) {
      expect((await decide(citizenInput({ resource: { owner_id } }))).allow).toBe(false);
    }
  });
  it('citizen presenting roles is denied CITIZEN_ROLES_FORBIDDEN (even with a valid tenant role)', async () => {
    const d = await decide(
      citizenInput({
        subject: { roles: ['SAMPLE_LAB_CASE_OFFICER'] },
        action: 'APPLICATION_RECORD_APPROVED',
      }),
    );
    expect(d).toEqual(
      expect.objectContaining({ allow: false, reason_code: 'CITIZEN_ROLES_FORBIDDEN' }),
    );
  });
  it('owning citizen cannot take officer actions', async () => {
    for (const action of [
      'APPLICATION_MARK_RECEIVED',
      'APPLICATION_RECORD_APPROVED',
      'APPLICATION_RECORD_REJECTED',
      'APPLICATION_CLOSE',
    ]) {
      expect((await decide(citizenInput({ action }))).allow).toBe(false);
    }
  });
  it('citizen with insufficient assurance is denied', async () => {
    for (const assurance of ['PASSWORD', 'NONE', '']) {
      expect((await decide(citizenInput({ subject: { assurance } }))).allow).toBe(false);
    }
  });
  it('tenant mismatch and unknown tenant are denied for the owner', async () => {
    expect(
      (
        await decide(
          citizenInput({ resource: { tenant_id: '0d15ba00-0001-4000-8000-0d15ba00ffff' } }),
        )
      ).allow,
    ).toBe(false);
    const other = '0d15ba00-0001-4000-8000-0d15ba00ffff';
    expect(
      (
        await decide(
          citizenInput({ subject: { tenant_id: other }, resource: { tenant_id: other } }),
        )
      ).allow,
    ).toBe(false);
  });
  it('actor_type spoofing (OFFICER with no roles, owner match) is denied', async () => {
    expect((await decide(citizenInput({ subject: { actor_type: 'OFFICER' } }))).allow).toBe(false);
  });
  it('OPA management API is not reachable with the PEP token (no data/policy writes)', async () => {
    const put = await fetch(`${OPA}/v1/data/sf/common/citizen_owner_grants`, {
      method: 'PUT',
      headers: { authorization: 'Bearer pep', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(put.status).toBe(401);
    const pol = await fetch(`${OPA}/v1/policies`, { headers: { authorization: 'Bearer pep' } });
    expect(pol.status).toBe(401);
    const anon = await fetch(`${OPA}/v1/data/sf/authz/decision`, { method: 'POST', body: '{}' });
    expect(anon.status).toBe(401);
  });
  it('F-13 (pre-existing CMP-048): OPA bearer tokens are not literal identity names', async () => {
    const res = await fetch(`${OPA}/v1/data/sf_runtime`, {
      headers: { authorization: 'Bearer grant-publisher' },
    });
    expect.soft(res.status, 'grant-publisher literal token accepted').toBe(401);
  });
});

describe('SEC-OPA-FAILCLOSED host with OPA stopped', () => {
  const state = join(ROOT, '.platform-lab');
  const port = new URL(OPA).port;

  async function opaHealthy(): Promise<boolean> {
    const ok = await fetch(`${OPA}/health`, { headers: { authorization: 'Bearer pep' } }).catch(
      () => null,
    );
    return Boolean(ok?.ok);
  }

  async function restartOpa(): Promise<void> {
    const child = spawn(
      'opa',
      [
        'run',
        '--server',
        `--addr=127.0.0.1:${port}`,
        '--authentication=token',
        '--authorization=basic',
        '--ignore=.manifest',
        '--log-level=error',
        join(ROOT, 'policy/opa'),
        join(ROOT, 'fixtures/lab/platform/opa'),
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    writeFileSync(join(state, 'opa.pid'), String(child.pid));
    for (let i = 0; i < 60; i += 1) {
      if (await opaHealthy()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('OPA did not restart');
  }

  afterAll(async () => {
    if (!(await opaHealthy())) await restartOpa();
  });

  it('every OPA-guarded read and write is refused while OPA is down (fail closed)', async () => {
    const c = await citizenOnHost();
    const draft = await call(API, 'POST', '/v1/applications', {
      token: c.token,
      idem: true,
      body: { tenant_service_binding_id: BINDING_A },
    });
    expect(draft.status).toBe(201);
    const id = (draft.body['application'] as { application_id: string }).application_id;

    process.kill(Number(readFileSync(join(state, 'opa.pid'), 'utf8')), 'SIGTERM');
    for (let i = 0; i < 40; i += 1) {
      const up = await fetch(`${OPA}/health`).catch(() => null);
      if (!up) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const probes = [
      await call(API, 'GET', '/v1/applications', { token: c.token }),
      await call(API, 'GET', `/v1/applications/${id}`, { token: c.token }),
      await call(API, 'GET', `/v1/applications/${id}/transitions`, { token: c.token }),
      await call(API, 'POST', '/v1/applications', {
        token: c.token,
        idem: true,
        body: { tenant_service_binding_id: BINDING_A },
      }),
      await call(API, 'POST', `/v1/applications/${id}/commands`, {
        token: c.token,
        idem: true,
        body: { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 },
      }),
    ];
    for (const p of probes) {
      expect(p.status).toBeGreaterThanOrEqual(403);
      expect(p.status).not.toBe(404);
      expect(p.body['application']).toBeUndefined();
      expect(p.body['applications']).toBeUndefined();
    }
  });

  it('after OPA returns, the host recovers (PEP breaker closes) without a restart', async () => {
    await restartOpa();
    const c = await citizenOnHost();
    const started = Date.now();
    let status = 0;
    while (Date.now() - started < 90_000) {
      status = (await call(API, 'GET', '/v1/applications', { token: c.token })).status;
      if (status === 200) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.warn(`SEC-OPA-FAILCLOSED: host recovered in ${Date.now() - started} ms`);
    expect(status).toBe(200);
  }, 120_000);
});
