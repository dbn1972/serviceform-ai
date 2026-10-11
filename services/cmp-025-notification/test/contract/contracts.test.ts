import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import {
  CONNECTOR_MODES,
  ENVIRONMENTS,
  type DeploymentEnvironment,
} from '../../src/domain/model.js';
import {
  assertBindingPolicy,
  buildSimulationMarker,
  isSimulationMarker,
  type ConnectorBindingView,
} from '../../src/domain/simulation.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { makeHarness } from '../doubles/harness.js';
import {
  ACTOR_INTEGRATION,
  BINDING_SMS,
  ctxFor,
  DISPATCH_BODY,
  integrationCtx,
  realBinding,
  systemCtx,
  TEMPLATE_BODY,
  TENANT_A,
} from '../doubles/fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759545025000_cmp-025-notification.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759545025001_cmp-025-outbox.sql';

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

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const sharedDir = join(repoRoot, 'contracts/shared/schemas');
for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(readJson(join(sharedDir, f)));
}
const NOTIFICATION_SCHEMA_PATH = 'contracts/m06/schemas/notification-dispatch.schema.json';
ajv.addSchema(readJson(join(repoRoot, NOTIFICATION_SCHEMA_PATH)));
const validateShared = (name: string): ReturnType<Ajv['compile']> =>
  ajv.getSchema(`https://contracts.serviceform.ai/${name}/v1`) as ReturnType<Ajv['compile']>;
const validateDispatch = validateShared('m06/notification-dispatch');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

describe('FROZEN SF-CON-NOTIFICATION-DISPATCH consumption (read-only)', () => {
  it('the frozen schema file still matches its contracts-lock hash (no mutation)', () => {
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock
      .split(/\n {2}- id: /)
      .find((b) => b.startsWith('SF-CON-NOTIFICATION-DISPATCH'));
    expect(block).toBeTruthy();
    const hash = /schema_hash: ([0-9a-f]{64})/.exec(block as string)?.[1];
    const actual = createHash('sha256')
      .update(readFileSync(join(repoRoot, NOTIFICATION_SCHEMA_PATH)))
      .digest('hex');
    expect(actual).toBe(hash);
  });

  it('frozen valid example passes and the raw-PII-allowed example is refused', () => {
    const ok = readJson(join(repoRoot, 'contracts/m06/examples/valid/notification-dispatch.json'));
    const bad = readJson(
      join(repoRoot, 'contracts/m06/examples/invalid/notification-dispatch.raw-pii-allowed.json'),
    );
    expect(validateDispatch(ok), JSON.stringify(validateDispatch.errors)).toBe(true);
    expect(validateDispatch(bad)).toBe(false);
  });

  it('every dispatch the service returns is a valid contract instance (SIMULATED and REAL)', async () => {
    const sim = makeHarness();
    await sim.call('POST', '/v1/notification-templates', TEMPLATE_BODY);
    const a = await sim.call('POST', '/v1/notifications', DISPATCH_BODY);
    const instance = (a.body as Body)['dispatch'];
    expect(validateDispatch(instance), JSON.stringify(validateDispatch.errors)).toBe(true);
    expect(instance['connector_mode']).toBe('SIMULATED');
    expect(instance['simulation_marker_required_when_simulated']).toBe(true);

    const real = makeHarness({
      environment: 'PRODUCTION',
      noSimulation: true,
      testRunId: undefined,
      hub: { deliver: () => Promise.resolve({ status: 'ACCEPTED', providerMessageRef: 'p-1' }) },
      binding: realBinding(),
    });
    await real.call('POST', '/v1/notification-templates', TEMPLATE_BODY);
    const b = await real.call('POST', '/v1/notifications', DISPATCH_BODY);
    const realInstance = (b.body as Body)['dispatch'];
    expect(validateDispatch(realInstance), JSON.stringify(validateDispatch.errors)).toBe(true);
    expect(realInstance['connector_mode']).toBe('REAL');
    expect('simulation_marker_required_when_simulated' in realInstance).toBe(false);
  });

  it('a contract instance carrying raw_pii_in_payload_forbidden=false would be rejected', () => {
    const ok = readJson<Record<string, unknown>>(
      join(repoRoot, 'contracts/m06/examples/valid/notification-dispatch.json'),
    );
    expect(validateDispatch({ ...ok, raw_pii_in_payload_forbidden: false })).toBe(false);
    expect(validateDispatch({ ...ok, recipient_address: '+910000000000' })).toBe(false);
  });
});

describe('shared frozen envelopes emitted by CMP-025', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/notification-templates', TEMPLATE_BODY);
    const a = await h.call('POST', '/v1/notifications', DISPATCH_BODY);
    const id = (a.body as Body)['dispatch'].dispatch_id as string;
    await h.worker.deliverDue(systemCtx());
    h.state.ctx = integrationCtx();
    const ref = h.repo.tenant(TENANT_A).dispatches.get(id)?.provider_message_ref as string;
    await h.call('POST', `/v1/notifications/${id}/receipt`, {
      outcome: 'DELIVERED',
      provider_message_ref: ref,
    });
    const err = await h.call('POST', `/v1/notifications/${id}/receipt`, {
      outcome: 'DELIVERED',
      provider_message_ref: ref,
    });

    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/notification-event.data.schema.json')),
    );
    const outbox = h.repo.tenant(TENANT_A).outbox;
    expect(outbox.length).toBeGreaterThan(5);
    const seen = new Set<string>();
    for (const { topic, envelope } of outbox) {
      const env = validateShared('event-envelope');
      expect(env(envelope), JSON.stringify(env.errors)).toBe(true);
      seen.add(envelope.event_type);
      if (topic === TOPIC_DOMAIN) {
        expect(DOMAIN_EVENT_TYPES as readonly string[]).toContain(envelope.event_type);
        expect(dataSchema(envelope.data), JSON.stringify(dataSchema.errors)).toBe(true);
      } else {
        const audit = validateShared('audit-event');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    for (const t of [
      'NotificationTemplatePublished',
      'NotificationQueued',
      'NotificationSent',
      'NotificationDelivered',
    ]) {
      expect(seen.has(t), t).toBe(true);
    }
    const errorSchema = validateShared('error-response');
    expect(errorSchema(err.body), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('event data cannot carry addresses, bodies or parameters (additionalProperties=false)', () => {
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/notification-event.data.schema.json')),
    );
    const base = {
      dispatch_id: BINDING_SMS,
      application_id: null,
      status: 'SENT',
      channel: 'SMS',
      template_ref: 'tpl.x',
      template_version: 1,
      recipient_handle_class: 'CITIZEN_HANDLE_REF',
      connector_mode: 'SIMULATED',
      simulated: true,
      attempts: 1,
      error_code: null,
    };
    expect(dataSchema(base)).toBe(true);
    for (const extra of [{ address: 'x' }, { body: 'x' }, { template_params: {} }]) {
      expect(dataSchema({ ...base, ...extra })).toBe(false);
    }
  });

  it('PEP inputs and the request context validate against the frozen authz and request-context schemas', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/notification-templates', TEMPLATE_BODY);
    await h.call('POST', '/v1/notifications', DISPATCH_BODY);
    await h.worker.deliverDue(systemCtx());
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as ReturnType<Ajv['compile']>;
    expect(h.authorizer.calls.length).toBeGreaterThan(2);
    for (const call of h.authorizer.calls)
      expect(input(call), JSON.stringify(input.errors)).toBe(true);
    const ctxSchema = validateShared('request-context');
    expect(ctxSchema(ctxFor(TENANT_A)), JSON.stringify(ctxSchema.errors)).toBe(true);
    expect(ctxSchema(integrationCtx()), JSON.stringify(ctxSchema.errors)).toBe(true);
    expect(integrationCtx().actor.id).toBe(ACTOR_INTEGRATION);
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

describe('structural mirrors never exceed the frozen INT-013 contracts', () => {
  const bindingSchema = validateShared('connector-binding');
  const markerSchema = validateShared('simulation-marker');
  const UUID = BINDING_SMS;

  it('every binding our policy accepts is valid under SF-CON-CONNECTOR-BINDING (exhaustive)', () => {
    let accepted = 0;
    for (const environment of ENVIRONMENTS) {
      for (const mode of CONNECTOR_MODES) {
        for (const critical of [true, false]) {
          for (const secret of [null, 'aws-sm://sf/notify/ref']) {
            for (const simulator of [undefined, 'sim-1']) {
              const binding: ConnectorBindingView = {
                connector_binding_id: UUID,
                tenant_id: TENANT_A,
                connector_type: 'SMS',
                mode,
                environment,
                critical,
                secret_ref: secret,
                ...(simulator === undefined ? {} : { simulator_version: simulator }),
              };
              let ok = true;
              try {
                assertBindingPolicy(binding, {
                  tenantId: TENANT_A,
                  channel: 'SMS',
                  runtimeEnvironment: environment as DeploymentEnvironment,
                });
              } catch {
                ok = false;
              }
              if (ok) {
                accepted += 1;
                expect(
                  bindingSchema(binding),
                  `${environment}/${mode}/${String(critical)} ${JSON.stringify(bindingSchema.errors)}`,
                ).toBe(true);
              }
            }
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(8);
  });

  it('PRODUCTION critical SIMULATED/SANDBOX is refused by both the policy and the contract', () => {
    for (const mode of ['SIMULATED', 'SANDBOX'] as const) {
      const binding = {
        connector_binding_id: UUID,
        tenant_id: TENANT_A,
        connector_type: 'SMS',
        mode,
        environment: 'PRODUCTION',
        critical: true,
        secret_ref: 'aws-sm://sf/notify/ref',
        simulator_version: 'sim-1',
      } as const;
      expect(bindingSchema(binding)).toBe(false);
      expect(() =>
        assertBindingPolicy(binding, {
          tenantId: TENANT_A,
          channel: 'SMS',
          runtimeEnvironment: 'PRODUCTION',
        }),
      ).toThrow();
    }
  });

  it('isSimulationMarker agrees with SF-CON-SIMULATION-MARKER on a case table', () => {
    const base = {
      simulation: true,
      scenario: 'notification_sms',
      test_run_id: 'r1',
      connector_binding_id: UUID,
      environment: 'CI',
    };
    const cases: unknown[] = [
      base,
      { ...base, environment: 'PRODUCTION' },
      { ...base, environment: 'UAT' },
      { ...base, scenario: 'Bad Scenario' },
      { ...base, scenario: 'x' },
      { ...base, test_run_id: '' },
      { ...base, test_run_id: 'x'.repeat(129) },
      { ...base, simulation: false },
      { ...base, extra: 1 },
      { ...base, connector_binding_id: 'nope' },
      { simulation: true },
      null,
      'str',
    ];
    for (const c of cases) {
      expect(isSimulationMarker(c), JSON.stringify(c)).toBe(markerSchema(c));
    }
  });

  it('minted markers validate under the frozen marker schema', () => {
    const marker = buildSimulationMarker(
      {
        connector_binding_id: UUID,
        tenant_id: TENANT_A,
        connector_type: 'SMS',
        mode: 'SIMULATED',
        environment: 'SIT',
        critical: false,
        secret_ref: null,
        simulator_version: 'sim-1',
      },
      'SMS',
      'run-1',
    );
    expect(markerSchema(marker), JSON.stringify(markerSchema.errors)).toBe(true);
  });
});

describe('CMP-025 component contracts', () => {
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

  it('OpenAPI mutating bodies are closed and refuse client-supplied mode, tenant, address or clock', () => {
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
    const banned = [
      'connector_mode',
      'tenant_id',
      'simulation_marker',
      'address',
      'recipient_address',
      'to',
      'now',
      'requested_at',
      'sent_at',
      'timestamp',
    ];
    let checked = 0;
    for (const [path, ops] of Object.entries(openapi.paths)) {
      for (const op of Object.values(ops)) {
        const schema = op.requestBody?.content['application/json'].schema;
        if (!schema) continue;
        checked += 1;
        expect(schema.additionalProperties, path).toBe(false);
        for (const key of banned)
          expect(Object.keys(schema.properties), `${path}:${key}`).not.toContain(key);
      }
    }
    expect(checked).toBe(3);
  });

  it('isolation declarations validate and match the migrations (every table FORCE RLS)', () => {
    const iso = readJson<{ entities: Body[] }>(join(root, 'contracts/isolation.json'));
    const validateIso = validateShared('isolation-declaration');
    for (const row of iso.entities)
      expect(validateIso(row), JSON.stringify(validateIso.errors)).toBe(true);
    const sql =
      readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8') +
      readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    for (const row of iso.entities) {
      expect(sql).toContain(
        `-- sf:isolation ${row['entity']} ${row['isolation_class']} owner=CMP-025`,
      );
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
    const declared = [...sql.matchAll(/-- sf:isolation (\S+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(iso.entities.map((e) => String(e['entity'])).sort());
  });
});

describe('boundary: no providers, no network in src, no host mount, no secrets', () => {
  const srcFiles = sourceFiles(join(root, 'src'));
  const stripComments = (text: string): string =>
    text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const srcText = srcFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  const migrationText = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
    .map((m) => readFileSync(join(repoRoot, m), 'utf8'))
    .join('\n');

  it('imports no provider SDK or network module and declares no runtime dependency', () => {
    const importLines = srcText
      .split('\n')
      .filter((l) => /^\s*(?:import|export)\b.*\bfrom\b/.test(l) || /\brequire\(/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(
        /nodemailer|twilio|sendgrid|@aws-sdk|aws-sdk|firebase|msg91|smtp|node:(http|https|net|tls|dgram|dns)|from 'pg'|undici|axios/i,
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

  it('never reads the environment, console-logs, or embeds a secret value', () => {
    expect(srcText).not.toMatch(/process\.env|console\.(log|info|warn|error|debug)/);
    expect(srcText).not.toMatch(
      /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]\s*['"][^'"]+)/,
    );
  });

  it('has no hard-coded tenant, jurisdiction, service or official names in domain logic', () => {
    expect(srcText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(srcText).not.toMatch(/residence|certificate|tahsildar|collector|district/i);
  });

  it('only touches sf_notification in SQL, imports no sibling service and never mounts on the API host', () => {
    const sqlSrc = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    const schemas = new Set([...sqlSrc.matchAll(/\b(sf_[a-z_]+)\./g)].map((m) => m[1]));
    expect([...schemas]).toEqual(['sf_notification']);
    expect(srcText).not.toMatch(/from\s+['"](\.\.\/)+services\//);
    expect(srcText).not.toMatch(/apps\/api|fastify|@serviceform\//);
    const sqlOnly = migrationText
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(sqlOnly).not.toMatch(/REFERENCES\s+(?!sf_notification\.)\w+\.\w+/i);
  });

  it('role and privilege posture: NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS, no PUBLIC, no DELETE on dispatch', () => {
    expect(migrationText).toMatch(
      /CREATE ROLE sf_cmp025_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    expect(migrationText.replaceAll(/NOBYPASSRLS|NOSUPERUSER/g, '')).not.toMatch(
      /\bBYPASSRLS\b|\bSUPERUSER\b/,
    );
    expect(migrationText).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC/i);
    expect(migrationText).not.toMatch(/GRANT[^;]*DELETE[^;]*notification_dispatch/i);
  });

  it('database enforces INT-013 independently of the application (defence in depth)', () => {
    expect(migrationText).toContain(
      "CHECK ((connector_mode = 'SIMULATED') = (simulation_marker IS NOT NULL))",
    );
    expect(migrationText).toContain(
      "CHECK (NOT (connector_environment = 'PRODUCTION' AND connector_critical AND connector_mode <> 'REAL'))",
    );
    expect(migrationText).toContain(
      "connector_mode <> 'SIMULATED' OR connector_environment IN ('LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE')",
    );
  });

  it('delivery performs provider I/O between transactions (claim -> send -> finalize)', () => {
    const delivery = readFileSync(join(root, 'src/service/delivery.ts'), 'utf8');
    const claim = delivery.indexOf('tx.claimDue');
    const send = delivery.indexOf('connector.send(');
    const finalize = delivery.indexOf('private async finalize');
    expect(claim).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(claim);
    expect(finalize).toBeGreaterThan(send);
    const sendRegion = delivery.slice(send - 200, send + 50);
    expect(sendRegion).not.toContain('withTx');
  });
});
