import { describe, expect, it } from 'vitest';
import { makerCheckerUx } from '../lib/designer';

describe('maker-checker UX (P8-5 / CMP-051)', () => {
  const maker = '11111111-1111-4111-8111-111111111111';
  const checker = '22222222-2222-4222-8222-222222222222';

  it('blocks same principal from approve/reject on SUBMITTED', () => {
    const ux = makerCheckerUx(maker, maker, 'SUBMITTED', ['TENANT_ADMIN']);
    expect(ux.canApprove).toBe(false);
    expect(ux.canReject).toBe(false);
    expect(ux.isMaker).toBe(true);
    expect(ux.blockReason).toBe('SAME_PRINCIPAL');
    expect(ux.blockMessage).toContain('Maker cannot approve');
  });

  it('allows a different checker principal', () => {
    const ux = makerCheckerUx(checker, maker, 'SUBMITTED', ['STUDIO_CHECKER']);
    expect(ux.canApprove).toBe(true);
    expect(ux.canReject).toBe(true);
    expect(ux.blockReason).toBeNull();
    expect(ux.blockMessage).toBeNull();
  });

  it('refuses checker action without checker role', () => {
    const ux = makerCheckerUx(checker, maker, 'SUBMITTED', ['STUDIO_DESIGNER']);
    expect(ux.canApprove).toBe(false);
    expect(ux.blockReason).toBe('MISSING_CHECKER_ROLE');
  });

  it('allows maker to submit DRAFT when they hold maker role', () => {
    const ux = makerCheckerUx(maker, maker, 'DRAFT', ['STUDIO_DESIGNER']);
    expect(ux.canSubmit).toBe(true);
    expect(ux.canApprove).toBe(false);
  });
});
