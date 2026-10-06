import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANCELLATION_SOURCES,
  COMMANDS,
  FORBIDDEN_AUTHORITATIVE_STATES,
  isLegalState,
  isTransitionCommand,
  LEGAL_STATES,
  resolveTransition,
  TRANSITIONS,
  WITHDRAWAL_SOURCES,
} from '../../src/domain/model.js';
import { planTransition, stateMachineRecord } from '../../src/domain/state-machine.js';
import { Cmp015Error, ERROR_CATALOGUE } from '../../src/errors.js';
import { errorResponse } from '../../src/http.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/events.js';
import {
  CITIZEN,
  ctx,
  harness,
  HUMAN,
  key,
  OFFICER,
  SYSTEM,
  T1,
  TSB_T1,
  type Harness,
} from '../doubles/fixtures.js';
import { MemoryCaseStore } from '../doubles/memory-store.js';
import {
  compileSchema,
  IDS,
  m05Example,
  m05Examples,
  m05Schema,
  readJson,
  REPO_ROOT,
  sharedSchema,
  validator,
} from '../support/frozen.js';

const SERVICE_DIR = join(REPO_ROOT, 'services/cmp-015-application-case');
const MIGRATION = join(REPO_ROOT, 'db/migrations/1759540150000_cmp-015-application-case.sql');
const OUTBOX_MIGRATION = join(REPO_ROOT, 'db/migrations/1759540150001_cmp-015-outbox.sql');

function sorted(values: readonly unknown[]): string[] {
  return [...values].map(String).sort();
}

function enumOf(schema: Record<string, unknown>, path: string[]): string[] {
  let node: unknown = schema;
  for (const p of path) node = (node as Record<string, unknown>)[p];
  return (node as { enum: string[] }).enum;
}

describe('SF-CON-APPLICATION-CASE-SM executable table equals the FROZEN schema', () => {
  const schema = m05Schema('application-case-sm');

  it('states, forbidden states and commands', () => {
    expect([...LEGAL_STATES]).toEqual(enumOf(schema, ['$defs', 'legalState']));
    expect([...FORBIDDEN_AUTHORITATIVE_STATES]).toEqual(
      enumOf(schema, ['$defs', 'forbiddenAuthoritativeState']),
    );
    expect([...COMMANDS]).toEqual(enumOf(schema, ['properties', 'command']));
  });

  it('transition keys per class', () => {
    expect(sorted(TRANSITIONS.map((t) => t.key))).toEqual(
      sorted(enumOf(schema, ['properties', 'transition_key'])),
    );
    expect(sorted(TRANSITIONS.filter((t) => t.cls === 'ALWAYS_LEGAL').map((t) => t.key))).toEqual(
      sorted(enumOf(schema, ['$defs', 'alwaysLegalTransitionKey'])),
    );
    expect(sorted(WITHDRAWAL_SOURCES.map((s) => `${s}>WITHDRAWN`))).toEqual(
      sorted(enumOf(schema, ['$defs', 'policyGatedWithdrawalKey'])),
    );
    expect(sorted(CANCELLATION_SOURCES.map((s) => `${s}>CANCELLED`))).toEqual(
      sorted(enumOf(schema, ['$defs', 'policyGatedCancellationKey'])),
    );
  });

  /** Domain verdict on a contract instance: same as the frozen schema for every example. */
  function domainAccepts(ex: Record<string, unknown>): boolean {
    if (
      !isLegalState(ex['from_state']) ||
      ex['expected_state'] !== ex['from_state'] ||
      !isTransitionCommand(ex['command'])
    ) {
      return false;
    }
    const def = resolveTransition(ex['command'], ex['from_state']);
    if (
      !def ||
      def.key !== ex['transition_key'] ||
      def.to !== ex['to_state'] ||
      def.cls !== ex['transition_class']
    )
      return false;
    try {
      planTransition({
        command: def.command,
        expectedState: def.from,
        expectedVersion: 1,
        currentState: def.from,
        currentVersion: 1,
        requestConstruct: (ex['request_construct'] as never) ?? null,
      });
      return true;
    } catch {
      return false;
    }
  }

  it.each(m05Examples('valid').filter((f) => f.startsWith('application-case-sm')))(
    'valid example %s: schema and domain accept',
    (file) => {
      const ex = m05Example('valid', file);
      expect(validator(IDS.caseSm)(ex).valid).toBe(true);
      expect(domainAccepts(ex)).toBe(true);
    },
  );

  it.each(m05Examples('invalid').filter((f) => f.startsWith('application-case-sm')))(
    'invalid example %s: schema and domain reject',
    (file) => {
      const ex = m05Example('invalid', file);
      expect(validator(IDS.caseSm)(ex).valid).toBe(false);
      expect(domainAccepts(ex)).toBe(false);
    },
  );

  it('every transition yields a schema-valid state-machine record', () => {
    const validate = validator(IDS.caseSm);
    for (const def of TRANSITIONS) {
      const construct =
        def.cls === 'ALWAYS_LEGAL'
          ? undefined
          : ({
              kind: def.cls === 'POLICY_GATED_WITHDRAWAL' ? 'WITHDRAWAL' : 'CANCELLATION',
              status: 'COMMITTED',
            } as const);
      const plan = planTransition({
        command: def.command,
        expectedState: def.from,
        expectedVersion: 3,
        currentState: def.from,
        currentVersion: 3,
        requestConstruct: construct ?? null,
      });
      const rec = stateMachineRecord({
        tenantId: T1,
        applicationId: CITIZEN,
        plan,
        idempotencyKey: 'cmd-key-0001',
        authzDecisionId: OFFICER,
        correlationId: SYSTEM,
        actorType: 'OFFICER',
        actorId: OFFICER,
        ...(construct ? { requestConstruct: construct, reasonCode: 'REQUEST_COMMITTED' } : {}),
      });
      const res = validate(rec);
      expect({ key: def.key, valid: res.valid, errors: res.errors }).toEqual({
        key: def.key,
        valid: true,
        errors: null,
      });
    }
  });
});

describe('emitted objects validate against FROZEN schemas (service run)', () => {
  let store: MemoryCaseStore;
  let h: Harness;
  const bodies: Record<string, unknown>[] = [];

  beforeAll(async () => {
    store = new MemoryCaseStore();
    h = harness(store, () => new Date('2026-10-05T10:00:00.000Z'));
    const created = await h.service.createDraft(
      ctx(T1, 'CITIZEN', CITIZEN),
      { tenant_service_binding_id: TSB_T1 },
      key(),
    );
    bodies.push(created.body as Record<string, unknown>);
    const id = (created.body as { application: { application_id: string } }).application
      .application_id;
    const steps: [ReturnType<typeof ctx>, string, Record<string, unknown>?][] = [
      [ctx(T1, 'CITIZEN', CITIZEN), 'MARK_READY_TO_SUBMIT'],
      [ctx(T1, 'CITIZEN', CITIZEN), 'SUBMIT'],
      [ctx(T1, 'SYSTEM', SYSTEM), 'MARK_RECEIVED'],
      [ctx(T1, 'SYSTEM', SYSTEM), 'ENTER_SCRUTINY'],
      [ctx(T1, 'OFFICER', OFFICER), 'ENTER_DECISION_PENDING'],
      [
        ctx(T1, 'OFFICER', OFFICER),
        'RECORD_APPROVED',
        { decision: HUMAN, reason_code: 'ELIGIBLE' },
      ],
    ];
    let version = 1;
    let state = 'DRAFT';
    for (const [c, command, extra] of steps) {
      const res = await h.service.executeCommand(
        c,
        id,
        { command, expected_state: state, expected_version: version, ...(extra ?? {}) },
        key(),
      );
      const body = res.body as Record<string, unknown> & {
        application: { state: string; aggregate_version: number };
      };
      bodies.push(body);
      state = body.application.state;
      version = body.application.aggregate_version;
    }
    const id2 = (
      (
        await h.service.createDraft(
          ctx(T1, 'CITIZEN', CITIZEN),
          { tenant_service_binding_id: TSB_T1 },
          key(),
        )
      ).body as {
        application: { application_id: string };
      }
    ).application.application_id;
    h.policy.permit('ffffffff-ffff-4fff-8fff-ffffffffffff', 'DRAFT>WITHDRAWN');
    const req = await h.service.registerRequest(
      ctx(T1, 'CITIZEN', CITIZEN),
      id2,
      { kind: 'WITHDRAWAL' },
      key(),
    );
    const rid = (req.body as { request: { request_id: string } }).request.request_id;
    await h.service.updateRequestStatus(
      ctx(T1, 'SYSTEM', SYSTEM),
      id2,
      rid,
      {
        status: 'COMMITTED',
        expected_status: 'SUBMITTED',
        decision: { decision_maker: 'RULES', basis_ref: 'draft-withdrawal' },
      },
      key(),
    );
    await h.service.executeCommand(
      ctx(T1, 'SYSTEM', SYSTEM),
      id2,
      {
        command: 'COMMIT_WITHDRAWAL',
        expected_state: 'DRAFT',
        expected_version: 1,
        request_id: rid,
      },
      key(),
    );
  });

  it('SF-CON-VERSION-PINNING from draft creation', () => {
    const res = validator(IDS.versionPinning)(
      (bodies[0] as { version_pinning: unknown }).version_pinning,
    );
    expect(res).toEqual({ valid: true, errors: null });
  });

  it('SF-CON-COMMAND-TRANSITION records from every committed command', () => {
    const validate = validator(IDS.commandTransition);
    for (const b of bodies.slice(1)) {
      const res = validate(b['command_transition']);
      expect(res).toEqual({ valid: true, errors: null });
      expect(b['command_transition']).toMatchObject({
        domain_committed: true,
        open_domain_txn_has_temporal_network: false,
      });
    }
  });

  it('SF-CON-EVENT-ENVELOPE / SF-CON-AUDIT-EVENT / component event data for every outbox row', () => {
    const envelope = validator(IDS.envelope);
    const audit = validator(IDS.audit);
    const eventSchemas: Record<string, string> = {
      ApplicationDraftCreated: 'draft-created',
      ApplicationStateChanged: 'state-changed',
      ApplicationRequestRecorded: 'request-recorded',
      ApplicationRequestStatusChanged: 'request-status-changed',
    };
    const rows = store.outboxFor(T1);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(envelope(row.envelope)).toEqual({ valid: true, errors: null });
      if (row.topic === TOPIC_AUDIT) {
        expect(audit(row.envelope.data)).toEqual({ valid: true, errors: null });
      } else {
        expect(row.topic).toBe(TOPIC_DOMAIN);
        const name = eventSchemas[row.envelope.event_type];
        expect(name).toBeDefined();
        const schema = readJson(join(SERVICE_DIR, `contracts/events/${name}.data.schema.json`));
        expect(compileSchema(schema)(row.envelope.data)).toEqual({ valid: true, errors: null });
      }
    }
  });

  it('SF-CON-AUTHZ-DECISION input for every PEP call', () => {
    const input = validator(IDS.authzInput);
    expect(h.authorizer.inputs.length).toBeGreaterThan(5);
    for (const i of h.authorizer.inputs) expect(input(i)).toEqual({ valid: true, errors: null });
  });

  it('SF-CON-REQUEST-CONTEXT fixtures and SF-CON-ERROR-RESPONSE bodies', () => {
    for (const t of ['CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION'] as const) {
      expect(validator(IDS.requestContext)(ctx(T1, t, CITIZEN))).toEqual({
        valid: true,
        errors: null,
      });
    }
    for (const code of Object.keys(ERROR_CATALOGUE) as (keyof typeof ERROR_CATALOGUE)[]) {
      const body = errorResponse(
        new Cmp015Error(code, { details: [{ code: 'X', pointer: '/a' }] }),
        CITIZEN,
      ).body;
      expect(validator(IDS.errorResponse)(body)).toEqual({ valid: true, errors: null });
    }
  });
});

describe('shared contracts CMP-015 depends on (read-only)', () => {
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

  it('DB session settings are exactly the SF-CON-DB-SESSION-CONTEXT keys', () => {
    const schema = sharedSchema('db-session-context') as { properties: Record<string, unknown> };
    const src = readFileSync(join(SERVICE_DIR, 'src/store/pg-store.ts'), 'utf8');
    const used = [...src.matchAll(/\['(app\.[a-z_]+)'/g)].map((m) => m[1]);
    expect(sorted(used)).toEqual(sorted(Object.keys(schema.properties)));
  });

  it('command-transition and version-pinning invalid examples stay invalid', () => {
    for (const f of [
      'command-transition.network-in-txn.json',
      'command-transition.temporal-before-commit.json',
    ]) {
      expect(validator(IDS.commandTransition)(m05Example('invalid', f)).valid).toBe(false);
    }
    expect(
      validator(IDS.versionPinning)(m05Example('invalid', 'version-pinning.silent-repoint.json'))
        .valid,
    ).toBe(false);
    expect(
      validator(IDS.commandTransition)(m05Example('valid', 'command-transition.json')).valid,
    ).toBe(true);
  });
});

describe('migration and component contracts agree with the domain', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('state CHECK admits exactly the legal states (no *_REQUESTED)', () => {
    const check = /state text NOT NULL CHECK \(state IN \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? '';
    expect(sorted([...check.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]))).toEqual(
      sorted(LEGAL_STATES),
    );
    expect(check).not.toMatch(/REQUESTED/);
  });

  it('DB transition trigger table equals the frozen transition keys', () => {
    const arr = /legal constant text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql)?.[1] ?? '';
    expect(sorted([...arr.matchAll(/'([A-Z_>]+)'/g)].map((m) => m[1]))).toEqual(
      sorted(TRANSITIONS.map((t) => t.key)),
    );
  });

  it('isolation.json declares every table the migrations create, with FORCE RLS for TENANT_SCOPED', () => {
    const iso = JSON.parse(readFileSync(join(SERVICE_DIR, 'contracts/isolation.json'), 'utf8')) as {
      entity: string;
      isolation_class: string;
      rls: string;
    }[];
    const both = sql + readFileSync(OUTBOX_MIGRATION, 'utf8');
    const declared = [...both.matchAll(/^-- sf:isolation (\S+) (\S+) owner=CMP-015$/gm)].map(
      (m) => `${m[1]}|${m[2]}`,
    );
    expect(sorted(iso.map((e) => `${e.entity}|${e.isolation_class}`))).toEqual(sorted(declared));
    for (const e of iso.filter((x) => x.isolation_class === 'TENANT_SCOPED')) {
      expect(e.rls).toBe('FORCE');
      expect(both).toContain(`ALTER TABLE ${e.entity} FORCE ROW LEVEL SECURITY;`);
    }
  });

  it('outbox migration is the frozen template with only schema/CMP replacements', () => {
    const template = readFileSync(
      join(REPO_ROOT, 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_application_case')
      .replaceAll('{cmp}', 'CMP-015');
    expect(readFileSync(OUTBOX_MIGRATION, 'utf8')).toContain(template);
  });

  it('no SUPERUSER / BYPASSRLS grants and no cross-component schema references', () => {
    const exec = sql.replace(/--[^\n]*/g, '');
    expect(exec).not.toMatch(/\bSUPERUSER\b(?<!NOSUPERUSER)/);
    expect(exec).not.toMatch(/(?<!NO)BYPASSRLS/);
    const schemas = new Set([...exec.matchAll(/\b(sf_[a-z_]+)\.[a-z_]+/g)].map((m) => m[1]));
    expect([...schemas].sort()).toEqual(['sf_application_case', 'sf_platform']);
  });

  it('OpenAPI enums match the domain', () => {
    const openapi = JSON.parse(
      readFileSync(join(SERVICE_DIR, 'contracts/openapi.json'), 'utf8'),
    ) as {
      components: {
        schemas: Record<
          string,
          { enum?: string[]; properties?: Record<string, { enum?: string[] }> }
        >;
      };
    };
    expect(openapi.components.schemas['CaseState']?.enum).toEqual([...LEGAL_STATES]);
    expect(openapi.components.schemas['CommandRequest']?.properties?.['command']?.enum).toEqual(
      COMMANDS.filter((c) => c !== 'CREATE_DRAFT'),
    );
  });
});
