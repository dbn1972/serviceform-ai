import type { Predicate, PredicateRef, Scalar } from './policy.js';

export type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';

export interface PredicateInputs {
  facts: Readonly<Record<string, Scalar>>;
  rule_outcomes: Readonly<Record<string, Scalar>>;
}

export interface PredicateEvaluation {
  result: Tri;
  referenced: string[];
  unresolved: string[];
}

function refLabel(ref: PredicateRef): string {
  return `${ref.kind}:${ref.key}`;
}

function lookup(ref: PredicateRef, inputs: PredicateInputs): Scalar | undefined {
  const source = ref.kind === 'fact' ? inputs.facts : inputs.rule_outcomes;
  return Object.prototype.hasOwnProperty.call(source, ref.key) ? source[ref.key] : undefined;
}

function compare(op: string, actual: Scalar, expected: Scalar | Scalar[] | undefined): Tri {
  if (op === 'eq') return actual === expected ? 'TRUE' : 'FALSE';
  if (op === 'neq') return actual !== expected ? 'TRUE' : 'FALSE';
  if (op === 'in') return (expected as Scalar[]).includes(actual) ? 'TRUE' : 'FALSE';
  if (typeof actual !== 'number' || typeof expected !== 'number') return 'UNKNOWN';
  if (op === 'gt') return actual > expected ? 'TRUE' : 'FALSE';
  if (op === 'gte') return actual >= expected ? 'TRUE' : 'FALSE';
  if (op === 'lt') return actual < expected ? 'TRUE' : 'FALSE';
  return actual <= expected ? 'TRUE' : 'FALSE';
}

function walk(
  predicate: Predicate,
  inputs: PredicateInputs,
  referenced: Set<string>,
  unresolved: Set<string>,
): Tri {
  if ('all' in predicate) {
    const results = predicate.all.map((p) => walk(p, inputs, referenced, unresolved));
    if (results.includes('FALSE')) return 'FALSE';
    return results.includes('UNKNOWN') ? 'UNKNOWN' : 'TRUE';
  }
  if ('any' in predicate) {
    const results = predicate.any.map((p) => walk(p, inputs, referenced, unresolved));
    if (results.includes('TRUE')) return 'TRUE';
    return results.includes('UNKNOWN') ? 'UNKNOWN' : 'FALSE';
  }
  if ('not' in predicate) {
    const inner = walk(predicate.not, inputs, referenced, unresolved);
    if (inner === 'UNKNOWN') return 'UNKNOWN';
    return inner === 'TRUE' ? 'FALSE' : 'TRUE';
  }
  const label = refLabel(predicate.ref);
  referenced.add(label);
  const actual = lookup(predicate.ref, inputs);
  if (predicate.op === 'exists') return actual === undefined ? 'FALSE' : 'TRUE';
  if (actual === undefined) {
    unresolved.add(label);
    return 'UNKNOWN';
  }
  const result = compare(predicate.op, actual, predicate.value);
  if (result === 'UNKNOWN') unresolved.add(label);
  return result;
}

export function evaluatePredicate(
  predicate: Predicate,
  inputs: PredicateInputs,
): PredicateEvaluation {
  const referenced = new Set<string>();
  const unresolved = new Set<string>();
  const result = walk(predicate, inputs, referenced, unresolved);
  return {
    result,
    referenced: [...referenced].sort(),
    unresolved: [...unresolved].sort(),
  };
}
