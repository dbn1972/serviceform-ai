import { afterEach, describe, expect, it } from 'vitest';
import { observedClientAddress } from '../lib/portal/platform';

describe('observedClientAddress (ADR-0008)', () => {
  const prior = process.env['SF_BFF_TRUST_INGRESS'];
  afterEach(() => {
    if (prior === undefined) delete process.env['SF_BFF_TRUST_INGRESS'];
    else process.env['SF_BFF_TRUST_INGRESS'] = prior;
  });

  it('prefers X-Real-IP when present', () => {
    const request = new Request('http://portal.test/api/portal/otp/challenges', {
      headers: {
        'x-real-ip': '203.0.113.9',
        'x-forwarded-for': '198.51.100.1, 203.0.113.9',
      },
    });
    expect(observedClientAddress(request)).toBe('203.0.113.9');
  });

  it('uses the nearest hop by default and the leftmost hop when ingress is trusted', () => {
    const request = new Request('http://portal.test/api/portal/otp/challenges', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.5' },
    });
    delete process.env['SF_BFF_TRUST_INGRESS'];
    expect(observedClientAddress(request)).toBe('10.0.0.5');
    process.env['SF_BFF_TRUST_INGRESS'] = '1';
    expect(observedClientAddress(request)).toBe('203.0.113.10');
  });

  it('returns undefined when no usable address is present', () => {
    expect(observedClientAddress(new Request('http://portal.test/'))).toBeUndefined();
    expect(
      observedClientAddress(
        new Request('http://portal.test/', { headers: { 'x-forwarded-for': 'not-an-ip' } }),
      ),
    ).toBeUndefined();
  });
});
