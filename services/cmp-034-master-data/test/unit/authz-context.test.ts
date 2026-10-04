import { describe, expect, it } from 'vitest';
import { authorize } from '../../src/authz.js';
import { Cmp034Error } from '../../src/errors.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';

const input = {
  subject: {
    user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actor_type: 'OFFICER' as const,
    tenant_id: '11111111-1111-4111-8111-111111111111',
    roles: ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
  },
  resource: {
    resource_type: 'CodeSet',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    classification: 'TENANT_SCOPED' as const,
  },
  action: 'CODE_SET_READ',
};

describe('authorize fail-closed', () => {
  it('denies when PDP throws or returns allow=false', async () => {
    const port = new ContractAuthorizer();
    port.throws = true;
    await expect(authorize(port, input)).rejects.toBeInstanceOf(Cmp034Error);
    port.throws = false;
    port.denies.add('CODE_SET_READ');
    await expect(authorize(port, input)).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('denies subject/resource tenant mismatch before PDP', async () => {
    const port = new ContractAuthorizer();
    await expect(
      authorize(port, {
        ...input,
        resource: {
          ...input.resource,
          tenant_id: '22222222-2222-4222-8222-222222222222',
        },
      }),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });
});
