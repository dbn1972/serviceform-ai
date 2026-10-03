import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AuditEvent,
  type ConnectorBinding,
  type ErrorResponse,
  type EventEnvelope,
  type RequestContext,
  ERROR_CATALOGUE,
  CONTRACTS_DIR,
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
});
