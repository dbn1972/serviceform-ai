import { beforeEach, describe, expect, it } from 'vitest';
import { Cmp027Error } from '../../src/errors.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/events.js';
import { inDomainTransaction } from '../../src/tx-scope.js';
import type { GrievanceStatus, TransitionCommand } from '../../src/domain/model.js';
import {
  AI_GATEWAY,
  CANARY,
  CITIZEN,
  ctx,
  FIXED_ASSIGNMENT,
  harness,
  key,
  OFFICER,
  SYSTEM,
  T1,
  T2,
  type Harness,
} from '../doubles/fixtures.js';
import { MemoryGrievanceStore } from '../doubles/memory-store.js';

const citizen = () => ctx(T1, 'CITIZEN', CITIZEN);
const officer = () => ctx(T1, 'OFFICER', OFFICER);
const system = () => ctx(T1, 'SYSTEM', SYSTEM);
const ai = () => ctx(T1, 'INTEGRATION', AI_GATEWAY);

let store: MemoryGrievanceStore;
let h: Harness;

beforeEach(() => {
  store = new MemoryGrievanceStore();
  h = harness(store);
});

async function expectError(
  p: Promise<unknown>,
  code: string,
  detailCode?: string,
): Promise<Cmp027Error> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Cmp027Error);
  const e = err as Cmp027Error;
  expect(e.code).toBe(code);
  if (detailCode) expect(e.details?.map((d) => d.code)).toContain(detailCode);
  return e;
}

async function file(kind: 'GRIEVANCE' | 'FEEDBACK' = 'GRIEVANCE'): Promise<string> {
  const res = await h.service.file(citizen(), {}, key(`file-${kind}`), kind);
  return (res.body as { grievance: { grievance_id: string } }).grievance.grievance_id;
}

function stateOf(id: string): { status: GrievanceStatus; version: number } {
  const row = store.state.grievances.get(id);
  if (!row) throw new Error('missing');
  return { status: row.status, version: row.aggregate_version };
}

async function run(
  c: ReturnType<typeof citizen>,
  id: string,
  command: TransitionCommand,
  extra: Record<string, unknown> = {},
) {
  const s = stateOf(id);
  return h.service.executeCommand(
    c,
    id,
    { command, expected_status: s.status, expected_version: s.version, ...extra },
    key(`${command.toLowerCase()}-${id.slice(0, 8)}`),
  );
}

async function toOpen(id: string): Promise<void> {
  await run(officer(), id, 'CATEGORISE', { category_code: 'DELAY' });
  await run(officer(), id, 'ROUTE');
  await run(officer(), id, 'REQUEST_ASSIGNMENT');
}

describe('CMP-027 grievance/feedback service', () => {
  it('files a grievance with reference, outbox events and audit; never trusts X-Tenant-ID (server ctx)', async () => {
    const res = await h.service.file(citizen(), {}, key('file-g'), 'GRIEVANCE');
    expect(res.status).toBe(201);
    const g = (res.body as { grievance: { reference_code: string; status: string } }).grievance;
    expect(g.status).toBe('FILED');
    expect(g.reference_code.startsWith('GF-')).toBe(true);
    expect(store.outboxFor(T1, TOPIC_DOMAIN).length).toBeGreaterThan(0);
    expect(store.outboxFor(T1, TOPIC_AUDIT).length).toBeGreaterThan(0);
    expect(h.workflow.signals[0]?.to_status).toBe('FILED');
    expect(h.notify.sent).toContain('GRIEVANCE_FILED');
  });

  it('records feedback as a distinct kind on the same machine', async () => {
    const res = await h.service.file(citizen(), {}, key('fb'), 'FEEDBACK');
    expect((res.body as { grievance: { kind: string } }).grievance.kind).toBe('FEEDBACK');
  });

  it('NEGATIVE: wrong tenant cannot read another tenant grievance (CROSS_TENANT_LEAKAGE=0)', async () => {
    const id = await file();
    await expectError(h.service.get(ctx(T2, 'OFFICER', OFFICER), id), 'SF-SYS-002');
    const other = await h.service.get(ctx(T2, 'OFFICER', OFFICER), CANARY).catch((e: unknown) => e);
    expect(other).toBeInstanceOf(Cmp027Error);
    expect(JSON.stringify(other)).not.toContain(id);
  });

  it('is idempotent on file', async () => {
    const a = await h.service.file(citizen(), {}, key('dup-file'), 'GRIEVANCE');
    const b = await h.service.file(citizen(), {}, key('dup-file'), 'GRIEVANCE');
    expect(b.replayed).toBe(true);
    expect(b.body).toEqual(a.body);
    expect(store.state.grievances.size).toBe(1);
  });

  it('routes via policy assignment without named officers; task port only when application linked', async () => {
    const id = await file();
    await toOpen(id);
    expect(stateOf(id).status).toBe('OPEN');
    expect(h.tasks.created).toHaveLength(0);
    const linked = await h.service.file(
      citizen(),
      { application_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      key('linked'),
      'GRIEVANCE',
    );
    const lid = (linked.body as { grievance: { grievance_id: string } }).grievance.grievance_id;
    await run(officer(), lid, 'CATEGORISE', { category_code: 'DELAY' });
    await run(officer(), lid, 'ROUTE');
    await run(officer(), lid, 'REQUEST_ASSIGNMENT');
    expect(h.tasks.created[0]?.assignment).toEqual(FIXED_ASSIGNMENT);
    expect(h.tasks.created[0]?.application_id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });

  it('NEGATIVE: named officer field in assignment is refused', async () => {
    const id = await file();
    await run(officer(), id, 'CATEGORISE', { category_code: 'DELAY' });
    await run(officer(), id, 'ROUTE');
    await expectError(
      run(officer(), id, 'REQUEST_ASSIGNMENT', {
        assignment: {
          role_code: 'GRIEVANCE_OFFICER',
          organisation_id: FIXED_ASSIGNMENT.organisation_id,
          jurisdiction_id: FIXED_ASSIGNMENT.jurisdiction_id,
          officer_name: 'REDACTED',
        },
      }),
      'SF-SYS-003',
      'NAMED_OFFICER_FORBIDDEN',
    );
  });

  it('records a response as opaque body_ref (no free-text PII column)', async () => {
    const id = await file();
    await toOpen(id);
    const res = await run(officer(), id, 'RECORD_RESPONSE', { body_ref: 'evd:resp-0001' });
    expect((res.body as { grievance: { status: string } }).grievance.status).toBe(
      'PENDING_RESPONSE',
    );
    const listed = await h.service.listResponses(officer(), id);
    expect((listed.body as { responses: { body_ref: string }[] }).responses[0]?.body_ref).toBe(
      'evd:resp-0001',
    );
  });

  it('NEGATIVE: AI / INTEGRATION cannot close or resolve a statutory grievance', async () => {
    const id = await file();
    await toOpen(id);
    await expectError(run(ai(), id, 'RESOLVE'), 'SF-AUTH-002', 'AI_FINAL_DISPOSITION_FORBIDDEN');
    await expectError(
      run(system(), id, 'RESOLVE'),
      'SF-AUTH-002',
      'HUMAN_OFFICER_DISPOSITION_REQUIRED',
    );
    await run(officer(), id, 'RESOLVE');
    expect(stateOf(id).status).toBe('RESOLVED');
    await expectError(run(ai(), id, 'CLOSE'), 'SF-AUTH-002', 'AI_FINAL_DISPOSITION_FORBIDDEN');
    await run(officer(), id, 'CLOSE');
    expect(stateOf(id).status).toBe('CLOSED');
  });

  it('AI assist is advisory and cannot change status or issue disposition kinds', async () => {
    const id = await file();
    const ok = await h.service.recordAiAssist(
      ai(),
      id,
      { kind: 'CLASSIFY', suggestion_code: 'DELAY' },
      key('ai-ok'),
    );
    expect(ok.status).toBe(202);
    expect((ok.body as { advisory_only: boolean; grievance_status: string }).advisory_only).toBe(
      true,
    );
    expect(stateOf(id).status).toBe('FILED');
    await expectError(
      h.service.recordAiAssist(ai(), id, { kind: 'CLOSE' }, key('ai-close')),
      'SF-AUTH-002',
      'AI_FINAL_DISPOSITION_FORBIDDEN',
    );
    await expectError(
      h.service.recordAiAssist(ai(), id, { kind: 'LEGAL_DISPOSITION' }, key('ai-legal')),
      'SF-AUTH-002',
      'AI_FINAL_DISPOSITION_FORBIDDEN',
    );
    await expectError(
      h.service.recordAiAssist(ai(), id, { kind: 'ENTITLEMENT' }, key('ai-ent')),
      'SF-AUTH-002',
      'AI_FINAL_DISPOSITION_FORBIDDEN',
    );
    await expectError(
      h.service.recordAiAssist(ai(), id, { kind: 'APPEAL' }, key('ai-appeal')),
      'SF-AUTH-002',
      'AI_FINAL_DISPOSITION_FORBIDDEN',
    );
  });

  it('NEGATIVE: network I/O inside the domain transaction is refused', async () => {
    store.hooks.onOutbox = async () => {
      expect(inDomainTransaction()).toBe(true);
      await h.service.ports.authorizer.decide({
        subject: {
          user_id: CITIZEN,
          actor_type: 'CITIZEN',
          tenant_id: T1,
          roles: ['APPLICANT'],
          jurisdiction_ids: [],
        },
        resource: { resource_type: 'GrievanceFeedback', tenant_id: T1 },
        action: 'X',
      });
    };
    await expectError(
      h.service.file(citizen(), {}, key('io-in-tx'), 'GRIEVANCE'),
      'SF-SYS-001',
      'NETWORK_IO_IN_DOMAIN_TX',
    );
  });

  it('OPA deny fails closed; missing tenant context is unauthenticated', async () => {
    h.authorizer.denied.add('GRIEVANCE_FILE');
    await expectError(h.service.file(citizen(), {}, key('deny'), 'GRIEVANCE'), 'SF-AUTH-002');
    await expectError(h.service.file(null, {}, key('noctx'), 'GRIEVANCE'), 'SF-AUTH-001');
  });

  it('citizen may withdraw; officer may resolve feedback without AI', async () => {
    const id = await file('FEEDBACK');
    await run(citizen(), id, 'WITHDRAW');
    expect(stateOf(id).status).toBe('WITHDRAWN');
  });

  it('stale expected_status is rejected', async () => {
    const id = await file();
    await expectError(
      h.service.executeCommand(
        officer(),
        id,
        {
          command: 'CATEGORISE',
          expected_status: 'OPEN',
          expected_version: 1,
          category_code: 'DELAY',
        },
        key('stale'),
      ),
      'SF-APP-001',
      'STALE_STATUS',
    );
  });
});
