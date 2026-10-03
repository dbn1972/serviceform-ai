import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AuditEvent,
  type ConnectorBinding,
  type ErrorResponse,
  type EventEnvelope,
  type OutboxRecord,
  type RequestContext,
  ERROR_CATALOGUE,
  CONTRACTS_DIR,
  dbSessionSettings,
  errorEntry,
  validate,
} from '../src/index.js';

const example = <T>(kind: 'valid' | 'invalid', file: string): T =>
  JSON.parse(readFileSync(join(CONTRACTS_DIR, 'examples', kind, file), 'utf8')) as T;

describe('shared envelopes (REQ: AWS v1.7 s13.2-13.4, s14.3, s20.3; Eng v1.4 s10; TI v1.0 s6-7)', () => {
  it('accepts a snake_case event envelope and rejects the camelCase variant', () => {
    const ok = example<EventEnvelope>('valid', 'event-envelope.json');
    expect(validate('event-envelope', ok).valid).toBe(true);
    expect(
      validate('event-envelope', example('invalid', 'event-envelope.camel-case.json')).valid,
    ).toBe(false);
  });

  it('requires tenant context fields on a request context', () => {
    const ctx = example<RequestContext>('valid', 'request-context.officer.json');
    expect(validate('request-context', ctx).valid).toBe(true);
    const { tenant_id: _omit, ...withoutTenant } = ctx;
    expect(validate('request-context', withoutTenant).valid).toBe(false);
  });

  it('never allows extra fields (such as a stack trace) on an error response', () => {
    const ok = example<ErrorResponse>('valid', 'error-response.json');
    expect(validate('error-response', ok).valid).toBe(true);
    expect(validate('error-response', { ...ok, stack: 'trace' }).valid).toBe(false);
  });

  it('requires a reason for decision, override and privileged audit events', () => {
    const ok = example<AuditEvent>('valid', 'audit-event.json');
    expect(validate('audit-event', ok).valid).toBe(true);
    const { reason: _r, ...noReason } = ok;
    expect(validate('audit-event', noReason).valid).toBe(false);
    expect(validate('audit-event', { ...noReason, action_class: 'READ' }).valid).toBe(true);
  });

  it('fails closed on a critical SIMULATED connector in production (Constitution #22)', () => {
    const local = example<ConnectorBinding>('valid', 'connector-binding.local.json');
    expect(validate('connector-binding', local).valid).toBe(true);
    expect(
      validate('connector-binding', {
        ...local,
        environment: 'PRODUCTION',
        secret_ref: 'aws-sm://x',
      }).valid,
    ).toBe(false);
    expect(
      validate('connector-binding', {
        ...local,
        environment: 'PRODUCTION',
        mode: 'REAL',
        secret_ref: 'aws-sm://serviceform/payment',
      }).valid,
    ).toBe(true);
  });

  it('requires FORCE RLS for tenant- and jurisdiction-scoped entities', () => {
    expect(
      validate('isolation-declaration', example('valid', 'isolation-declaration.json')).valid,
    ).toBe(true);
    expect(
      validate(
        'isolation-declaration',
        example('invalid', 'isolation-declaration.tenant-without-rls.json'),
      ).valid,
    ).toBe(false);
  });

  it('has a unique, well-formed error catalogue', () => {
    const codes = ERROR_CATALOGUE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^SF-[A-Z]+-\d{3}$/);
    expect(errorEntry('SF-TEN-002').http).toEqual([403]);
    expect(() => errorEntry('SF-NOPE-999')).toThrow();
  });

  it('maps a request context to transaction-local DB settings (SF-CON-DB-SESSION-CONTEXT)', () => {
    const officer = example<RequestContext>('valid', 'request-context.officer.json');
    const settings = dbSessionSettings(officer);
    expect(validate('db-session-context', settings).valid).toBe(true);
    expect(settings['app.tenant_id']).toBe(officer.tenant_id);
    const citizen = example<RequestContext>('valid', 'request-context.citizen.json');
    const citizenSettings = dbSessionSettings({ ...citizen, tenant_id: null });
    expect('app.tenant_id' in citizenSettings).toBe(false);
    expect(validate('db-session-context', citizenSettings).valid).toBe(true);
  });

  it('keeps outbox row columns consistent with a valid envelope (SF-CON-OUTBOX)', () => {
    const row = example<OutboxRecord>('valid', 'outbox-record.json');
    expect(validate('outbox-record', row).valid).toBe(true);
    expect(row.event_id).toBe(row.envelope.event_id);
    expect(row.tenant_id).toBe(row.envelope.tenant_id);
    expect(
      validate('outbox-record', { ...row, status: 'PUBLISHED', published_at: undefined }).valid,
    ).toBe(false);
  });

  it('requires a purpose for integration actors (TI v1.0 s6)', () => {
    const ctx = example<RequestContext>('valid', 'request-context.integration.json');
    expect(validate('request-context', ctx).valid).toBe(true);
    const { purpose: _p, ...noPurpose } = ctx;
    expect(validate('request-context', noPurpose).valid).toBe(false);
  });
});
