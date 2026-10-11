import { describe, expect, it } from 'vitest';
import {
  isValidReasonCode,
  isValidSignalCode,
  namesBindingOutcome,
} from '../../src/domain/guard.js';
import { parseGatewayOutput } from '../../src/domain/parse-output.js';
import { canTransition, RECOMMENDATION_STATUSES } from '../../src/domain/states.js';
import { isUuid } from '../../src/domain/uuid.js';
import { canonicalJson, requestFingerprint } from '../../src/domain/fingerprint.js';

describe('decision-boundary guard', () => {
  it('flags codes that name a statutory, fee, payment or case outcome', () => {
    for (const code of [
      'ELIGIBLE_FOR_SERVICE',
      'APPROVED',
      'REJECTED_BEFORE',
      'PENALTY_APPLIES',
      'ENTITLEMENT_MATCH',
      'FEE_WAIVER',
      'PAYMENT_DUE',
      'CASE_STATE_OPEN',
      'GRANT_LIKELY',
    ]) {
      expect(namesBindingOutcome(code)).toBe(true);
      expect(isValidReasonCode(code)).toBe(false);
    }
  });

  it('accepts neutral relevance codes and refuses malformed ones', () => {
    for (const code of ['CATEGORY_MATCH', 'JURISDICTION_MATCH', 'POPULAR_FOR_PROFILE']) {
      expect(isValidReasonCode(code)).toBe(true);
      expect(isValidSignalCode(code)).toBe(true);
    }
    for (const code of ['lower', 'A', 'HAS SPACE', 'X'.repeat(65)]) {
      expect(isValidReasonCode(code)).toBe(false);
    }
  });
});

describe('gateway output parser', () => {
  const params = {
    aliases: ['c1', 'c2'],
    allowedReasonCodes: ['CATEGORY_MATCH', 'JURISDICTION_MATCH'],
    maxResults: 2,
  };
  const run = (value: unknown) =>
    parseGatewayOutput(typeof value === 'string' ? value : JSON.stringify(value), params);

  it('accepts the closed shape', () => {
    expect(run({ items: [{ candidate: 'c2', reason_codes: ['CATEGORY_MATCH'] }] })).toEqual({
      ok: true,
      items: [{ alias: 'c2', reason_codes: ['CATEGORY_MATCH'] }],
    });
  });

  it('refuses malformed, extended, duplicated, over-long or unpinned output', () => {
    expect(run('not json')).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
    expect(run([])).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
    expect(run({ items: [] })).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
    expect(run({ items: [], verdict: 'APPROVED' })).toMatchObject({
      ok: false,
      code: 'UNSAFE_OUTPUT',
    });
    expect(run({ items: ['x'] })).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
    expect(
      run({ items: [{ candidate: 'c1', reason_codes: ['CATEGORY_MATCH'], note: 'x' }] }),
    ).toMatchObject({ ok: false, code: 'UNSAFE_OUTPUT' });
    expect(
      run({
        items: [
          { candidate: 'c1', reason_codes: ['CATEGORY_MATCH'] },
          { candidate: 'c1', reason_codes: ['CATEGORY_MATCH'] },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'UNSAFE_OUTPUT' });
    expect(
      run({
        items: [
          { candidate: 'c1', reason_codes: ['CATEGORY_MATCH'] },
          { candidate: 'c2', reason_codes: ['CATEGORY_MATCH'] },
          { candidate: 'c1', reason_codes: ['CATEGORY_MATCH'] },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'UNSAFE_OUTPUT' });
    expect(run({ items: [{ candidate: 'c1', reason_codes: [] }] })).toMatchObject({
      ok: false,
      code: 'MALFORMED_OUTPUT',
    });
    expect(
      run({ items: [{ candidate: 'c1', reason_codes: ['CATEGORY_MATCH', 'CATEGORY_MATCH'] }] }),
    ).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
    expect(run({ items: [{ candidate: 'c1', reason_codes: ['OTHER'] }] })).toMatchObject({
      ok: false,
      code: 'UNSAFE_OUTPUT',
    });
    expect(run({ items: [{ candidate: 'c1', reason_codes: [1] }] })).toMatchObject({
      ok: false,
      code: 'UNSAFE_OUTPUT',
    });
  });

  it('refuses any assertion that the output is authoritative', () => {
    const item = { candidate: 'c1', reason_codes: ['CATEGORY_MATCH'] };
    expect(run({ items: [item], advisory_only: false })).toMatchObject({ ok: false });
    expect(run({ items: [item], statutory_decision: true })).toMatchObject({ ok: false });
    expect(run({ items: [item], advisory_only: true, statutory_decision: false })).toMatchObject({
      ok: true,
    });
  });

  it('refuses allowed reason codes that name a binding outcome even if pinned', () => {
    const res = parseGatewayOutput(
      JSON.stringify({ items: [{ candidate: 'c1', reason_codes: ['ELIGIBLE_X'] }] }),
      { ...params, allowedReasonCodes: ['ELIGIBLE_X'] },
    );
    expect(res).toMatchObject({ ok: false, code: 'UNSAFE_OUTPUT' });
  });
});

describe('state machine and helpers', () => {
  it('only moves REQUESTED -> GENERATED|FAILED and GENERATED -> SELECTED|DISMISSED', () => {
    const allowed = new Set([
      'REQUESTED>GENERATED',
      'REQUESTED>FAILED',
      'GENERATED>SELECTED',
      'GENERATED>DISMISSED',
    ]);
    for (const from of RECOMMENDATION_STATUSES) {
      for (const to of RECOMMENDATION_STATUSES) {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it('validates uuids and fingerprints deterministically', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('nope')).toBe(false);
    expect(isUuid('1111111-11111-4111-8111-111111111111')).toBe(false);
    expect(isUuid('zzzzzzzz-1111-4111-8111-111111111111')).toBe(false);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(requestFingerprint('post', '/x', { b: 1, a: 2 })).toBe(
      requestFingerprint('POST', '/x', { a: 2, b: 1 }),
    );
  });
});
