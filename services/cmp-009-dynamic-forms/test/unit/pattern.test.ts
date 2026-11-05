import { describe, expect, it } from 'vitest';
import { authzInput } from '../../src/authz.js';
import { compilePattern, matchesPattern } from '../../src/domain/pattern.js';
import { parseJsonSchema, validateAgainstSchema } from '../../src/domain/schema.js';
import { Cmp009Error } from '../../src/errors.js';

// REQ: CMP-009 server-side authoritative validation; CodeQL js/polynomial-redos (no RegExp engine).
describe('bounded pattern subset', () => {
  it.each([
    ['^[0-9]{6}$', '751001', true],
    ['^[0-9]{6}$', '75100', false],
    ['^[0-9]{6}$', '7510011', false],
    ['^[0-9]{6}$', '75100a', false],
    ['^[0-9]{4}-[0-9]{2}$', '2025-26', true],
    ['^[0-9]{4}-[0-9]{2}$', '2025/26', false],
    ['^\\d{10}$', '9876543210', true],
    ['^[A-Z]{2}[0-9]{0,4}$', 'OD', true],
    ['^[A-Z]{2}[0-9]{1,4}$', 'OD12345', false],
    ['^[A-Za-z0-9_\\-]{3,8}$', 'ab_-9', true],
    ['^[A-Z]?[0-9]{2}$', '07', true],
    ['^[A-Z]?[0-9]{2}$', 'X07', true],
  ])('%s against %s → %s', (pattern, value, ok) => {
    expect(matchesPattern(pattern, value)).toBe(ok);
  });

  it.each([
    '[0-9]{6}',
    '^[0-9]{6}',
    '^(a|b)$',
    '^.+$',
    '^[0-9]+$',
    '^[0-9]*$',
    '^[^0-9]{2}$',
    '^[0-9]{65}$',
    '^[0-9]{3,2}$',
    '^[0-9]{1,4}?$',
    '^\\w{3}$',
    '^(?=a)a$',
    `^${'a'.repeat(200)}$`,
    `^${'[0-9]'.repeat(33)}$`,
  ])('refuses %s outside the subset', (pattern) => {
    expect(compilePattern(pattern)).toBeNull();
    expect(() => parseJsonSchema({ type: 'string', pattern })).toThrow(Cmp009Error);
  });

  it('stays linear on long hostile input', () => {
    const start = performance.now();
    expect(matchesPattern(`^${'[0-9]{1,64}'.repeat(32)}$`, `${'1'.repeat(5000)}x`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('reports PATTERN at the field pointer', () => {
    const schema = parseJsonSchema({
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: { pincode: { type: 'string', pattern: '^[0-9]{6}$' } },
        },
      },
    });
    expect(validateAgainstSchema(schema, { address: { pincode: '12' } })).toEqual([
      { code: 'PATTERN', pointer: '/address/pincode' },
    ]);
    expect(validateAgainstSchema(schema, { address: { pincode: '123456' } })).toEqual([]);
  });
});

describe('execution ownership on the authorization input', () => {
  const ctx = {
    tenant_id: '11111111-1111-4111-8111-111111111111',
    actor: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'CITIZEN' as const },
    roles: [],
    jurisdiction_ids: [],
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    cell_id: 'cell-01',
  };

  it('names the requester as owner only when the caller passes one', () => {
    expect(
      authzInput(ctx, 'FORM_EXECUTION_EXECUTE', 'FormExecution', ctx.actor.id).resource,
    ).toMatchObject({ owner_id: ctx.actor.id, tenant_id: ctx.tenant_id });
    expect(authzInput(ctx, 'FORM_INTERPRET', 'FormDefinition').resource).not.toHaveProperty(
      'owner_id',
    );
  });
});
