import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import { SLOT_REF_1, TENANT_A, TYPE_REF } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import type { MemorySchedulerRepository } from '../doubles/memory-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760460000000_cmp-056-scheduler.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760460000001_cmp-056-outbox.sql';
const FROZEN_SCHEMA = 'contracts/m09/schemas/appointment.schema.json';

const requireFromContracts = createRequire(join(repoRoot, 'packages/contracts/package.json'));
const { Ajv2020 } = requireFromContracts('ajv/dist/2020.js') as { Ajv2020: new (o: object) => Ajv };
const addFormatsModule = requireFromContracts('ajv-formats') as { default?: (a: Ajv) => void } & ((
  a: Ajv,
) => void);
const addFormats = addFormatsModule.default ?? addFormatsModule;

type Validator = ((d: unknown) => boolean) & { errors?: unknown };
interface Ajv {
  addSchema(s: object): void;
  getSchema(id: string): Validator | undefined;
  compile(s: object): Validator;
}

function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const sharedDir = join(repoRoot, 'contracts/shared/schemas');
for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(readJson(join(sharedDir, f)));
}
ajv.addSchema(readJson(join(repoRoot, FROZEN_SCHEMA)));
const validateShared = (name: string): Validator =>
  ajv.getSchema(`https://contracts.serviceform.ai/${name}/v1`) as Validator;
const validateAppointment = ajv.getSchema(
  'https://contracts.serviceform.ai/m09/appointment/v1',
) as Validator;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('FROZEN SF-CON-APPOINTMENT', () => {
  it('the frozen schema still pins capacity and notify-failure markers', () => {
    const s = readJson<Body>(join(repoRoot, FROZEN_SCHEMA));
    expect(s['properties']['contract_status']['const']).toBe('FROZEN');
    expect(s['properties']['capacity_atomic']['const']).toBe(true);
    expect(s['properties']['notification_failure_invalidates_booking']['const']).toBe(false);
    expect(s['properties']['invented_statutory_policy_forbidden']['const']).toBe(true);
  });

  it('frozen valid example passes and invalid examples fail', () => {
    const valid = readJson(join(repoRoot, 'contracts/m09/examples/valid/appointment.json'));
    expect(validateAppointment(valid)).toBe(true);
    const badCap = readJson(
      join(repoRoot, 'contracts/m09/examples/invalid/appointment.capacity-not-atomic.json'),
    );
    expect(validateAppointment(badCap)).toBe(false);
    const badNotify = readJson(
      join(
        repoRoot,
        'contracts/m09/examples/invalid/appointment.notification-invalidates-booking.json',
      ),
    );
    expect(validateAppointment(badNotify)).toBe(false);
  });

  it('booked appointment responses validate against the frozen schema', async () => {
    const h = makeHarness();
    const type = await h.call('POST', '/v1/appointments/types', {
      appointment_type_ref: TYPE_REF,
    });
    const typeId = (type.body as Body)['appointment_type_id'] as string;
    await h.call('POST', '/v1/appointments/slots', {
      appointment_type_id: typeId,
      slot_ref: SLOT_REF_1,
      capacity: 1,
      opens_at: '2026-10-20T10:00:00.000Z',
      closes_at: '2026-10-20T10:30:00.000Z',
    });
    const booked = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    expect(booked.status).toBe(201);
    const appointment = (booked.body as Body)['appointment'];
    expect(validateAppointment(appointment), JSON.stringify(validateAppointment.errors)).toBe(true);
  });
});

describe('component contracts and migrations', () => {
  it('openapi paths match route descriptors', () => {
    const openapi = readJson<Body>(join(root, 'contracts/openapi.json'));
    for (const r of ROUTE_DESCRIPTORS) {
      const pathItem = openapi['paths'][r.path.replace(/:([A-Za-z_]+)/g, '{$1}')];
      expect(pathItem, r.path).toBeTruthy();
      expect(pathItem[r.method.toLowerCase()]['operationId']).toBe(r.operationId);
    }
  });

  it('isolation declaration covers FORCE RLS entities', () => {
    const iso = readJson<{ entities: { entity: string; rls: string }[] }>(
      join(root, 'contracts/isolation.json'),
    );
    const forced = iso.entities.filter((e) => e.rls === 'FORCE').map((e) => e.entity);
    expect(forced).toEqual(
      expect.arrayContaining([
        'sf_scheduler.appointment',
        'sf_scheduler.slot',
        'sf_scheduler.appointment_type',
        'sf_scheduler.idempotency_record',
        'sf_scheduler.outbox_event',
      ]),
    );
  });

  it('migration pins privilege role, schema, capacity and notify constants', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    expect(sql).toContain('sf_cmp056_rw');
    expect(sql).toContain('CREATE SCHEMA sf_scheduler');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('capacity_atomic boolean NOT NULL DEFAULT true');
    expect(sql).toContain(
      'notification_failure_invalidates_booking boolean NOT NULL DEFAULT false',
    );
    expect(sql).toContain('CHECK (NOT notification_failure_invalidates_booking)');
    const outbox = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    expect(outbox).toContain('sf_scheduler.outbox_event');
  });

  it('topics and domain events align', () => {
    const topics = readJson<{ name: string }>(join(root, 'contracts/topics.json'));
    expect(topics.name).toBe(TOPIC_DOMAIN);
    expect(DOMAIN_EVENT_TYPES).toContain('AppointmentBooked');
    expect(TOPIC_AUDIT).toBe('sf.audit.ingest.v1');
  });

  it('error catalogue subset and shared envelopes validate', async () => {
    expect(Object.keys(ERROR_CATALOGUE_SUBSET).length).toBeGreaterThan(5);
    const h = makeHarness();
    const type = await h.call('POST', '/v1/appointments/types', {
      appointment_type_ref: TYPE_REF,
    });
    const typeId = (type.body as Body)['appointment_type_id'] as string;
    await h.call('POST', '/v1/appointments/slots', {
      appointment_type_id: typeId,
      slot_ref: SLOT_REF_1,
      capacity: 1,
      opens_at: '2026-10-20T10:00:00.000Z',
      closes_at: '2026-10-20T10:30:00.000Z',
    });
    await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    const store = (h.repo as MemorySchedulerRepository).tenant(TENANT_A);
    for (const item of store.outbox) {
      const v = validateShared('event-envelope');
      expect(v(item.envelope), JSON.stringify(v.errors)).toBe(true);
      if (item.topic === TOPIC_AUDIT) {
        const audit = validateShared('audit-event');
        expect(audit(item.envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
  });

  it('source does not invent statutory calendar strings outside the refusal guard', () => {
    // domain/appointment.ts holds the denylist used by looksLikeInventedStatutoryCalendar.
    const files = sourceFiles(join(root, 'src')).filter(
      (f) => f.endsWith('.ts') && !f.endsWith(`${join('domain', 'appointment.ts')}`),
    );
    for (const f of files) {
      const text = readFileSync(f, 'utf8').toLowerCase();
      expect(text).not.toMatch(/code of civil procedure/);
      expect(text).not.toMatch(/crpc hearing calendar/);
    }
  });
});
