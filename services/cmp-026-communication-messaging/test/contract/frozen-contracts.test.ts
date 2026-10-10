import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authzInput } from '../../src/authz.js';
import { isRequestContext } from '../../src/domain/validate.js';
import { Cmp026Error, ERROR_CATALOGUE } from '../../src/errors.js';
import {
  auditEnvelope,
  envelopeOf,
  EVENT_TYPES,
  TOPIC_AUDIT,
  TOPIC_DOMAIN,
} from '../../src/events.js';
import { errorResponse } from '../../src/http.js';
import { messageThreadContract } from '../../src/service.js';
import { APP_1, CITIZEN, ctx, harness, key, KEY_OK, OFFICER, T1, T2 } from '../doubles/fixtures.js';
import { MemoryMessagingStore } from '../doubles/memory-store.js';
import { IDS, REPO_ROOT, readJson, sharedSchema, validator } from '../support/frozen.js';

const SERVICE = join(REPO_ROOT, 'services/cmp-026-communication-messaging');
const MIGRATION = join(
  REPO_ROOT,
  'db/migrations/1759542600000_cmp-026-communication-messaging.sql',
);
const OUTBOX = join(REPO_ROOT, 'db/migrations/1759542600001_cmp-026-outbox.sql');
const M06 = join(REPO_ROOT, 'contracts/m06');

describe('frozen shared contracts consumed by CMP-026', () => {
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

  it('emitted envelopes, audit, request context, error responses and authz input validate', () => {
    const c = ctx(T1, 'CITIZEN', CITIZEN);
    expect(validator(IDS.requestContext)(c).valid).toBe(true);
    expect(isRequestContext(c)).toBe(true);
    for (const eventType of Object.values(EVENT_TYPES).filter((t) => t !== 'AuditEventSubmitted')) {
      const env = envelopeOf({
        eventType,
        ctx: c,
        aggregateId: APP_1,
        aggregateVersion: 1,
        occurredAt: '2026-10-06T12:00:00.000Z',
        data: { thread_id: APP_1 },
      });
      expect(validator(IDS.envelope)(env).valid).toBe(true);
    }
    const audit = auditEnvelope(c, {
      action: 'MESSAGE_SEND',
      actionClass: 'WRITE',
      resourceId: APP_1,
      result: 'SUCCESS',
      occurredAt: '2026-10-06T12:00:00.000Z',
    });
    expect(validator(IDS.envelope)(audit).valid).toBe(true);
    expect(validator(IDS.audit)(audit.data).valid).toBe(true);
    const err = errorResponse(new Cmp026Error('SF-SYS-003'), c.correlation_id);
    expect(validator(IDS.errorResponse)(err.body).valid).toBe(true);
    const input = authzInput(
      c,
      'THREAD_OPEN',
      { ownerId: CITIZEN, applicationId: APP_1 },
      new Date('2026-10-06T12:00:00.000Z'),
    );
    expect(validator(IDS.authzInput)(input).valid).toBe(true);
  });

  it('isolation declarations validate against SF-CON-ISOLATION-DECLARATION and cover every migrated table', () => {
    const decls = JSON.parse(readFileSync(join(SERVICE, 'contracts/isolation.json'), 'utf8')) as {
      entity: string;
      isolation_class: string;
      rls: string;
    }[];
    for (const d of decls) expect(validator(IDS.isolation)(d).valid).toBe(true);
    const sql = readFileSync(MIGRATION, 'utf8') + readFileSync(OUTBOX, 'utf8');
    const created = [...sql.matchAll(/CREATE TABLE (sf_messaging\.[a-z_]+)/g)]
      .map((m) => m[1])
      .sort();
    expect(decls.map((d) => d.entity).sort()).toEqual(created);
    for (const d of decls.filter((x) => x.isolation_class === 'TENANT_SCOPED'))
      expect(d.rls).toBe('FORCE');
  });

  it('outbox migration is the frozen template with schema/cmp replacements only', () => {
    const tmpl = readFileSync(join(REPO_ROOT, 'contracts/shared/sql/outbox.template.sql'), 'utf8');
    const applied = readFileSync(OUTBOX, 'utf8');
    const expected = tmpl.replaceAll('{schema}', 'sf_messaging').replaceAll('{cmp}', 'CMP-026');
    expect(applied.includes(expected)).toBe(true);
  });

  it('schema migration: NOLOGIN role, FORCE RLS on every tenant table, no BYPASSRLS, no named-service SQL', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/CREATE ROLE sf_cmp026_rw NOLOGIN NOSUPERUSER/);
    expect(sql).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(sql).not.toMatch(/department\s*=/i);
    expect(sql).not.toMatch(/scheme\s*=/i);
    const tables = [...sql.matchAll(/CREATE TABLE (sf_messaging\.[a-z_]+)/g)].map((m) => m[1]);
    expect(tables.length).toBe(9);
    for (const t of tables) {
      expect(sql).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE ${t} OWNER TO sf_migrator;`);
    }
    expect(sql).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*sf_messaging\.(?!idempotency_record)/);
    expect(sql).not.toMatch(/\bsf_(?!messaging|platform|app|migrator|cmp026|outbox)[a-z]+\./);
  });

  it('service contracts topics match the emitted topics', () => {
    expect(readJson(join(SERVICE, 'contracts/topics.json'))).toEqual({
      domain: TOPIC_DOMAIN,
      audit: TOPIC_AUDIT,
    });
    const asyncapi = JSON.stringify(readJson(join(SERVICE, 'contracts/asyncapi.json')));
    for (const t of Object.values(EVENT_TYPES)) expect(asyncapi).toContain(t);
  });
});

describe('SF-CON-MESSAGE-THREAD (FROZEN, consumed unchanged)', () => {
  it('the frozen artifact still matches the locked hash', () => {
    const lock = readFileSync(join(REPO_ROOT, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.split('SF-CON-MESSAGE-THREAD')[1] ?? '';
    const expected = /schema_hash:\s*"?([0-9a-f]{64})/.exec(block)?.[1];
    expect(expected).toBeDefined();
    const bytes = readFileSync(join(M06, 'schemas/message-thread.schema.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
  });

  it('frozen valid example validates, frozen invalid example is rejected', () => {
    const validate = validator(IDS.messageThread);
    expect(validate(readJson(join(M06, 'examples/valid/message-thread.json'))).valid).toBe(true);
    expect(
      validate(readJson(join(M06, 'examples/invalid/message-thread.cross-tenant.json'))).valid,
    ).toBe(false);
  });

  it('thread documents produced by the service validate against the frozen schema', async () => {
    const store = new MemoryMessagingStore();
    const h = harness(store);
    const opened = await h.service.openThread(
      ctx(T1, 'OFFICER', OFFICER),
      {
        application_id: APP_1,
        opener_role_code: 'CASE_OFFICER',
        participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
      },
      key('contract-open'),
    );
    const id = (opened.body as { thread: { thread_id: string } }).thread.thread_id;
    await h.service.sendMessage(
      ctx(T1, 'OFFICER', OFFICER),
      id,
      { body: 'hello', attachment_storage_keys: [KEY_OK] },
      key('contract-send'),
    );
    await h.service.markRead(ctx(T1, 'CITIZEN', CITIZEN), id, { up_to_sequence: 1 });
    const view = await h.service.getThread(ctx(T1, 'CITIZEN', CITIZEN), id);
    const doc = (view.body as { message_thread: unknown }).message_thread;
    const res = validator(IDS.messageThread)(doc);
    expect({ valid: res.valid, errors: res.errors }).toEqual({ valid: true, errors: null });
    const typed = doc as {
      tenant_id: string;
      participants: { tenant_id: string }[];
      cross_tenant_participants_forbidden: boolean;
    };
    expect(typed.tenant_id).toBe(T1);
    expect(typed.participants.every((p) => p.tenant_id === typed.tenant_id)).toBe(true);
    expect(typed.cross_tenant_participants_forbidden).toBe(true);
  });

  it('the document builder never emits other-tenant participants, even if given cross-tenant ids', () => {
    const doc = messageThreadContract(
      {
        thread_id: APP_1,
        tenant_id: T1,
        cell_id: 'cell-01',
        application_id: APP_1,
        subject_code: null,
        status: 'OPEN',
        aggregate_version: 1,
        message_seq: 0,
        organisation_id: null,
        jurisdiction_id: null,
        created_by: OFFICER,
        created_at: '2026-10-06T12:00:00.000Z',
        updated_at: '2026-10-06T12:00:00.000Z',
        last_correlation_id: APP_1,
      },
      [
        {
          participant_id: APP_1,
          tenant_id: T2,
          thread_id: APP_1,
          actor_id: OFFICER,
          participant_ref: 'p-1',
          role_code: 'CASE_OFFICER',
          added_by: OFFICER,
          added_at: '2026-10-06T12:00:00.000Z',
          removed_at: null,
          removed_by: null,
        },
      ],
      [],
      [],
      APP_1,
    ) as { participants: { tenant_id: string }[] };
    expect(doc.participants.every((p) => p.tenant_id === T1)).toBe(true);
    expect(validator(IDS.messageThread)(doc).valid).toBe(true);
  });

  it('shared schema files load', () => {
    expect(sharedSchema('isolation-declaration')['$id']).toContain('isolation-declaration');
  });
});
