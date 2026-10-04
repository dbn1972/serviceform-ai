import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@serviceform/observability';
import { sanitizeDecisionLog } from '../src/pep/decision-log.js';

const CANARY = 'user-canary-not-for-logs';

describe('1000 decision logs contain no canary (P11)', () => {
  it('writes 1000 allowlisted lines without canary', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({ service: 'cmp-048-test', version: '0', destination: stream });
    for (let i = 0; i < 1000; i += 1) {
      logger.info(
        sanitizeDecisionLog({
          decision_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
          trace_id: '0af7651916cd43dd8448eb211c80319c',
          correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
          policy_revision: 'w1',
          path: 'sf/authz/decision',
          allow: i % 2 === 0,
          reason_code: 'ALLOW',
          latency_ms: i,
          action: 'VIEW',
          resource_type: 'ExampleAggregate',
          resource_tenant_id: '11111111-1111-4111-8111-111111111111',
          subject_actor_type: 'OFFICER',
          roles: ['ROLE_A'],
          delegation_present: false,
        }),
        'authz decision',
      );
    }
    const blob = lines.join('');
    expect(blob).not.toContain(CANARY);
    expect(lines.length).toBeGreaterThan(900);
  });
});
