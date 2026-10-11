import { describe, expect, it } from 'vitest';
import {
  buildDeliveryWorker,
  buildNotificationApi,
  buildNotificationService,
  NotificationDeliveryWorker,
  NotificationService,
} from '../../src/index.js';
import { Cmp025Error, detail, mapPgError } from '../../src/errors.js';
import { assertNoTenantIdentifyingHeaders, isForbiddenHeaderName } from '../../src/context.js';
import { UnboundConnectorBindingPort } from '../../src/ports/connector-binding-port.js';
import { UnboundRecipientDirectoryPort } from '../../src/ports/recipient-directory-port.js';
import { NoopLogger, RecordingLogger, scrubFields } from '../../src/logging.js';
import { requestFingerprint, sha256Prefixed } from '../../src/domain/fingerprint.js';
import { envelopeOf } from '../../src/outbox.js';
import { authorize, authzInput, NOTIFICATION_ACTIONS } from '../../src/authz.js';
import { MemoryNotificationRepository } from '../doubles/memory-repo.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  TENANT_A,
  TENANT_B,
  CANARY_ADDRESS,
  ACTOR_OFFICER,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const base = { authorizer: new AllowAllAuthorizer(), environment: 'CI' as const };

describe('composition root', () => {
  it('requires a repository or pool and builds service, API and worker otherwise', () => {
    expect(() => buildNotificationService(base)).toThrow(Cmp025Error);
    const repository = new MemoryNotificationRepository();
    expect(
      buildNotificationService({
        ...base,
        repository,
        testRunId: 'r',
        workerId: 'w',
        sendTimeoutMs: 5,
        logger: new NoopLogger(),
      }),
    ).toBeInstanceOf(NotificationService);
    expect(buildDeliveryWorker({ ...base, repository })).toBeInstanceOf(NotificationDeliveryWorker);
    expect(
      typeof buildNotificationApi({
        ...base,
        repository,
        resolveContext: () => Promise.resolve(null),
      }).handle,
    ).toBe('function');
  });

  it('unbound ports fail closed', async () => {
    await expect(new UnboundConnectorBindingPort().resolve()).rejects.toMatchObject({
      code: 'SF-INT-001',
    });
    await expect(new UnboundRecipientDirectoryPort().resolve()).rejects.toMatchObject({
      code: 'SF-INT-001',
    });
    const h = makeHarness();
    const api = buildNotificationApi({
      ...base,
      repository: new MemoryNotificationRepository(),
      resolveContext: () => Promise.resolve(ctxFor(TENANT_A)),
    });
    await api.handle({
      method: 'POST',
      path: '/v1/notification-templates',
      headers: { 'idempotency-key': 'tpl-key-0001' },
      body: { template_ref: 'tpl.a', channel: 'SMS', locale: 'en-IN', body_template: 'x' },
    });
    const r = await api.handle({
      method: 'POST',
      path: '/v1/notifications',
      headers: { 'idempotency-key': 'dispatch-key-0001' },
      body: {
        template_ref: 'tpl.a',
        channel: 'SMS',
        locale: 'en-IN',
        recipient_handle_class: 'CITIZEN_HANDLE_REF',
        recipient_handle_ref: 'handle.demo.0001',
        connector_binding_id: '77777777-7777-4777-8777-777777777777',
      },
    });
    expect(r.status).toBe(503);
    expect(h.repo.txCount).toBe(0);
  });
});

describe('errors, context, logging, fingerprints, authz', () => {
  it('maps database error classes to catalogue codes', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError({ code: 'P0001' }).code).toBe('SF-APP-001');
    expect(mapPgError(new Error('x')).code).toBe('SF-SYS-001');
    const own = new Cmp025Error('SF-AUTH-002', detail('X', '/p'));
    expect(mapPgError(own)).toBe(own);
    expect(own.details).toEqual([{ code: 'X', pointer: '/p' }]);
  });

  it('rejects tenant-identifying and role-asserting headers', () => {
    for (const name of [
      'x-tenant-id',
      'X-SF-Anything',
      'x-roles',
      'x-org-id',
      'x-actor-type',
      'x-assurance',
    ])
      expect(isForbiddenHeaderName(name), name).toBe(true);
    expect(() =>
      assertNoTenantIdentifyingHeaders({ forwarded: 'for=1.2.3.4; tenant=abc' }),
    ).toThrow(Cmp025Error);
    expect(() => assertNoTenantIdentifyingHeaders({ forwarded: ['for=1.2.3.4'] })).not.toThrow();
    expect(() => assertNoTenantIdentifyingHeaders({ 'idempotency-key': 'abc' })).not.toThrow();
  });

  it('log scrubbing drops non-allow-listed keys and redacts PII-shaped values', () => {
    const out = scrubFields({
      event: 'e',
      recipient_address: CANARY_ADDRESS,
      body: 'secret',
      error_code: CANARY_ADDRESS,
      count: 2,
    });
    expect(out).toEqual({ event: 'e', error_code: '[REDACTED]', count: 2 });
    const rec = new RecordingLogger();
    rec.warn({ event: 'w' });
    expect(rec.lines).toEqual([{ level: 'warn', event: 'w' }]);
    const noop = new NoopLogger();
    noop.info();
    noop.warn();
  });

  it('request fingerprints are stable across key order and sensitive to route and body', () => {
    expect(requestFingerprint('post', '/a', { b: 1, a: [1, { y: 1, x: 2 }] })).toBe(
      requestFingerprint('POST', '/a', { a: [1, { x: 2, y: 1 }], b: 1 }),
    );
    expect(requestFingerprint('POST', '/a', { a: 1 })).not.toBe(
      requestFingerprint('POST', '/b', { a: 1 }),
    );
    expect(requestFingerprint('POST', '/a', undefined)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sha256Prefixed('x')).toMatch(/^sha256:/);
  });

  it('refuses malformed envelopes and cross-tenant authorization inputs', async () => {
    const common = {
      eventType: 'E',
      tenantId: TENANT_A,
      cellId: 'cell-x',
      aggregateType: 'A',
      occurredAt: '2026-10-10T00:00:00Z',
      correlationId: 'not-a-uuid',
      actor: { type: 'SYSTEM' as const, id: ACTOR_OFFICER },
      data: {},
    };
    expect(() =>
      envelopeOf({
        ...common,
        aggregateId: '11111111-1111-4111-8111-111111111111',
        aggregateVersion: 1,
      }),
    ).toThrow(Cmp025Error);
    const input = authzInput(ctxFor(TENANT_A), NOTIFICATION_ACTIONS.read, 'NotificationDispatch');
    await expect(
      authorize(new AllowAllAuthorizer(), {
        ...input,
        resource: { ...input.resource, tenant_id: TENANT_B },
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
  });
});
