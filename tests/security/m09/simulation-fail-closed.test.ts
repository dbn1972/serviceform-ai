import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { RiskAssessmentService } from '../../../services/cmp-060-risk-integrity/src/index.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const M09_SERVICES = [
  'cmp-056-scheduler',
  'cmp-057-assisted-service',
  'cmp-058-semantic-registry',
  'cmp-059-migration-workbench',
  'cmp-060-risk-integrity',
  'cmp-061-privacy-centre',
] as const;

const T1 = '11111111-1111-4111-8111-111111111111';
const APP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CTX: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-local',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Fake pg pool that records statements and whether a transaction is open. */
function recordingPool(events: string[]) {
  let inTx = false;
  const query = async (text: string) => {
    const head = String(text).trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    if (head === 'BEGIN') inTx = true;
    if (head === 'COMMIT' || head === 'ROLLBACK') inTx = false;
    events.push(`sql:${head}`);
    return { rows: [], rowCount: 1 };
  };
  return {
    pool: {
      query,
      connect: async () => {
        events.push('pool.connect');
        return { query, release: () => undefined };
      },
      end: async () => undefined,
      on: () => undefined,
    },
    inTx: () => inTx,
  };
}

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m09-sec',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

function quietLogger() {
  const destination = new Writable({ write: (_c, _e, cb) => cb() });
  return createLogger({ service: 'm09-sec', version: 'test', level: 'info', destination });
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('SF-M09-SEC M09 SIMULATED / fail-closed boundaries', () => {
  it('inventory: only CMP-060 ships SIMULATED port implementations in M09', () => {
    const hits: string[] = [];
    for (const svc of M09_SERVICES) {
      for (const file of walkTs(join(ROOT, 'services', svc, 'src'))) {
        if (/class\s+Simulated\w+|mode\s*=\s*'SIMULATED'/.test(readFileSync(file, 'utf8'))) {
          hits.push(file.slice(ROOT.length + 1));
        }
      }
    }
    expect(hits.sort()).toEqual([
      'services/cmp-060-risk-integrity/src/ports/review-routing.ts',
      'services/cmp-060-risk-integrity/src/ports/tenant-authz.ts',
    ]);
  });

  it('FINDING: CMP-060 mounted without authz port currently allows create (default-allow risk)', async () => {
    const events: string[] = [];
    const { pool } = recordingPool(events);
    app = await buildApp(config, {
      logger: quietLogger(),
      m09: { risk: { options: { pool }, resolveContext: async () => CTX } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/risk/assessments',
      payload: {
        subject_application_id: APP_ID,
        idempotency_key: 'sec-idem-0001',
        raw_risk_score: 0.1,
      },
    });
    // Independent SEC records owner deviation — do not patch CMP-060 here.
    expect(res.statusCode).not.toBe(403);
    expect(events.length).toBeGreaterThan(0);
  });

  it('FINDING: CMP-060 SIMULATED review routing lacks PRODUCTION/UAT/PREPROD environment guard', () => {
    const src = walkTs(join(ROOT, 'services/cmp-060-risk-integrity/src'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const hasEnvironmentGuard =
      /PRODUCTION/.test(src) &&
      /SIMULATED[\s\S]{0,400}(throw|reject)|(throw|reject)[\s\S]{0,400}SIMULATED/.test(src);
    expect(hasEnvironmentGuard).toBe(false);
  });

  it('FINDING: CMP-060 review-routing port may run inside the authoritative DB transaction', async () => {
    const events: string[] = [];
    const rec = recordingPool(events);
    let routedInsideTx: boolean | undefined;
    const svc = new RiskAssessmentService(
      rec.pool as never,
      { canActOnRisk: async () => true },
      {
        routeToReview: async (p) => {
          routedInsideTx = rec.inTx();
          events.push('port.routeToReview');
          return { routing_ref: `ref-${p.assessment_id}` };
        },
      },
    );
    await svc.createAssessment({
      tenant_id: T1,
      cell_id: 'cell-local',
      subject_application_id: APP_ID,
      idempotency_key: 'sec-idem-0002',
      correlation_id: CTX.correlation_id,
      signals: [],
      raw_risk_score: 0.95,
      model_or_rule_version: null,
      actor_type: 'OFFICER',
      requested_by: CTX.actor.id,
    } as never);
    expect(events).toContain('port.routeToReview');
    // Recorded FINDING when routing occurs before COMMIT.
    expect(routedInsideTx === true || events.indexOf('port.routeToReview') < events.lastIndexOf('sql:COMMIT')).toBe(
      true,
    );
  });
});
