import { describe, expect, it } from 'vitest';
import { checkCompatibility } from '../../src/registry/compatibility.js';
import { isSimulatedAllowed, loadConfig } from '../../src/config.js';

describe('schema compatibility (U7)', () => {
  const base = {
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a'],
    additionalProperties: true,
  };

  it('accepts an additive optional field under BACKWARD', () => {
    const next = {
      ...base,
      properties: { ...base.properties, b: { type: 'string' } },
    };
    expect(checkCompatibility(base, next, 'BACKWARD').ok).toBe(true);
  });

  it('refuses new required properties, removals, type changes, enum narrowing, additionalProperties', () => {
    expect(checkCompatibility(base, { ...base, required: ['a', 'b'] }, 'BACKWARD').ok).toBe(false);
    expect(
      checkCompatibility(base, { type: 'object', properties: {}, required: [] }, 'BACKWARD').ok,
    ).toBe(false);
    expect(
      checkCompatibility(base, { ...base, properties: { a: { type: 'number' } } }, 'BACKWARD').ok,
    ).toBe(false);
    expect(
      checkCompatibility(
        {
          type: 'object',
          properties: { a: { type: 'string', enum: ['x', 'y'] } },
        },
        {
          type: 'object',
          properties: { a: { type: 'string', enum: ['x'] } },
        },
        'BACKWARD',
      ).ok,
    ).toBe(false);
    expect(checkCompatibility(base, { ...base, additionalProperties: false }, 'BACKWARD').ok).toBe(
      false,
    );
  });
});

describe('config (U9)', () => {
  it('loads brokers and refuses non-allowlisted simulated environments', () => {
    const cfg = loadConfig({
      SF_ENVIRONMENT: 'CI',
      SF_KAFKA_BROKERS: '127.0.0.1:19092',
      DATABASE_URL: 'postgres://x',
    });
    expect(cfg.kafkaBrokers).toEqual(['127.0.0.1:19092']);
    expect(isSimulatedAllowed('CI')).toBe(true);
    expect(isSimulatedAllowed('PRODUCTION')).toBe(false);
    expect(isSimulatedAllowed('')).toBe(false);
  });
});
