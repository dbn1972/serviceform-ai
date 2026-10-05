import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { decidePause, decideResume, type PolicySpec } from '../../src/domain/clock.js';
import { APPLICATION_ID, ctxFor, TENANT_A } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759540400000_cmp-029-sla-escalation.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759540400001_cmp-029-outbox.sql';

// Frozen shared + M05 schemas are loaded read-only. AJV is resolved through packages/contracts
// (the established pattern in evidence/SF-M05-CG-001/validate-m05-schemas.mjs) because CMP-029
// declares no runtime or dev dependencies of its own.
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
const sharedDir = join(repoRoot, 'contracts/shared/schemas');
for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(readJson(join(sharedDir, f)));
}
const slaSchema = readJson(join(repoRoot, 'contracts/m05/schemas/sla-clock.schema.json'));
ajv.addSchema(slaSchema);
const validateSla = ajv.getSchema(
  'https://contracts.serviceform.ai/m05/sla-clock/v1',
) as ReturnType<Ajv['compile']>;
const validateShared = (name: string): ReturnType<Ajv['compile']> =>
  ajv.getSchema(`https://contracts.serviceform.ai/${name}/v1`) as ReturnType<Ajv['compile']>;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('SF-CON-SLA-CLOCK (FROZEN) conformance of CMP-029 projections', () => {
  it('every clock status the service can produce validates against the frozen schema', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const started = await h.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    const id = (started.body as Body).sla_clock.clock_id as string;
    const seen: Body[] = [(started.body as Body).sla_clock];
    h.clock.set('2026-10-06T10:00:00Z');
    seen.push(
      (
        (await h.call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' }))
          .body as Body
      ).sla_clock,
    );
    h.clock.set('2026-10-08T09:00:00Z');
    seen.push(((await h.call('POST', `/v1/sla-clocks/${id}/resume`, {})).body as Body).sla_clock);
    h.clock.set('2026-10-08T17:00:00Z');
    seen.push(((await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {})).body as Body).sla_clock);
    seen.push(
      (
        (
          await h.call('POST', `/v1/sla-clocks/${id}/complete`, {
            completion_anchor: 'DECISION_RECORDED',
          })
        ).body as Body
      ).sla_clock,
    );
    expect(seen.map((s) => s['clock_status'])).toEqual([
      'RUNNING',
      'PAUSED',
      'RUNNING',
      'BREACHED',
      'COMPLETED',
    ]);
    for (const view of seen) {
      expect(validateSla(view), JSON.stringify(validateSla.errors)).toBe(true);
    }
  });

  it('the frozen valid examples are accepted and the frozen invalid examples are refused by CMP-029 rules', () => {
    const dir = join(repoRoot, 'contracts/m05/examples');
    const policy: PolicySpec = {
      start_anchor: 'APPLICATION_RECEIVED',
      completion_anchor: 'DECISION_RECORDED',
      duration_basis: 'CALENDAR_MINUTES',
      duration_minutes: 1000,
      warning_before_minutes: null,
      allowed_pause_reason_codes: ['DEFICIENCY_OPEN'],
      escalation_schedule: [],
    };
    const cal = {
      utc_offset_minutes: 0,
      working_weekdays: [1],
      window_start_minute: 0,
      window_end_minute: 1440,
      holidays: [],
    };
    const state = {
      status: 'RUNNING' as const,
      started_at: '2026-10-01T00:00:00.000Z',
      deadline_at: '2026-10-20T00:00:00.000Z',
      remaining_ms: null,
      paused_at: null,
      pause_reason_code: null,
      pause_count: 0,
      resumed_at: null,
      completed_at: null,
      breach_at: null,
      warning_emitted_at: null,
      escalation_level: 0,
    };
    const now = Date.parse('2026-10-05T00:00:00Z');

    const validPause = readJson<Body>(join(dir, 'valid/sla-clock.pause-int009.json'));
    expect(validateSla(validPause)).toBe(true);
    expect(decidePause(state, policy, cal, now, validPause['pause_reason_code']).to_status).toBe(
      'PAUSED',
    );

    const invalidPause = readJson<Body>(join(dir, 'invalid/sla-clock.pause-not-published.json'));
    expect(validateSla(invalidPause)).toBe(false);
    expect(() =>
      decidePause(
        state,
        { ...policy, allowed_pause_reason_codes: [] },
        cal,
        now,
        invalidPause['pause_reason_code'],
      ),
    ).toThrow();

    const invalidResume = readJson<Body>(join(dir, 'invalid/sla-clock.resume-not-paused.json'));
    expect(validateSla(invalidResume)).toBe(false);
    expect(() => decideResume(state, policy, cal, now)).toThrow();
    expect(validateSla(readJson(join(dir, 'valid/sla-clock.json')))).toBe(true);
  });

  it('a client-supplied clock value is not a member of any request schema', () => {
    const openapi = readJson<{
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: {
              content: {
                'application/json': {
                  schema: { properties: Record<string, unknown>; additionalProperties: boolean };
                };
              };
            };
          }
        >
      >;
    }>(join(root, 'contracts/openapi.json'));
    const banned = ['now', 'clock_now', 'occurred_at', 'deadline_at', 'started_at', 'timestamp'];
    for (const [path, ops] of Object.entries(openapi.paths)) {
      for (const op of Object.values(ops)) {
        const schema = op.requestBody?.content['application/json'].schema;
        if (!schema) continue;
        expect(schema.additionalProperties, path).toBe(false);
        for (const key of banned)
          expect(Object.keys(schema.properties), `${path}:${key}`).not.toContain(key);
      }
    }
  });
});

describe('shared frozen envelopes emitted by CMP-029', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    h.clock.set('2026-10-07T10:00:00Z');
    await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    const err = await h.call('POST', `/v1/sla-clocks/${id}/resume`, {});

    const outbox = h.repo.tenant(TENANT_A).outbox;
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/sla-clock-event.data.schema.json')),
    );
    expect(outbox.length).toBeGreaterThan(3);
    for (const { topic, envelope } of outbox) {
      const ok = validateShared('event-envelope');
      expect(ok(envelope), JSON.stringify(ok.errors)).toBe(true);
      if (topic === TOPIC_DOMAIN)
        expect(dataSchema(envelope.data), JSON.stringify(dataSchema.errors)).toBe(true);
      else {
        const audit = validateShared('audit-event');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    const errorSchema = validateShared('error-response');
    expect(errorSchema(err.body), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('PEP inputs and the request context validate against the frozen authz and request-context schemas', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    await h.call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' });
    await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, { key: null });
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as ReturnType<Ajv['compile']>;
    expect(h.authorizer.calls.length).toBeGreaterThan(4);
    for (const call of h.authorizer.calls)
      expect(input(call), JSON.stringify(input.errors)).toBe(true);
    const ctxSchema = validateShared('request-context');
    expect(ctxSchema(ctxFor(TENANT_A)), JSON.stringify(ctxSchema.errors)).toBe(true);
  });

  it('error codes and statuses are exactly those of the frozen error catalogue', () => {
    const catalogue = readJson<{ codes: { code: string; http: number[] }[] }>(
      join(repoRoot, 'contracts/shared/error-catalogue.json'),
    );
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE_SUBSET)) {
      const found = catalogue.codes.find((c) => c.code === code);
      expect(found, code).toBeTruthy();
      expect(found?.http).toContain(entry.http);
    }
  });
});

describe('CMP-029 component contracts', () => {
  it('OpenAPI lists every route the handler serves, and AsyncAPI every emitted event', () => {
    const openapi = readJson<{ paths: Record<string, Record<string, { operationId: string }>> }>(
      join(root, 'contracts/openapi.json'),
    );
    const documented = Object.entries(openapi.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(
        ([method, op]) =>
          `${method.toUpperCase()} ${path.replaceAll(/\{(\w+)\}/g, ':$1')} ${op.operationId}`,
      ),
    );
    const served = ROUTE_DESCRIPTORS.map((r) => `${r.method} ${r.path} ${r.operationId}`);
    expect(documented.sort()).toEqual(served.sort());
    const asyncapi = readJson<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      join(root, 'contracts/asyncapi.json'),
    );
    expect(Object.keys(asyncapi.channels[TOPIC_DOMAIN]?.messages ?? {}).sort()).toEqual(
      [...DOMAIN_EVENT_TYPES].sort(),
    );
    expect(readJson<{ name: string }>(join(root, 'contracts/topics.json')).name).toBe(TOPIC_DOMAIN);
  });

  it('isolation declarations validate and match the migration (every table FORCE RLS)', () => {
    const iso = readJson<{ entities: Body[] }>(join(root, 'contracts/isolation.json'));
    const validateIso = validateShared('isolation-declaration');
    for (const row of iso.entities)
      expect(validateIso(row), JSON.stringify(validateIso.errors)).toBe(true);
    const sql =
      readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8') +
      readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    for (const row of iso.entities) {
      expect(sql).toContain(
        `-- sf:isolation ${row['entity']} ${row['isolation_class']} owner=CMP-029`,
      );
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
    const declared = [...sql.matchAll(/-- sf:isolation (\S+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(iso.entities.map((e) => String(e['entity'])).sort());
  });
});

describe('boundary: no providers, no case-state writes, no host mount', () => {
  const srcFiles = sourceFiles(join(root, 'src'));
  const stripComments = (text: string): string =>
    text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const srcText = srcFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  const migrationText = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
    .map((m) => readFileSync(join(repoRoot, m), 'utf8'))
    .join('\n');

  it('contains no SMS, e-mail, push or other notification provider implementation (M06)', () => {
    expect(
      srcFiles.filter((f) =>
        /(sms|e-?mail|push|smtp|twilio|sendgrid|ses|sns|fcm|apns|msg91)/i.test(
          f.split('/src/')[1] ?? '',
        ),
      ),
    ).toEqual([]);
    const importLines = srcText
      .split('\n')
      .filter((l) => /^\s*(import|export)\b.*\bfrom\b|require\(/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(
        /nodemailer|twilio|sendgrid|@aws-sdk|aws-sdk|firebase|apn|msg91|smtp|node:(http|https|net|tls|dgram)/i,
      );
    }
    expect(srcText).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/);
    const pkg = readJson<{
      dependencies?: object;
      devDependencies?: object;
      peerDependencies?: object;
    }>(join(root, 'package.json'));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('the only notification surface is the CMP-025 port, carrying no recipient or channel', () => {
    const port = stripComments(readFileSync(join(root, 'src/ports/notification-port.ts'), 'utf8'));
    expect(port).toContain("notification_port: 'M06_CMP025'");
    expect(port).not.toMatch(/recipient|channel|template|phone|address|body/i);
  });

  it('has no path to case/application state: no reference to CMP-015 schemas, tables or code', () => {
    expect(srcText).not.toMatch(
      /sf_case|sf_application|cmp-015|CMP-015|case_state|application_state/,
    );
    expect(migrationText).not.toMatch(/sf_case|sf_application|REFERENCES\s+(?!sf_sla\.)\w+\.\w+/i);
    const grants = migrationText.split('\n').filter((l) => /^GRANT /i.test(l));
    for (const g of grants)
      expect(g).not.toMatch(/sf_case|sf_application|sf_tenant_org|sf_audit|sf_workflow/);
    for (const f of srcFiles) {
      expect(stripComments(readFileSync(f, 'utf8')), f).not.toMatch(
        /from\s+['"](\.\.\/)+(\.\.\/)?services\//,
      );
    }
  });

  it('only touches its own schema in SQL and never mounts on the API host', () => {
    const sqlSrc = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    const schemas = new Set([...sqlSrc.matchAll(/\b(sf_[a-z_]+)\./g)].map((m) => m[1]));
    expect([...schemas]).toEqual(['sf_sla']);
    expect(srcText).not.toMatch(/apps\/api|fastify|@serviceform\//);
  });

  it('runs no network call inside the authoritative transaction', () => {
    const svc = readFileSync(join(root, 'src/service/sla-service.ts'), 'utf8');
    expect(svc).toContain('NETWORK_IN_TX');
    expect(svc).toMatch(/if \(!outcome\.replayed\) await this\.notify/);
  });

  it('role and privilege posture in the migration: NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS, no public', () => {
    expect(migrationText).toMatch(
      /CREATE ROLE sf_cmp029_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    expect(migrationText.replaceAll(/NOBYPASSRLS|NOSUPERUSER/g, '')).not.toMatch(
      /\bBYPASSRLS\b|\bSUPERUSER\b/,
    );
    expect(migrationText).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC/i);
    const sfAppGrants = migrationText.split('\n').filter((l) => /^GRANT\b.*\bTO sf_app;/.test(l));
    for (const g of sfAppGrants)
      expect(g).toMatch(
        /GRANT (USAGE ON SCHEMA|INSERT ON sf_sla\.(outbox|inbox)|SELECT, INSERT ON sf_sla\.inbox|USAGE, SELECT ON ALL SEQUENCES)/,
      );
  });
});
