import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SecretMaterial } from '../src/secrets.js';

describe('SecretMaterial', () => {
  const canary = 'SFCANARY-11111111-1111-4111-8111-111111111111';
  const secret = new SecretMaterial(canary);

  it('redacts JSON inspect and string forms', () => {
    expect(secret.toString()).toBe('[REDACTED]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(inspect(secret)).toContain('[REDACTED]');
    expect(inspect(secret)).not.toContain(canary);
    expect(secret.reveal()).toBe(canary);
  });
});
