import { describe, expect, it } from 'vitest';
import { Cmp050Error } from '../../src/errors.js';
import { makerCheckerUx, assertCheckerIsNotMaker } from '../../src/maker-checker-ux.js';
import { sessionFromLogin } from '../../src/session.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const maker = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const checker = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('maker-checker UX (engine remains CMP-051)', () => {
  const request = {
    request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'SUBMITTED' as const,
    maker_principal_id: maker,
  };

  it('blocks the maker from approve/reject', () => {
    const session = sessionFromLogin({
      tenant_id: tenant,
      actor_id: maker,
      roles: ['STUDIO_DESIGNER', 'STUDIO_CHECKER'],
      surface: 'service_studio',
    });
    const ux = makerCheckerUx(session, request);
    expect(ux.canApprove).toBe(false);
    expect(ux.canReject).toBe(false);
    expect(ux.reason).toBe('MAKER_CANNOT_CHECK');
    expect(() => assertCheckerIsNotMaker(session, request)).toThrow(Cmp050Error);
  });

  it('allows a different checker principal', () => {
    const session = sessionFromLogin({
      tenant_id: tenant,
      actor_id: checker,
      roles: ['STUDIO_CHECKER'],
      surface: 'service_studio',
    });
    const ux = makerCheckerUx(session, request);
    expect(ux.canApprove).toBe(true);
    expect(ux.canReject).toBe(true);
  });

  it('lets the maker submit a draft', () => {
    const session = sessionFromLogin({
      tenant_id: tenant,
      actor_id: maker,
      roles: ['STUDIO_DESIGNER'],
      surface: 'service_studio',
    });
    const ux = makerCheckerUx(session, {
      request_id: request.request_id,
      status: 'DRAFT',
      maker_principal_id: maker,
    });
    expect(ux.canSubmit).toBe(true);
    expect(ux.canApprove).toBe(false);
  });
});
