import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LAB_INTEROP_HYGIENE_CATALOGUE,
  loadInteropHygieneCatalogue,
  parseInteropHygieneCatalogue,
  proveBpmnFixture,
  registerLabInteropHygieneRoutes,
  runInteropHygieneSuite,
  screenBpmnProfile,
  simulateInFlightMigration,
  validateSfPackageManifest,
} from '../src/platform/interop-hygiene.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = join(ROOT, 'fixtures/lab/platform/interop-hygiene-catalogue.json');
const PACKAGE_SRC = join(ROOT, 'packages/m10-sample-lab/src/interop-hygiene-catalogue.ts');

describe('SAMPLE_LAB interop hygiene lab routes', () => {
  const apps: { close: () => Promise<void> }[] = [];
  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  it('fixture and package source declare Temporal-only / no Camunda / no G6', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      camunda_runtime_forbidden: boolean;
      temporal_remains_runtime: boolean;
      certified: boolean;
      g6: boolean;
    };
    expect(fixture.camunda_runtime_forbidden).toBe(true);
    expect(fixture.temporal_remains_runtime).toBe(true);
    expect(fixture.certified).toBe(false);
    expect(fixture.g6).toBe(false);

    const src = readFileSync(PACKAGE_SRC, 'utf8');
    expect(src).toContain('camunda_runtime_forbidden');
    expect(src).toContain('IMPORT_EXPORT_PROFILE_ONLY');
    expect(src).toContain('embedded_secrets_forbidden');
    expect(src).toContain('SILENT_REPOINT_FORBIDDEN');
    expect(src).not.toContain('CERTIFIED=true');
  });

  it('loadInteropHygieneCatalogue reads fixture', () => {
    const catalogue = loadInteropHygieneCatalogue(join(ROOT, 'fixtures/lab/platform'));
    expect(catalogue.bpmn_fixtures.length).toBeGreaterThanOrEqual(2);
    expect(catalogue.sfpackage.embedded_secrets_forbidden).toBe(true);
    expect(catalogue.migration_scenarios.length).toBeGreaterThanOrEqual(2);
    expect(parseInteropHygieneCatalogue(catalogue).mode).toBe('SAMPLE_LAB');
  });

  it('suite passes and refuses Camunda / silent migrate', () => {
    const suite = runInteropHygieneSuite({
      catalogue: LAB_INTEROP_HYGIENE_CATALOGUE,
      environment: 'LOCAL',
    });
    expect(suite.ok).toBe(true);
    expect(suite.g6).toBe(false);
    expect(suite.certified).toBe(false);

    const camunda = LAB_INTEROP_HYGIENE_CATALOGUE.bpmn_fixtures.find(
      (f) => f.fixture_id === 'bpmn-camunda-assignee-forbidden',
    );
    expect(camunda).toBeTruthy();
    if (!camunda) throw new Error('missing camunda fixture');
    expect(proveBpmnFixture(camunda).ok).toBe(true);
    expect(screenBpmnProfile({ xml: camunda.xml }).ok).toBe(false);

    const scenario = LAB_INTEROP_HYGIENE_CATALOGUE.migration_scenarios[1];
    expect(scenario).toBeTruthy();
    if (!scenario) throw new Error('missing scenario');
    expect(
      simulateInFlightMigration({
        scenario,
        requested_by: 'a',
        approved_by: 'b',
        apply: false,
        environment: 'LOCAL',
      }).reason_codes,
    ).toContain('SILENT_REPOINT_FORBIDDEN');

    expect(
      validateSfPackageManifest({
        manifest: LAB_INTEROP_HYGIENE_CATALOGUE.sfpackage,
        environment: 'LOCAL',
      }).ok,
    ).toBe(true);
  });

  it('GET catalogue and POST prove expose lab hygiene without G6 claim', async () => {
    const app = Fastify();
    apps.push(app);
    registerLabInteropHygieneRoutes(app, {
      environment: 'LOCAL',
      catalogue: LAB_INTEROP_HYGIENE_CATALOGUE,
    });

    const catalogue = await app.inject({ method: 'GET', url: '/v1/lab/interop/catalogue' });
    expect(catalogue.statusCode).toBe(200);
    const catalogueBody = catalogue.json() as {
      camunda_runtime_forbidden: boolean;
      temporal_remains_runtime: boolean;
      certified: boolean;
      g6_issued: boolean;
    };
    expect(catalogueBody.camunda_runtime_forbidden).toBe(true);
    expect(catalogueBody.temporal_remains_runtime).toBe(true);
    expect(catalogueBody.certified).toBe(false);
    expect(catalogueBody.g6_issued).toBe(false);

    const prove = await app.inject({ method: 'POST', url: '/v1/lab/interop/prove' });
    expect(prove.statusCode).toBe(200);
    const proveBody = prove.json() as {
      ok: boolean;
      certified: boolean;
      g6: boolean;
      g6_issued: boolean;
      camunda_runtime_forbidden: boolean;
    };
    expect(proveBody.ok).toBe(true);
    expect(proveBody.certified).toBe(false);
    expect(proveBody.g6).toBe(false);
    expect(proveBody.g6_issued).toBe(false);
    expect(proveBody.camunda_runtime_forbidden).toBe(true);

    const bpmn = await app.inject({
      method: 'POST',
      url: '/v1/lab/interop/bpmn/screen',
      payload: { fixture_id: 'bpmn-camunda-assignee-forbidden' },
    });
    expect(bpmn.statusCode).toBe(200);
    expect((bpmn.json() as { compatibility_status: string }).compatibility_status).toBe(
      'UNSUPPORTED',
    );

    const pkg = await app.inject({ method: 'POST', url: '/v1/lab/interop/sfpackage/validate' });
    expect(pkg.statusCode).toBe(200);
    expect((pkg.json() as { embedded_secrets_forbidden: boolean }).embedded_secrets_forbidden).toBe(
      true,
    );

    const mig = await app.inject({
      method: 'POST',
      url: '/v1/lab/interop/migration/simulate',
      payload: { scenario_id: 'mig-safe-point' },
    });
    expect(mig.statusCode).toBe(200);
    expect((mig.json() as { applied: boolean; dry_run: boolean }).applied).toBe(false);
    expect((mig.json() as { dry_run: boolean }).dry_run).toBe(true);
  });
});
