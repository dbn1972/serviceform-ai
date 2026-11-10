/**
 * Author-time mirror of the CMP-009 bounded `pattern` subset: anchored sequences of character
 * classes, `\d` and literals with `{n}`, `{n,m}` (<= 64) or `?`. CMP-009 stays authoritative and
 * refuses anything else when the form is parsed; `test/` in CMP-009 checks the two agree.
 */

interface Range {
  lo: number;
  hi: number;
}

interface Token {
  ranges: Range[];
  min: number;
  max: number;
}

const MAX_PATTERN_LENGTH = 128;
const MAX_TOKENS = 32;
const MAX_REPEAT = 64;
const LITERAL = /^[A-Za-z0-9 _/-]$/;
const ESCAPABLE = new Set(['.', '-', '/', ' ', '_']);
const CLASS_CHAR = /^[A-Za-z0-9 _./-]$/;
const COUNT = /^[0-9]{1,2}$/;
const ALNUM = /^[A-Za-z0-9]$/;

const cp = (c: string): number => c.codePointAt(0) ?? -1;
const one = (c: string): Range => ({ lo: cp(c), hi: cp(c) });

function parseClass(src: string, start: number): { ranges: Range[]; next: number } | null {
  const ranges: Range[] = [];
  let i = start;
  if (src[i] === '^' || src[i] === ']') return null;
  while (i < src.length && src[i] !== ']') {
    let c = src[i] ?? '';
    if (c === '\\') {
      const e = src[i + 1] ?? '';
      if (!ESCAPABLE.has(e)) return null;
      c = e;
      i += 1;
    } else if (!CLASS_CHAR.test(c)) {
      return null;
    }
    if (src[i + 1] === '-' && src[i + 2] !== undefined && src[i + 2] !== ']') {
      const hi = src[i + 2] ?? '';
      if (!ALNUM.test(c) || !ALNUM.test(hi) || cp(hi) < cp(c)) return null;
      ranges.push({ lo: cp(c), hi: cp(hi) });
      i += 3;
      continue;
    }
    ranges.push(one(c));
    i += 1;
  }
  if (src[i] !== ']' || ranges.length === 0) return null;
  return { ranges, next: i + 1 };
}

function parseQuantifier(src: string, start: number): { min: number; max: number; next: number } {
  const c = src[start];
  if (c === '?') return { min: 0, max: 1, next: start + 1 };
  if (c !== '{') return { min: 1, max: 1, next: start };
  const close = src.indexOf('}', start);
  if (close < 0) throw new Error('quantifier');
  const parts = src.slice(start + 1, close).split(',');
  if (parts.length > 2 || !parts.every((p) => COUNT.test(p))) throw new Error('quantifier');
  const min = Number(parts[0]);
  const max = parts.length === 2 ? Number(parts[1]) : min;
  if (max < min || max > MAX_REPEAT || max === 0) throw new Error('quantifier');
  return { min, max, next: close + 1 };
}

function compile(src: string): Token[] | null {
  if (src.length < 3 || src.length > MAX_PATTERN_LENGTH) return null;
  if (!src.startsWith('^') || !src.endsWith('$') || src.endsWith('\\$')) return null;
  const body = src.slice(1, -1);
  const tokens: Token[] = [];
  let i = 0;
  try {
    while (i < body.length) {
      const c = body[i] ?? '';
      let ranges: Range[];
      if (c === '[') {
        const cls = parseClass(body, i + 1);
        if (!cls) return null;
        ranges = cls.ranges;
        i = cls.next;
      } else if (c === '\\') {
        const e = body[i + 1] ?? '';
        if (e === 'd') ranges = [{ lo: cp('0'), hi: cp('9') }];
        else if (ESCAPABLE.has(e)) ranges = [one(e)];
        else return null;
        i += 2;
      } else if (LITERAL.test(c)) {
        ranges = [one(c)];
        i += 1;
      } else {
        return null;
      }
      const q = parseQuantifier(body, i);
      i = q.next;
      tokens.push({ ranges, min: q.min, max: q.max });
      if (tokens.length > MAX_TOKENS) return null;
    }
  } catch {
    return null;
  }
  return tokens.length > 0 ? tokens : null;
}

export function isSupportedPattern(src: string): boolean {
  return compile(src) !== null;
}

/** Same position-set walk as CMP-009; false for unsupported patterns. */
export function matchesPattern(src: string, value: string): boolean {
  const tokens = compile(src);
  if (!tokens) return false;
  const chars = Array.from(value, cp);
  let positions = new Set<number>([0]);
  for (const t of tokens) {
    const next = new Set<number>();
    for (const start of positions) {
      for (let k = 0; k <= t.max; k += 1) {
        if (k >= t.min) next.add(start + k);
        const code = chars[start + k];
        if (code === undefined || !t.ranges.some((r) => code >= r.lo && code <= r.hi)) break;
      }
    }
    if (next.size === 0) return false;
    positions = next;
  }
  return positions.has(chars.length);
}

export type PatternPresetId = 'digits' | 'upper_alnum' | 'letters_spaces';

export interface PatternPreset {
  id: PatternPresetId;
  label: string;
  charClass: string;
}

/** Plain-language builders that only ever produce supported patterns. */
export const PATTERN_PRESETS: readonly PatternPreset[] = [
  { id: 'digits', label: 'Digits only', charClass: '[0-9]' },
  { id: 'upper_alnum', label: 'Capital letters and digits', charClass: '[A-Z0-9]' },
  { id: 'letters_spaces', label: 'Letters and spaces', charClass: '[A-Za-z ]' },
];

export function buildPattern(preset: PatternPresetId, min: number, max: number): string | null {
  const p = PATTERN_PRESETS.find((x) => x.id === preset);
  if (!p) return null;
  const lo = Math.trunc(min);
  const hi = Math.trunc(max);
  if (lo < 1 || hi < lo || hi > MAX_REPEAT) return null;
  const src = lo === hi ? `^${p.charClass}{${lo}}$` : `^${p.charClass}{${lo},${hi}}$`;
  return isSupportedPattern(src) ? src : null;
}

/** Recognises a pattern produced by `buildPattern` so the inspector can show the builder. */
export function describePattern(
  src: string,
): { preset: PatternPresetId; min: number; max: number } | null {
  for (const p of PATTERN_PRESETS) {
    const prefix = `^${p.charClass}{`;
    if (!src.startsWith(prefix) || !src.endsWith('}$')) continue;
    const parts = src.slice(prefix.length, -2).split(',');
    if (parts.length > 2 || !parts.every((x) => COUNT.test(x))) continue;
    const min = Number(parts[0]);
    const max = parts.length === 2 ? Number(parts[1]) : min;
    return { preset: p.id, min, max };
  }
  return null;
}
