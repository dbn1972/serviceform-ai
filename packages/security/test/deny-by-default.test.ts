import { describe, expect, it } from 'vitest';
import { authorizeAction } from '../src/pep/authorize.js';
import type { PdpClient } from '../src/pep/pdp-client.js';
import { context, T1 } from './helpers/fakes.js';

describe('authorize deny-by-default (P9)', () => {
  it('invalid action does not call PDP', async () => {
    let called = 0;
    const pdp: PdpClient = {
      decide: async () => {
        called += 1;
        return {
          allow: true,
          reason_code: 'ALLOW',
          policy_revision: 'w1',
          decision_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
        };
      },
    };
    const out = await authorizeAction({
      ctx: context(),
      action: 'not-valid',
      resource: {
        resource_type: 'ExampleAggregate',
        tenant_id: T1,
        classification: 'TENANT_SCOPED',
      },
      pdp,
    });
    expect(out.allow).toBe(false);
    expect(out.reason_code).toBe('INPUT_INVALID');
    expect(called).toBe(0);
  });
});
