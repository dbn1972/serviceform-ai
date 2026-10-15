import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { CHANNELS, LIFECYCLE_STATUSES } from '../../src/domain/session.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ACTOR_CITIZEN,
  APPLICATION_1,
  ASSURANCE_REF,
  CONSENT_REF,
  startBody,
  TENANT_A,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import type { MemoryAssistedRepository } from '../doubles/memory-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760900000000_cmp-057-assisted-service.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760900000001_cmp-057-outbox.sql';
const FROZEN_SCHEMA = 'contracts/m09/schemas/assisted-session.schema.json';

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
const validateSession = ajv.getSchema(
  'https://contracts.serviceform.ai/m09/assistedsession/v1',
) as Validator;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fullFlow(): Promise<{ h: ReturnType<typeof makeHarness>; bodies: Body[] }> {
  const h = makeHarness();
  const bodies: Body[] = [];
  const start = await h.call('POST', '/v1/assisted/sessions', startBody());
  bodies.push(start.body as Body);
  const id = (start.body as Body)['assisted_session']['session_id'] as string;
  let version = (start.body as Body)['session_version'] as number;
  bodies.push(
    (
      await h.call('POST', `/v1/assisted/sessions/${id}/applicant`, {
        expected_version: version,
        applicant_assurance_ref: ASSURANCE_REF,
      })
    ).body as Body,
  );
  version += 1;
  bodies.push(
    (
      await h.call('POST', `/v1/assisted/sessions/${id}/representation`, {
        expected_version: version,
        representation_authority_ref: null,
        consent_ref: CONSENT_REF,
        read_back_acknowledged: true,
      })
    ).body as Body,
  );
  version += 1;
  bodies.push(
    (
      await h.call('POST', `/v1/assisted/sessions/${id}/submit`, {
        expected_version: version,
        application_id: APPLICATION_1,
      })
    ).body as Body,
  );
  bodies.push((await h.call('GET', `/v1/assisted/sessions/${id}`)).body as Body);
  h.authorizer.deniedActions.add('ASSISTED_SESSION_READ');
  bodies.push((await h.call('GET', `/v1/assisted/sessions/${id}`)).body as Body);
  return { h, bodies };
}

describe('FROZEN SF-CON-ASSISTED-SESSION', () => {
  it('the frozen schema still pins applied_by_distinct_from_applied_for and statute marker', () => {
    const s = readJson<Body>(join(repoRoot, FROZEN_SCHEMA));
    expect(s['properties']['contract_status']['const']).toBe('FROZEN');
    expect(s['properties']['applied_by_distinct_from_applied_for']['const']).toBe(true);
    expect(s['properties']['invented_statutory_policy_forbidden']['const']).toBe(true);
  });

  it('frozen valid example passes and invalid applied-by-not-distinct fails', () => {
    const valid = readJson(join(repoRoot, 'contracts/m09/examples/valid/assisted-session.json'));
    const invalid = readJson(
      join(
        repoRoot,
        'contracts/m09/examples/invalid/assisted-session.applied-by-not-distinct.json',
      ),
    );
    expect(validateSession(valid), JSON.stringify(validateSession.errors)).toBe(true);
    expect(validateSession(invalid)).toBe(false);
  });

  it('every session CMP-057 returns validates against the frozen schema', async () => {
    const { bodies } = await fullFlow();
    const sessions = bodies
      .filter((b) => b['assisted_session'])
      .map((b) => b['assisted_session'] as Body);
    expect(sessions.length).toBeGreaterThanOrEqual(4);
    for (const s of sessions) {
      expect(validateSession(s), JSON.stringify(validateSession.errors)).toBe(true);
      expect(s['applied_by_distinct_from_applied_for']).toBe(true);
      expect(s['invented_statutory_policy_forbidden']).toBe(true);
      expect(s['applied_by_actor_id']).not.toBe(s['applied_for_citizen_id']);
    }
  });

  it('component enums equal the frozen enums', () => {
    const s = readJson<Body>(join(repoRoot, FROZEN_SCHEMA));
    expect([...CHANNELS]).toEqual(s['properties']['channel']['enum']);
    expect([...LIFECYCLE_STATUSES]).toEqual(s['properties']['lifecycle_status']['enum']);
  });
});

describe('shared frozen envelopes emitted by CMP-057', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const { h, bodies } = await fullFlow();
    const outbox = (h.repo as MemoryAssistedRepository).tenant(TENANT_A).outbox;
    const eventData = ajv.compile(
      readJson(join(root, 'contracts/events/assisted-session-event.data.schema.json')),
    );
    for (const row of outbox.filter((o) => o.topic === TOPIC_DOMAIN)) {
      expect(validateShared('event-envelope')(row.envelope)).toBe(true);
      expect(eventData(row.envelope.data), JSON.stringify(eventData.errors)).toBe(true);
      expect((row.envelope.data as Body)['applied_by_distinct_from_applied_for']).toBe(true);
    }
    for (const row of outbox.filter((o) => o.topic === TOPIC_AUDIT)) {
      expect(validateShared('event-envelope')(row.envelope)).toBe(true);
      expect(validateShared('audit-event')(row.envelope.data)).toBe(true);
    }
    const errBody = bodies.find((b) => b['error_code']);
    expect(errBody).toBeTruthy();
    expect(validateShared('error-response')(errBody)).toBe(true);
  });
});

describe('component contracts and invention guards', () => {
  it('openapi operationIds match the handler route table', () => {
    const openapi = readJson<Body>(join(root, 'contracts/openapi.json'));
    const ids = new Set<string>();
    for (const pathItem of Object.values(openapi['paths'] as Body)) {
      for (const op of Object.values(pathItem as Body)) {
        if (typeof op === 'object' && op && 'operationId' in (op as object)) {
          ids.add((op as Body)['operationId'] as string);
        }
      }
    }
    expect([...ids].sort()).toEqual([...ROUTE_DESCRIPTORS.map((r) => r.operationId)].sort());
  });

  it('asyncapi lists every domain event type on TOPIC_DOMAIN', () => {
    const asyncapi = readJson<Body>(join(root, 'contracts/asyncapi.json'));
    const msgs = Object.keys(
      (asyncapi['channels'] as Body)[TOPIC_DOMAIN]['messages'] as Body,
    ).sort();
    expect(msgs).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });

  it('migration pair and privilege role are present; no peer schema SQL', () => {
    const schema = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const outbox = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    expect(schema).toMatch(/CREATE ROLE sf_cmp057_rw/);
    expect(schema).toMatch(/CREATE SCHEMA sf_assisted/);
    expect(schema).toMatch(/applied_by_actor_id <> applied_for_citizen_id/);
    expect(schema).toMatch(/invented_statutory_policy_forbidden/);
    expect(schema).not.toMatch(/sf_retention|sf_credential|sf_risk|CREATE TABLE sf_(?!assisted)/);
    expect(outbox).toMatch(/sf_assisted\.outbox_event/);
  });

  it('source tree does not invent representation statute keywords as decision logic', () => {
    const banned =
      /\b(power_of_attorney_statute|guardian_age_limit|representation_days|statutory_representation)\b/i;
    for (const file of sourceFiles(join(root, 'src'))) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(file, 'utf8');
      expect(banned.test(text), file).toBe(false);
    }
  });

  it('error catalogue subset is non-empty and known', () => {
    expect(Object.keys(ERROR_CATALOGUE_SUBSET).length).toBeGreaterThan(5);
    expect(ERROR_CATALOGUE_SUBSET['SF-AUTH-002'].http).toBe(403);
  });

  it('isolation declaration covers every sf_assisted table class', () => {
    const iso = readJson<{ entities: { entity: string }[] }>(
      join(root, 'contracts/isolation.json'),
    );
    const entities = iso.entities.map((e) => e.entity).sort();
    expect(entities).toContain('sf_assisted.assisted_session');
    expect(entities).toContain('sf_assisted.representation_authority');
    expect(entities).toContain('sf_assisted.outbox_event');
  });

  it('applied_for in frozen valid example is distinct from applied_by', () => {
    const valid = readJson<Body>(
      join(repoRoot, 'contracts/m09/examples/valid/assisted-session.json'),
    );
    expect(valid['applied_by_actor_id']).not.toBe(valid['applied_for_citizen_id']);
    expect(valid['applied_for_citizen_id']).toBe(ACTOR_CITIZEN);
  });
});
