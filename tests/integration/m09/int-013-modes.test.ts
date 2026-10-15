import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { buildSchedulerService } from '../../../services/cmp-056-scheduler/src/index.js';
import { buildAssistedSessionService } from '../../../services/cmp-057-assisted-service/src/index.js';
import { buildPrivacyCentreService } from '../../../services/cmp-061-privacy-centre/src/index.js';
import {
  SimulatedAllowAllTenantAuthz,
  SimulatedReviewRoutingPort,
} from '../../../services/cmp-060-risk-integrity/src/index.js';
import { ctxFor, OFFICER_1, RecordingAuthorizer, silentLogger, T1 } from './support/fixtures.js';
import { RecordingPool } from './support/pool-double.js';

/**
 * INT-013 for M09. The only SIMULATED connector-like ports M09 ships are in CMP-060:
 * SimulatedReviewRoutingPort (mode SIMULATED, documented "must not be used in production") and
 * SimulatedAllowAllTenantAuthz (documented "unit tests only"). CMP-056/057/058/059/061 ship no
 * simulator; their external dependencies must be bound explicitly or fail closed.
 */
const OFFICER = ctxFor(T1, OFFICER_1, 'OFFICER');
const SUBJECT_APP = 'abababab-abab-4bab-8bab-abababababab';
const productionConfig = loadConfig({
  SF_ENVIRONMENT: 'PRODUCTION',
  SF_SERVICE_VERSION: '0.0.0-m09-int',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
  DATABASE_URL: 'postgres://int-placeholder@127.0.0.1:1/none',
});
const rowsFor = (sql: string) =>
  /^\s*UPDATE/i.test(sql) ? { rows: [], rowCount: 1 } : { rows: [] as unknown[] };

function expectCode(fn: () => unknown, code: string, detailCode?: string): void {
  try {
    fn();
    expect.fail(`expected ${code}`);
  } catch (err) {
    const e = err as { code?: string; details?: Array<{ code?: string }> };
    expect(e.code).toBe(code);
    if (detailCode) expect((e.details ?? []).some((d) => d.code === detailCode)).toBe(true);
  }
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('INT-013 M09 unbound dependencies fail closed (no simulator, no fabrication)', () => {
  const notifier = { notifyAppointment: async () => undefined };
  const verification = { applicantInTenant: async () => true, consentCaptured: async () => true };

  it('CMP-056 scheduler refuses construction without a repository (SF-SYS-001)', () => {
    expectCode(
      () =>
        buildSchedulerService({
          authorizer: new RecordingAuthorizer(),
          notifier,
        } as Parameters<typeof buildSchedulerService>[0]),
      'SF-SYS-001',
      'REPOSITORY_REQUIRED',
    );
  });

  it('CMP-057 assisted service refuses construction without a repository (SF-SYS-001)', () => {
    expectCode(
      () =>
        buildAssistedSessionService({
          authorizer: new RecordingAuthorizer(),
          verification,
        } as Parameters<typeof buildAssistedSessionService>[0]),
      'SF-SYS-001',
      'REPOSITORY_REQUIRED',
    );
  });

  it('CMP-061 privacy centre refuses construction without a repository (SF-SYS-001)', () => {
    expectCode(
      () =>
        buildPrivacyCentreService({
          authorizer: new RecordingAuthorizer(),
        } as unknown as Parameters<typeof buildPrivacyCentreService>[0]),
      'SF-SYS-001',
      'REPOSITORY_REQUIRED',
    );
  });

  it('CMP-058 host mount without an authorizer fails closed with no data statement', async () => {
    const pool = new RecordingPool();
    app = await buildApp(productionConfig, {
      logger: silentLogger(),
      m09: { semantic: { options: { pool }, resolveContext: async () => OFFICER } },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/elements' });
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
    expect(pool.dataStatements()).toEqual([]);
  });

  it('CMP-059 host mount without an authorizer fails closed in PRODUCTION (deny-all default)', async () => {
    const pool = new RecordingPool();
    app = await buildApp(productionConfig, {
      logger: silentLogger(),
      m09: { migration: { options: { pool }, resolveContext: async () => OFFICER } },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/migrations/cccccccc-cccc-4ccc-8ccc-cccccccccccc/reconciliation',
    });
    expect(res.statusCode).toBe(403);
    expect(pool.dataStatements()).toEqual([]);
  });
});

describe('INT-013 M09 SIMULATED boundaries (CMP-060)', () => {
  it('SIMULATED review routing is self-labelled and returns a routing ref only (never a decision)', async () => {
    const port = new SimulatedReviewRoutingPort();
    expect(port.mode).toBe('SIMULATED');
    const out = await port.routeToReview({
      tenant_id: T1,
      assessment_id: SUBJECT_APP,
      subject_application_id: SUBJECT_APP,
      risk_tier: 'HIGH',
      signal_count: 0,
      correlation_id: SUBJECT_APP,
    });
    expect(Object.keys(out)).toEqual(['routing_ref']);
  });

  it('PRODUCTION host refuses a SIMULATED review-routing port (fail closed, Constitution rule 22)', async () => {
    const pool = new RecordingPool(rowsFor);
    let admitted = true;
    try {
      app = await buildApp(productionConfig, {
        logger: silentLogger(),
        m09: {
          risk: {
            options: {
              pool,
              authz: { canActOnRisk: async () => true },
              reviewRouting: new SimulatedReviewRoutingPort(),
            },
            resolveContext: async () => OFFICER,
          },
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/risk/assessments',
        payload: {
          subject_application_id: SUBJECT_APP,
          idempotency_key: 'risk-prod-sim-0001',
          raw_risk_score: 0.99,
          signals: [],
        },
      });
      admitted = res.statusCode < 400;
    } catch {
      admitted = false;
    }
    expect(admitted, 'SIMULATED review routing admitted and used in PRODUCTION').toBe(false);
  });

  it('PRODUCTION host refuses SimulatedAllowAllTenantAuthz (fail closed)', async () => {
    const pool = new RecordingPool(rowsFor);
    let admitted = true;
    try {
      app = await buildApp(productionConfig, {
        logger: silentLogger(),
        m09: {
          risk: {
            options: { pool, authz: new SimulatedAllowAllTenantAuthz() },
            resolveContext: async () => OFFICER,
          },
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/risk/assessments',
        payload: {
          subject_application_id: SUBJECT_APP,
          idempotency_key: 'risk-prod-sim-0002',
          raw_risk_score: 0.1,
          signals: [],
        },
      });
      admitted = res.statusCode < 400;
    } catch {
      admitted = false;
    }
    expect(admitted, 'SIMULATED allow-all authz admitted and used in PRODUCTION').toBe(false);
  });
});
