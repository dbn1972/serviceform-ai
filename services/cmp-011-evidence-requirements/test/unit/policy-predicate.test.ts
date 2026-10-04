import { describe, expect, it } from 'vitest';
import { sha256Of, canonicalJson } from '../../src/domain/canonical.js';
import {
  parsePolicyDefinition,
  type Predicate,
  type PredicateOp,
  type Scalar,
} from '../../src/domain/policy.js';
import { evaluatePredicate } from '../../src/domain/predicate.js';
import { samplePolicy } from '../fixtures/policy.js';

type Op =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'del'; path: string }
  | { op: 'push'; path: string; value: unknown };

function walkTo(root: unknown, path: string): { parent: Record<string, unknown>; key: string } {
  const parts = path.split('/').filter((x) => x.length > 0);
  let node = root as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
  return { parent: node, key: parts[parts.length - 1] as string };
}

const set = (path: string, value: unknown): Op => ({ op: 'set', path, value });
const del = (path: string): Op => ({ op: 'del', path });
const push = (path: string, value: unknown): Op => ({ op: 'push', path, value });

export function mutate(...ops: Op[]): unknown {
  const root = JSON.parse(JSON.stringify(samplePolicy())) as Record<string, unknown>;
  for (const o of ops) {
    const { parent, key } = walkTo(root, o.path);
    if (o.op === 'set') parent[key] = o.value;
    else if (o.op === 'push') (parent[key] as unknown[]).push(o.value);
    else Reflect.deleteProperty(parent, key);
  }
  return root;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { details?: { code: string }[] }).details?.[0]?.code;
  }
  return undefined;
}

describe('policy definition parser', () => {
  it('accepts the sample metadata and is stable under canonical hashing', () => {
    const parsed = parsePolicyDefinition(samplePolicy());
    expect(parsed.requirements).toHaveLength(3);
    expect(sha256Of(parsed)).toBe(sha256Of(JSON.parse(canonicalJson(parsed))));
    expect(sha256Of(parsed)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  const when = '/requirements/0/exempt_when/0/when';
  const bad: [string, Op[], string][] = [
    ['unknown top-level field', [set('/extra', 1)], 'UNKNOWN_FIELD'],
    ['schema version', [set('/schema_version', 2)], 'SCHEMA_VERSION'],
    ['empty types', [set('/evidence_types', [])], 'EVIDENCE_TYPES'],
    [
      'duplicate type',
      [
        push('/evidence_types', {
          code: 'ID_DOC_A',
          label_key: 'x.y',
          sources: [{ source: 'UPLOAD' }],
        }),
      ],
      'EVIDENCE_TYPE_DUPLICATE',
    ],
    ['bad type code', [set('/evidence_types/0/code', 'lower')], 'INVALID_CODE'],
    ['bad label key', [set('/evidence_types/0/label_key', 'Bad Label')], 'LABEL_KEY'],
    ['no sources', [set('/evidence_types/0/sources', [])], 'SOURCES_INVALID'],
    ['unknown source', [set('/evidence_types/0/sources/0/source', 'FAX')], 'SOURCE_UNKNOWN'],
    [
      'duplicate source',
      [push('/evidence_types/0/sources', { source: 'UPLOAD' })],
      'SOURCE_DUPLICATE',
    ],
    [
      'doc ref on upload',
      [set('/evidence_types/1/sources/0/document_type_ref', 'X')],
      'DOCUMENT_TYPE_REF_SOURCE',
    ],
    [
      'bad doc ref',
      [set('/evidence_types/0/sources/0/document_type_ref', '!!')],
      'DOCUMENT_TYPE_REF',
    ],
    ['bad max age', [set('/evidence_types/2/max_age_days', 0)], 'MAX_AGE_DAYS'],
    ['bad assurance', [set('/evidence_types/0/min_assurance', 'MAX')], 'MIN_ASSURANCE'],
    ['bad reusable', [set('/evidence_types/0/reusable', 'yes')], 'REUSABLE'],
    ['no requirements', [set('/requirements', [])], 'REQUIREMENTS'],
    [
      'duplicate requirement',
      [
        push('/requirements', {
          code: 'REQ_IDENTITY',
          reason_code: 'POLICY_X',
          mandatory: true,
          alternative_sets: [{ code: 'SET_Q', evidence_type_codes: ['ID_DOC_A'] }],
        }),
      ],
      'REQUIREMENT_DUPLICATE',
    ],
    ['mandatory type', [set('/requirements/0/mandatory', 'y')], 'MANDATORY'],
    ['no sets', [set('/requirements/0/alternative_sets', [])], 'ALTERNATIVE_SETS'],
    [
      'empty set',
      [set('/requirements/0/alternative_sets/0/evidence_type_codes', [])],
      'ALTERNATIVE_SET_EMPTY',
    ],
    [
      'unknown type in set',
      [set('/requirements/0/alternative_sets/0/evidence_type_codes', ['NOPE_X'])],
      'EVIDENCE_TYPE_UNKNOWN',
    ],
    [
      'duplicate type in set',
      [
        set('/requirements/1/alternative_sets/1/evidence_type_codes', [
          'PLACE_DOC_Y',
          'PLACE_DOC_Y',
        ]),
      ],
      'EVIDENCE_TYPE_DUPLICATE',
    ],
    [
      'duplicate set',
      [set('/requirements/0/alternative_sets/1/code', 'SET_ID_A')],
      'ALTERNATIVE_SET_DUPLICATE',
    ],
    ['non-object set', [set('/requirements/0/alternative_sets/0', 4)], 'ALTERNATIVE_SET_INVALID'],
    ['exemptions not array', [set('/requirements/0/exempt_when', 'x')], 'EXEMPTIONS_INVALID'],
    ['bad preference', [set('/requirements/0/source_preference', ['FAX'])], 'SOURCE_PREFERENCE'],
    [
      'dup preference',
      [set('/requirements/0/source_preference', ['UPLOAD', 'UPLOAD'])],
      'SOURCE_PREFERENCE',
    ],
    ['bad op', [set(`${when}/op`, 'like')], 'PREDICATE_OP'],
    ['bad ref kind', [set(`${when}/ref/kind`, 'x')], 'PREDICATE_REF_KIND'],
    ['bad ref key', [set(`${when}/ref/key`, 'Bad Key')], 'PREDICATE_REF_KEY'],
    ['missing value', [del(`${when}/value`)], 'PREDICATE_VALUE'],
    ['exists with value', [set(`${when}/op`, 'exists')], 'PREDICATE_VALUE'],
    [
      'in without array',
      [set(when, { ref: { kind: 'fact', key: 'a' }, op: 'in', value: 'x' })],
      'PREDICATE_VALUE',
    ],
    [
      'gt non-number',
      [set(when, { ref: { kind: 'fact', key: 'a' }, op: 'gt', value: 'x' })],
      'PREDICATE_VALUE',
    ],
    ['empty all', [set('/requirements/2/applies_when', { all: [] })], 'PREDICATE_INVALID'],
    ['non-object predicate', [set('/requirements/2/applies_when', 5)], 'PREDICATE_INVALID'],
    [
      'mixed predicate',
      [set('/requirements/2/applies_when', { all: [{ not: 1 }], extra: 1 })],
      'UNKNOWN_FIELD',
    ],
  ];
  for (const [name, ops, expected] of bad) {
    it(`rejects ${name}`, () => {
      expect(codeOf(() => parsePolicyDefinition(mutate(...ops)))).toBe(expected);
    });
  }

  it('rejects non-object policy and over-deep or over-large predicates', () => {
    expect(codeOf(() => parsePolicyDefinition(null))).toBe('POLICY_REQUIRED');
    let deep: unknown = { ref: { kind: 'fact', key: 'a' }, op: 'exists' };
    for (let i = 0; i < 10; i += 1) deep = { not: deep };
    expect(
      codeOf(() => parsePolicyDefinition(mutate(set('/requirements/2/applies_when', deep)))),
    ).toBe('PREDICATE_TOO_DEEP');
    const wide = {
      any: Array.from({ length: 50 }, (_, i) => ({
        ref: { kind: 'fact', key: `k${i}` },
        op: 'exists',
      })),
    };
    const huge = { all: [wide, wide, wide] };
    expect(
      codeOf(() => parsePolicyDefinition(mutate(set('/requirements/2/applies_when', huge)))),
    ).toBe('PREDICATE_TOO_LARGE');
  });
});

describe('predicate evaluation (three-valued)', () => {
  const inputs = {
    facts: { age: 30, name: 'a', flag: true },
    rule_outcomes: { r: 'yes' },
  };
  const f = (key: string, op: PredicateOp, value?: Scalar | Scalar[]): Predicate => ({
    ref: { kind: 'fact', key },
    op,
    ...(value === undefined ? {} : { value }),
  });

  it('evaluates leaves', () => {
    expect(evaluatePredicate(f('age', 'gte', 30), inputs).result).toBe('TRUE');
    expect(evaluatePredicate(f('age', 'gt', 30), inputs).result).toBe('FALSE');
    expect(evaluatePredicate(f('age', 'lt', 31), inputs).result).toBe('TRUE');
    expect(evaluatePredicate(f('age', 'lte', 29), inputs).result).toBe('FALSE');
    expect(evaluatePredicate(f('name', 'eq', 'a'), inputs).result).toBe('TRUE');
    expect(evaluatePredicate(f('name', 'neq', 'a'), inputs).result).toBe('FALSE');
    expect(evaluatePredicate(f('name', 'in', ['a', 'b']), inputs).result).toBe('TRUE');
    expect(evaluatePredicate(f('missing', 'exists'), inputs).result).toBe('FALSE');
    expect(evaluatePredicate(f('flag', 'exists'), inputs).result).toBe('TRUE');
    expect(
      evaluatePredicate({ ref: { kind: 'rule_outcome', key: 'r' }, op: 'eq', value: 'yes' }, inputs)
        .result,
    ).toBe('TRUE');
  });

  it('treats missing or mistyped inputs as UNKNOWN, never as false', () => {
    const missing = evaluatePredicate(f('missing', 'eq', 1), inputs);
    expect(missing.result).toBe('UNKNOWN');
    expect(missing.unresolved).toEqual(['fact:missing']);
    expect(evaluatePredicate(f('name', 'gt', 1), inputs).result).toBe('UNKNOWN');
  });

  it('combines with Kleene logic', () => {
    const t = f('age', 'eq', 30);
    const u = f('missing', 'eq', 1);
    const x = f('age', 'eq', 1);
    expect(evaluatePredicate({ all: [t, u] }, inputs).result).toBe('UNKNOWN');
    expect(evaluatePredicate({ all: [x, u] }, inputs).result).toBe('FALSE');
    expect(evaluatePredicate({ any: [t, u] }, inputs).result).toBe('TRUE');
    expect(evaluatePredicate({ any: [x, u] }, inputs).result).toBe('UNKNOWN');
    expect(evaluatePredicate({ any: [x] }, inputs).result).toBe('FALSE');
    expect(evaluatePredicate({ not: u }, inputs).result).toBe('UNKNOWN');
    expect(evaluatePredicate({ not: t }, inputs).result).toBe('FALSE');
    expect(evaluatePredicate({ not: x }, inputs).result).toBe('TRUE');
  });

  it('does not read prototype properties', () => {
    expect(evaluatePredicate(f('constructor', 'exists'), inputs).result).toBe('FALSE');
  });
});
