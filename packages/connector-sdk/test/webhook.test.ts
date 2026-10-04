import { describe, expect, it } from 'vitest';
import { SecretMaterial } from '../src/secrets.js';
import { signWebhook, verifyWebhookSignature } from '../src/webhook.js';

describe('webhook hmac', () => {
  const secret = new SecretMaterial('unit-test-secret');
  const body = new TextEncoder().encode('{"provider_reference":"p1"}');

  it('accepts a valid signature and rejects tamper, stale, missing and truncated', () => {
    const ts = 1_700_000_000;
    const sig = signWebhook(body, secret, ts);
    const headers = { 'x-sf-signature': sig, 'x-sf-timestamp': String(ts) };
    expect(verifyWebhookSignature(body, headers, secret, ts)).toBe(true);
    expect(verifyWebhookSignature(body, { ...headers, 'x-sf-signature': 'aa' }, secret, ts)).toBe(
      false,
    );
    expect(verifyWebhookSignature(body, { 'x-sf-timestamp': String(ts) }, secret, ts)).toBe(false);
    expect(verifyWebhookSignature(body, headers, secret, ts + 301)).toBe(false);
    const tampered = new TextEncoder().encode('{"provider_reference":"p2"}');
    expect(verifyWebhookSignature(tampered, headers, secret, ts)).toBe(false);
    expect(
      verifyWebhookSignature(body, { ...headers, 'x-sf-signature': [sig, sig] }, secret, ts),
    ).toBe(false);
  });
});
