import { describe, expect, it } from 'vitest';
import { ACTOR_CITIZEN, ACTOR_CITIZEN_2, ctxFor, TENANT_A, TENANT_B } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function bookedInA(): Promise<{ h: ReturnType<typeof makeHarness>; id: string }> {
  const h = makeHarness();
  await h.publish('slot:a', { capacity: 2 });
  h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
  const res = await h.book('slot:a');
  expect(res.status).toBe(201);
  return { h, id: (res.body as Body)['appointment_id'] as string };
}

describe('tenant isolation (tenant-negative, INT-011)', () => {
  it('tenant B cannot read, reschedule, cancel or record outcomes on tenant A appointments', async () => {
    const { h, id } = await bookedInA();
    h.state.ctx = ctxFor(TENANT_B);
    const responses = [
      await h.call('GET', `/v1/appointments/${id}`),
      await h.call('POST', `/v1/appointments/${id}/cancel`, {}),
      await h.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:a' }),
      await h.call('POST', `/v1/appointments/${id}/attendance`, { outcome: 'NO_SHOW' }),
    ];
    h.state.ctx = ctxFor(TENANT_B, undefined, 'INTEGRATION');
    responses.push(
      await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, {
        outcome: 'FAILED',
        outcome_ref: 'notify:x',
        failure_code: 'SF-SYS-004',
      }),
    );
    for (const r of responses) expect(r.status).toBe(404);
    expect(JSON.stringify(responses.map((r) => r.body))).not.toContain(TENANT_A);
    const a = h.repo.tenant(TENANT_A);
    expect(a.appointments.get(id)).toMatchObject({ lifecycle_status: 'BOOKED', version: 1 });
    expect(a.outcomes).toHaveLength(0);
  });

  it('tenant B neither sees nor books tenant A slots, even with the same slot_ref', async () => {
    const { h } = await bookedInA();
    h.state.ctx = ctxFor(TENANT_B);
    expect(((await h.call('GET', '/v1/appointments/slots')).body as Body)['slots']).toEqual([]);
    expect((await h.book('slot:a')).status).toBe(404);
    await h.publish('slot:a');
    const own = await h.book('slot:a');
    expect(own.status).toBe(201);
    expect((own.body as Body)['tenant_id']).toBe(TENANT_B);
    const aSlot = [...h.repo.tenant(TENANT_A).slots.values()][0];
    const bSlot = [...h.repo.tenant(TENANT_B).slots.values()][0];
    expect(aSlot?.booked_count).toBe(1);
    expect(bSlot?.booked_count).toBe(1);
    expect(aSlot?.slot_id).not.toBe(bSlot?.slot_id);
    for (const o of h.repo.tenant(TENANT_B).outbox) expect(o.envelope.tenant_id).toBe(TENANT_B);
  });

  it('replaying tenant A Idempotency-Key from tenant B does not leak the stored response', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    const a = await h.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:a' },
      { key: 'shared-key-0001' },
    );
    h.state.ctx = ctxFor(TENANT_B);
    const b = await h.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:a' },
      { key: 'shared-key-0001' },
    );
    expect(b.status).toBe(404);
    expect(JSON.stringify(b.body)).not.toContain((a.body as Body)['appointment_id'] as string);
  });

  it('a citizen cannot see or act on another citizen appointment in the same tenant', async () => {
    const { h, id } = await bookedInA();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN_2, 'CITIZEN');
    expect((await h.call('GET', `/v1/appointments/${id}`)).status).toBe(404);
    expect((await h.call('POST', `/v1/appointments/${id}/cancel`, {})).status).toBe(404);
    expect(h.repo.tenant(TENANT_A).appointments.get(id)?.lifecycle_status).toBe('BOOKED');
  });

  it('missing or tenant-less context is refused before the PDP or any transaction', async () => {
    const h = makeHarness();
    const tx = h.repo.txCount;
    h.state.ctx = null;
    expect(((await h.book('slot:a')).body as Body)['error_code']).toBe('SF-AUTH-001');
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    expect(((await h.book('slot:a')).body as Body)['error_code']).toBe('SF-TEN-001');
    expect(h.authorizer.calls).toHaveLength(0);
    expect(h.repo.txCount).toBe(tx);
  });

  it.each([
    ['x-tenant-id', TENANT_B],
    ['X-SF-Tenant', TENANT_B],
    ['x-roles', 'ADMIN'],
    ['x-actor-type', 'SYSTEM'],
    ['forwarded', `for=192.0.2.1;tenant=${TENANT_B}`],
  ])('tenant/role-identifying header %s is refused', async (name, value) => {
    const h = makeHarness();
    const res = await h.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:a' },
      { headers: { [name]: value } },
    );
    expect(res.status).toBe(403);
    expect((res.body as Body)['error_code']).toBe('SF-TEN-002');
    expect(h.authorizer.calls).toHaveLength(0);
  });

  it('a client-supplied tenant_id in the body is refused, not honoured', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    const res = await h.book('slot:a', { tenant_id: TENANT_B });
    expect(res.status).toBe(400);
    expect(h.repo.tenant(TENANT_B).appointments.size).toBe(0);
  });

  it('a decision whose subject and resource tenants differ is denied before OPA', async () => {
    const { authorize, authzInput } = await import('../../src/authz.js');
    const h = makeHarness();
    const input = authzInput(ctxFor(TENANT_A), 'APPOINTMENT_BOOK', { resourceType: 'Appointment' });
    input.resource.tenant_id = TENANT_B;
    await expect(authorize(h.authorizer, input)).rejects.toMatchObject({ code: 'SF-TEN-002' });
    expect(h.authorizer.calls).toHaveLength(0);
  });
});
