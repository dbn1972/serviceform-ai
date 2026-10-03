import { describe, expect, it } from 'vitest';
import { authorizeAction, type PdpClient } from '@serviceform/security';
import type { AuthzDecisionOutput } from '@serviceform/contracts';
import { T1, U1 } from './helpers.js';

describe('local decision latency (evidence, not a gate)', () => {
  it('records p99 of 500 local decisions', async () => {
    const pdp: PdpClient = {
      decide: async (): Promise<AuthzDecisionOutput> => ({
        allow: false,
        reason_code: 'ROLE_NOT_PERMITTED',
        policy_revision: 'w1',
        decision_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
      }),
    };
    const samples: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const t0 = performance.now();
      await authorizeAction({
        ctx: {
          tenant_id: T1,
          cell_id: 'cell-01',
          actor: { type: 'OFFICER', id: U1 },
          roles: ['ROLE_A'],
          jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
          auth_assurance: 'MFA',
          correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
          trace_id: '0af7651916cd43dd8448eb211c80319c',
        },
        action: 'VIEW',
        resource: {
          resource_type: 'ExampleAggregate',
          tenant_id: T1,
          classification: 'TENANT_SCOPED',
        },
        pdp,
      });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)] ?? 0;
    expect(p99).toBeGreaterThan(0);
    process.stdout.write(`decision_latency_p99_ms=${p99}\n`);
  });
});
