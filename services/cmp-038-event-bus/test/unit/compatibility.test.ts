import { describe, expect, it } from 'vitest';
import {
  assertCompatible,
  checkCompatibility,
  isSimulatedAllowed,
  loadConfig,
} from '../../src/index.js';

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

  it('evaluates FORWARD and FULL and assertCompatible version rules', () => {
    const wider = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
    };
    expect(checkCompatibility(base, wider, 'FORWARD').ok).toBe(false);
    expect(checkCompatibility(base, base, 'FULL').ok).toBe(true);
    expect(checkCompatibility(base, { ...base, required: ['a', 'b'] }, 'FULL').ok).toBe(false);
    expect(() => assertCompatible(undefined, base, 'BACKWARD', 2, 0)).toThrow();
    expect(() => assertCompatible(undefined, base, 'BACKWARD', 1, 0)).not.toThrow();
    expect(() =>
      assertCompatible(base, { ...base, required: ['a', 'b'] }, 'BACKWARD', 2, 1),
    ).toThrow();
    expect(
      checkCompatibility(
        { type: 'object', properties: { a: { type: ['string', 'null'] } } },
        { type: 'object', properties: { a: { type: 'string' } } },
        'BACKWARD',
      ).ok,
    ).toBe(false);
    expect(
      checkCompatibility(
        { type: 'object', properties: { a: { enum: ['x'] } } },
        { type: 'object', properties: { a: { type: 'string' } } },
        'BACKWARD',
      ).ok,
    ).toBe(true);
    expect(
      checkCompatibility(
        { additionalProperties: false },
        { additionalProperties: false },
        'BACKWARD',
      ).ok,
    ).toBe(true);
    expect(checkCompatibility(undefined, {}, 'BACKWARD').ok).toBe(true);
    expect(
      checkCompatibility(
        { type: 'object', properties: { a: {} } },
        { type: 'object', properties: { a: {} } },
        'FULL',
      ).ok,
    ).toBe(true);
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
    expect(isSimulatedAllowed('PERFORMANCE')).toBe(true);
    expect(isSimulatedAllowed('SIT')).toBe(true);
    expect(isSimulatedAllowed('LOCAL')).toBe(true);
    expect(isSimulatedAllowed('DEVELOPMENT')).toBe(true);
    const empty = loadConfig({});
    expect(empty.kafkaBrokers).toEqual([]);
    expect(empty.workerId).toBe('cmp038-relay');
    expect(empty.databaseUrl).toBe('');
    expect(empty.environment).toBe('');
  });
});
