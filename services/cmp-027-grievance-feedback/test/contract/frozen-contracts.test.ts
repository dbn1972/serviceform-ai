import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../../src/http.js';
import { Cmp027Error, ERROR_CATALOGUE } from '../../src/errors.js';
import { authzInput } from '../../src/authz.js';
import { envelopeOf, auditEnvelope } from '../../src/events.js';
import { isRequestContext } from '../../src/domain/validate.js';
import { ctx, CITIZEN, T1 } from '../doubles/fixtures.js';
import { IDS, REPO_ROOT, readJson, sharedSchema, validator } from '../support/frozen.js';

const SERVICE = join(REPO_ROOT, 'services/cmp-027-grievance-feedback');
const MIGRATION = join(REPO_ROOT, 'db/migrations/1759541270000_cmp-027-grievance-feedback.sql');
const OUTBOX = join(REPO_ROOT, 'db/migrations/1759541270001_cmp-027-outbox.sql');

describe('frozen shared contracts consumed by CMP-027', () => {
  it('error catalogue subset equals the FROZEN error-catalogue.json rows', () => {
    const frozen = readJson(join(REPO_ROOT, 'contracts/shared/error-catalogue.json')) as {
      codes: { code: string; message: string; http: number[] }[];
    };
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE)) {
      const row = frozen.codes.find((c) => c.code === code);
      expect({ code, message: row?.message, http: row?.http }).toEqual({
        code,
        message: entry.message,
        http: [...entry.http],
      });
    }
  });

  it('emitted envelopes, audit, request context and error responses validate', () => {
    const c = ctx(T1, 'CITIZEN', CITIZEN);
    expect(validator(IDS.requestContext)(c).valid).toBe(true);
    expect(isRequestContext(c)).toBe(true);
    const env = envelopeOf({
      eventType: 'GrievanceFiled',
      ctx: c,
      aggregateId: '11111111-1111-4111-8111-111111111111',
      aggregateVersion: 1,
      occurredAt: '2026-10-06T12:00:00.000Z',
      data: { status: 'FILED' },
    });
    expect(validator(IDS.envelope)(env).valid).toBe(true);
    const audit = auditEnvelope(c, {
      action: 'GRIEVANCE_FILE',
      actionClass: 'WRITE',
      resourceId: env.aggregate_id,
      result: 'SUCCESS',
      occurredAt: '2026-10-06T12:00:00.000Z',
    });
    expect(validator(IDS.envelope)(audit).valid).toBe(true);
    expect(validator(IDS.audit)(audit.data).valid).toBe(true);
    const err = errorResponse(new Cmp027Error('SF-SYS-003'), c.correlation_id);
    expect(validator(IDS.errorResponse)(err.body).valid).toBe(true);
    const input = authzInput(
      c,
      'GRIEVANCE_FILE',
      { ownerId: CITIZEN },
      new Date('2026-10-06T12:00:00.000Z'),
    );
    expect(validator(IDS.authzInput)(input).valid).toBe(true);
  });

  it('isolation declarations validate against SF-CON-ISOLATION-DECLARATION', () => {
    const decls = JSON.parse(
      readFileSync(join(SERVICE, 'contracts/isolation.json'), 'utf8'),
    ) as unknown[];
    for (const d of decls) {
      expect(validator(IDS.isolation)(d).valid).toBe(true);
    }
  });

  it('outbox migration is the frozen template with schema/cmp replacements only', () => {
    const tmpl = readFileSync(join(REPO_ROOT, 'contracts/shared/sql/outbox.template.sql'), 'utf8');
    const applied = readFileSync(OUTBOX, 'utf8');
    const expected = tmpl.replaceAll('{schema}', 'sf_grievance').replaceAll('{cmp}', 'CMP-027');
    expect(applied.includes(expected)).toBe(true);
  });

  it('schema migration ENABLE+FORCE RLS and NOLOGIN role; no named-service SQL', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/CREATE ROLE sf_cmp027_rw NOLOGIN NOSUPERUSER/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(sql).not.toMatch(/department\s*=/i);
    expect(sql).not.toMatch(/scheme\s*=/i);
  });

  it('isolation schema file exists', () => {
    expect(sharedSchema('isolation-declaration')['$id']).toContain('isolation-declaration');
    expect(readdirSync(join(SERVICE, 'contracts')).includes('isolation.json')).toBe(true);
  });
});
