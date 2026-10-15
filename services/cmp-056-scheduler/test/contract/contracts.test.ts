import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { ACTOR_OFFICER, APPLICATION_ID, ctxFor, TENANT_A } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760500560000_cmp-056-scheduler.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760500560001_cmp-056-outbox.sql';
const APPOINTMENT_ID = 'https://contracts.serviceform.ai/m09/appointment/v1';
const APPOINTMENT_PATH = 'contracts/m09/schemas/appointment.schema.json';

const requireFromContracts = createRequire(join(repoRoot, 'packages/contracts/package.json'));
const { Ajv2020 } = requireFromContracts('ajv/dist/2020.js') as { Ajv2020: new (o: object) => Ajv };
const addFormatsModule = requireFromContracts('ajv-formats') as { default?: (a: Ajv) => void } & ((
  a: Ajv,
) => void);
const addFormats = addFormatsModule.default ?? addFormatsModule;

interface Ajv {
  addSchema(s: object): void;
  getSchema(id: string): (((d: unknown) => boolean) & { errors?: unknown }) | undefined;
  compile(s: object): ((d: unknown) => boolean) & { errors?: unknown };
}

function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
for (const f of readdirSync(join(repoRoot, 'contracts/shared/schemas')).filter((n) =>
  n.endsWith('.schema.json'),
)) {
  ajv.addSchema(readJson(join(repoRoot, 'contracts/shared/schemas', f)));
}
ajv.addSchema(readJson(join(repoRoot, APPOINTMENT_PATH)));
const schema = (id: string): ReturnType<Ajv['compile']> =>
  ajv.getSchema(id) as ReturnType<Ajv['compile']>;
const shared = (name: string): ReturnType<Ajv['compile']> =>
  schema(`https://contracts.serviceform.ai/${name}/v1`);

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const openapi = readJson<{
  paths: Record<string, Record<string, { operationId: string }>>;
  components: { schemas: Record<string, object> };
}>(join(root, 'contracts/openapi.json'));
const OPENAPI_ID = 'urn:serviceform:cmp-056:openapi-components';
ajv.addSchema(
  JSON.parse(
    JSON.stringify({ $id: OPENAPI_ID, $defs: openapi.components.schemas }).replaceAll(
      '#/components/schemas/',
      '#/$defs/',
    ),
  ) as object,
);
const local = (name: string): ReturnType<Ajv['compile']> => schema(`${OPENAPI_ID}#/$defs/${name}`);

function lockHash(id: string): string | undefined {
  const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
  const block = lock.slice(lock.indexOf(`id: ${id}\n`));
  return /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
}

/** Drives one appointment through every lifecycle status and returns all response bodies. */
async function lifecycleBodies(): Promise<{
  appointments: unknown[];
  h: ReturnType<typeof makeHarness>;
}> {
  const h = makeHarness();
  await h.publish('slot:a', { capacity: 3 });
  await h.publish('slot:b', { starts_at: '2026-10-21T04:30:00Z', ends_at: '2026-10-21T05:00:00Z' });
  const bodies: unknown[] = [];
  const booked = await h.call(
    'POST',
    '/v1/appointments',
    { slot_ref: 'slot:a', application_id: APPLICATION_ID },
    { key: 'contract-book-01' },
  );
  bodies.push(booked.body);
  bodies.push(
    (
      await h.call(
        'POST',
        '/v1/appointments',
        { slot_ref: 'slot:a', application_id: APPLICATION_ID },
        { key: 'contract-book-01' },
      )
    ).body,
  );
  const id = (booked.body as Body)['appointment_id'] as string;
  bodies.push((await h.call('GET', `/v1/appointments/${id}`)).body);
  bodies.push(
    (await h.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:b' })).body,
  );
  bodies.push((await h.call('POST', `/v1/appointments/${id}/cancel`, {})).body);
  const two = ((await h.book('slot:a')).body as Body)['appointment_id'] as string;
  const three = ((await h.book('slot:a')).body as Body)['appointment_id'] as string;
  h.clock.set('2026-10-20T04:30:00Z');
  h.state.ctx = ctxFor(TENANT_A, ACTOR_OFFICER, 'OFFICER');
  bodies.push(
    (await h.call('POST', `/v1/appointments/${two}/attendance`, { outcome: 'COMPLETED' })).body,
  );
  bodies.push(
    (await h.call('POST', `/v1/appointments/${three}/attendance`, { outcome: 'NO_SHOW' })).body,
  );
  h.state.ctx = ctxFor(TENANT_A);
  return { appointments: bodies, h };
}

describe('FROZEN SF-CON-APPOINTMENT consumed by CMP-056', () => {
  it('schema hash matches orchestrator/contracts-lock.yaml (frozen contract untouched)', () => {
    const actual = createHash('sha256')
      .update(readFileSync(join(repoRoot, APPOINTMENT_PATH)))
      .digest('hex');
    expect(actual).toBe(lockHash('SF-CON-APPOINTMENT'));
  });

  it('every appointment response in every lifecycle status validates as SF-CON-APPOINTMENT', async () => {
    const validate = schema(APPOINTMENT_ID);
    const { appointments } = await lifecycleBodies();
    const statuses = appointments.map((b) => (b as Body)['lifecycle_status']);
    expect(statuses).toEqual([
      'BOOKED',
      'BOOKED',
      'BOOKED',
      'RESCHEDULED',
      'CANCELLED',
      'COMPLETED',
      'NO_SHOW',
    ]);
    for (const b of appointments) expect(validate(b), JSON.stringify(validate.errors)).toBe(true);
  });

  it('frozen valid example passes and frozen invalid examples fail', () => {
    const v = schema(APPOINTMENT_ID);
    const ex = (p: string): unknown => readJson(join(repoRoot, 'contracts/m09/examples', p));
    expect(v(ex('valid/appointment.json'))).toBe(true);
    expect(v(ex('invalid/appointment.capacity-not-atomic.json'))).toBe(false);
    expect(v(ex('invalid/appointment.notification-invalidates-booking.json'))).toBe(false);
  });
});

describe('shared frozen envelopes emitted by CMP-056', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const { h } = await lifecycleBodies();
    const outbox = h.repo.tenant(TENANT_A).outbox;
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/appointment-event.data.schema.json')),
    );
    const types = new Set(
      outbox.filter((o) => o.topic === TOPIC_DOMAIN).map((o) => o.envelope.event_type),
    );
    expect([...types].sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
    const env = shared('event-envelope');
    const audit = shared('audit-event');
    for (const { topic, envelope } of outbox) {
      expect(env(envelope), JSON.stringify(env.errors)).toBe(true);
      if (topic === TOPIC_DOMAIN) {
        expect(dataSchema(envelope.data), JSON.stringify(dataSchema.errors)).toBe(true);
        expect(envelope.aggregate_type).toBe('Appointment');
      } else {
        expect(topic).toBe('sf.audit.ingest.v1');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    const errors = [
      await h.book('slot:none'),
      await h.book('slot:a', { tenant_id: TENANT_A }),
      await h.call('GET', '/v1/nope'),
      await h.call('POST', '/v1/appointments', { slot_ref: 'slot:a' }, { key: null }),
    ];
    h.authorizer.mode = 'throw';
    errors.push(await h.book('slot:a'));
    const errSchema = shared('error-response');
    for (const e of errors) expect(errSchema(e.body), JSON.stringify(errSchema.errors)).toBe(true);
  });

  it('PDP inputs validate against SF-CON-AUTHZ-DECISION input', async () => {
    const { h } = await lifecycleBodies();
    const input = ajv.compile({
      $ref: 'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    });
    expect(h.authorizer.calls.length).toBeGreaterThan(5);
    for (const c of h.authorizer.calls) expect(input(c), JSON.stringify(input.errors)).toBe(true);
  });

  it('error subset codes, messages and statuses match the frozen catalogue', () => {
    const catalogue = readJson<{ codes: { code: string; message: string; http: number[] }[] }>(
      join(repoRoot, 'contracts/shared/error-catalogue.json'),
    );
    const byCode = new Map(catalogue.codes.map((c) => [c.code, c]));
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE_SUBSET)) {
      const frozen = byCode.get(code);
      expect(frozen, code).toBeDefined();
      expect(entry.message).toBe(frozen?.message);
      expect(frozen?.http).toContain(entry.http);
    }
  });
});

describe('component-local contracts', () => {
  it('OpenAPI operations match the implemented routes', () => {
    const declared = Object.entries(openapi.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({
        method: method.toUpperCase(),
        path: path.replace(/\{([^}]+)\}/g, ':$1'),
        operationId: op.operationId,
      })),
    );
    expect(new Set(declared.map((d) => JSON.stringify(d)))).toEqual(
      new Set(ROUTE_DESCRIPTORS.map((d) => JSON.stringify(d))),
    );
    for (const d of ROUTE_DESCRIPTORS) expect(d.path.startsWith('/v1/')).toBe(true);
  });

  it('slot, slot list and notification outcome responses validate against the OpenAPI schemas', async () => {
    const h = makeHarness();
    const slot = await h.publish('slot:a');
    const list = (await h.call('GET', '/v1/appointments/slots')).body;
    const id = ((await h.book('slot:a')).body as Body)['appointment_id'] as string;
    h.state.ctx = ctxFor(TENANT_A, undefined, 'INTEGRATION');
    const failed = (
      await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, {
        outcome: 'FAILED',
        outcome_ref: 'notify:c1',
        failure_code: 'SF-SYS-004',
      })
    ).body;
    const ok = (
      await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, {
        outcome: 'SUCCEEDED',
        outcome_ref: 'notify:c2',
      })
    ).body;
    const pairs: [string, unknown][] = [
      ['Slot', slot],
      ['SlotList', list],
      ['NotificationOutcome', failed],
      ['NotificationOutcome', ok],
    ];
    for (const [name, body] of pairs) {
      const v = local(name);
      expect(v(body), `${name} ${JSON.stringify(v.errors)}`).toBe(true);
    }
    const input = local('NotificationOutcomeInput');
    expect(input({ outcome: 'FAILED', outcome_ref: 'n:1' })).toBe(false);
    expect(input({ outcome: 'SUCCEEDED', outcome_ref: 'n:1', failure_code: 'SF-SYS-004' })).toBe(
      false,
    );
  });

  it('AsyncAPI declares every emitted domain event on the domain topic', () => {
    const doc = readJson<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      join(root, 'contracts/asyncapi.json'),
    );
    expect(Object.keys(doc.channels[TOPIC_DOMAIN]?.messages ?? {})).toEqual([
      ...DOMAIN_EVENT_TYPES,
    ]);
    expect(readJson<{ name: string }>(join(root, 'contracts/topics.json')).name).toBe(TOPIC_DOMAIN);
  });

  it('isolation.json matches the migration sf:isolation declarations and FORCE RLS', () => {
    const sql = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
      .map((p) => readFileSync(join(repoRoot, p), 'utf8'))
      .join('\n');
    const declared = [...sql.matchAll(/^-- sf:isolation (\S+) (\S+) owner=(CMP-\d{3})$/gm)].map(
      (m) => ({ entity: m[1], isolation_class: m[2], owner_component: m[3] }),
    );
    const iso = readJson<{
      entities: { entity: string; isolation_class: string; owner_component: string; rls: string }[];
    }>(join(root, 'contracts/isolation.json'));
    expect(
      new Set(iso.entities.map((e) => `${e.entity}|${e.isolation_class}|${e.owner_component}`)),
    ).toEqual(
      new Set(declared.map((d) => `${d.entity}|${d.isolation_class}|${d.owner_component}`)),
    );
    for (const e of iso.entities.filter((x) => x.rls === 'FORCE')) {
      expect(sql).toContain(`ALTER TABLE ${e.entity} FORCE ROW LEVEL SECURITY`);
    }
    const declaration = shared('isolation-declaration');
    for (const e of iso.entities) {
      expect(declaration(e), JSON.stringify(declaration.errors)).toBe(true);
      expect(e.owner_component).toBe('CMP-056');
      expect(e.entity.startsWith('sf_scheduler.')).toBe(true);
    }
  });

  it('the migration grants nothing on peer schemas, never BYPASSRLS, and keeps history append-only', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const schemas = new Set([...sql.matchAll(/\b(sf_[a-z0-9_]+)\.[a-z_]+/g)].map((m) => m[1]));
    for (const s of schemas) expect(['sf_scheduler', 'sf_platform']).toContain(s);
    expect(sql.replace(/NOBYPASSRLS/g, '')).not.toMatch(/BYPASSRLS/);
    expect(sql).toContain('CREATE SCHEMA sf_scheduler AUTHORIZATION sf_migrator');
    expect(sql).toMatch(/CREATE ROLE sf_cmp056_rw NOLOGIN/);
    expect(sql).not.toMatch(
      /GRANT[^;]*\bUPDATE\b[^;]*ON sf_scheduler\.(appointment_event|notification_outcome)\b/,
    );
    expect(sql).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*ON sf_scheduler\.(slot|appointment)\b/);
    expect(sql).toMatch(/GRANT UPDATE \(booked_count, status, updated_at\) ON sf_scheduler\.slot/);
    expect(sql).toContain('CHECK (booked_count >= 0 AND booked_count <= capacity)');
    expect(sql).toContain('CHECK (notification_failure_invalidates_booking = false)');
  });

  it('the outbox migration embeds the SF-CON-OUTBOX template with only schema/CMP replaced', () => {
    const ours = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    const template = readFileSync(
      join(repoRoot, 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_scheduler')
      .replaceAll('{cmp}', 'CMP-056');
    expect(ours).toContain(template);
    const tail = ours.slice(ours.indexOf(template) + template.length).replace(/^--.*$/gm, '');
    expect(tail).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('no statutory calendar is invented: no holiday, weekday or business-day logic in src', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(root, 'src'));
    const code = files
      .map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))
      .join('\n');
    expect(code).not.toMatch(/holiday|weekend|business_?day|working_?hours|getU?T?C?Day\(/i);
    expect(code).not.toMatch(/\b(hearing|inspection|interview)\b/i);
  });
});
