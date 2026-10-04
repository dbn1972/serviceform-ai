import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SecretValue } from '../src/secrets/secret-value.js';

const CANARY = 's3cr3t-canary-value-not-for-logs';

describe('SecretValue redaction (002-27, 002-30)', () => {
  it('never leaks via String/JSON/inspect/template', () => {
    const s = SecretValue.fromString(CANARY);
    expect(String(s)).toBe('[REDACTED]');
    expect(`${s}`).toBe('[REDACTED]');
    expect(JSON.stringify({ s })).toBe('{"s":"[REDACTED]"}');
    expect(inspect(s)).toContain('[REDACTED]');
    expect(inspect(s)).not.toContain(CANARY);
    expect(s.revealText()).toBe(CANARY);
    s.dispose();
    expect(() => s.reveal()).toThrow(/disposed/);
  });
});
