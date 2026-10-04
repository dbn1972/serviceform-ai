export type RedactionCategory =
  | 'PRIVATE_KEY'
  | 'JWT'
  | 'CLOUD_ACCESS_KEY'
  | 'BEARER_TOKEN'
  | 'CREDENTIAL'
  | 'URL_CREDENTIAL'
  | 'PAYMENT_CARD'
  | 'NATIONAL_ID'
  | 'TAX_ID'
  | 'EMAIL'
  | 'PHONE';

export type RedactionSummary = Partial<Record<RedactionCategory, number>>;

export interface RedactionResult {
  text: string;
  summary: RedactionSummary;
  total: number;
}

interface Rule {
  category: RedactionCategory;
  pattern: RegExp;
  /** Custom span handler for rules that need more than a whole-match replacement. */
  scan?: (match: string) => { text: string; count: number };
}

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * A digit/space/dash run may hold a payment card anywhere inside it. Every 13-19 digit window with
 * a valid Luhn checksum is replaced, longest first.
 */
function redactCards(run: string): { text: string; count: number } {
  const positions: number[] = [];
  for (let i = 0; i < run.length; i += 1) {
    const code = run.charCodeAt(i);
    if (code >= 48 && code <= 57) positions.push(i);
  }
  let out = '';
  let cursor = 0;
  let count = 0;
  let start = 0;
  while (start < positions.length) {
    let matched = 0;
    for (let len = Math.min(19, positions.length - start); len >= 13; len -= 1) {
      const from = positions[start] as number;
      const to = (positions[start + len - 1] as number) + 1;
      if (luhnValid(run.slice(from, to))) {
        matched = len;
        out += run.slice(cursor, from) + '[REDACTED:PAYMENT_CARD]';
        cursor = to;
        count += 1;
        break;
      }
    }
    start += matched > 0 ? matched : 1;
  }
  return { text: out + run.slice(cursor), count };
}

// Every pattern is length-bounded and free of nested quantifiers (linear-time matching).
const RULES: readonly Rule[] = [
  {
    category: 'PRIVATE_KEY',
    pattern:
      /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z ]{0,30}PRIVATE KEY-----/g,
  },
  { category: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----/g },
  {
    category: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{0,2048}/g,
  },
  { category: 'CLOUD_ACCESS_KEY', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { category: 'BEARER_TOKEN', pattern: /\bBearer[ \t]{1,4}[A-Za-z0-9._~+/=-]{8,2048}/gi },
  {
    category: 'CREDENTIAL',
    pattern:
      /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization)\b[ \t]{0,3}[:=][ \t]{0,3}[^\s,;]{1,256}/gi,
  },
  {
    category: 'URL_CREDENTIAL',
    pattern: /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s:/@]{1,128}:[^\s@/]{1,128}@/gi,
  },
  {
    category: 'PAYMENT_CARD',
    pattern: /(?<![0-9])[0-9][0-9 -]{11,30}[0-9](?![0-9])/g,
    scan: redactCards,
  },
  {
    category: 'NATIONAL_ID',
    pattern: /(?<![0-9])[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/g,
  },
  { category: 'TAX_ID', pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  {
    category: 'EMAIL',
    pattern: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}\.[A-Za-z0-9.-]{0,188}[A-Za-z0-9]/g,
  },
  { category: 'PHONE', pattern: /(?<![0-9])\+[0-9]{1,3}[ -]?[0-9]{6,12}(?![0-9])/g },
  { category: 'PHONE', pattern: /(?<![0-9])[6-9][0-9]{9}(?![0-9])/g },
];

/**
 * Replaces PII and credential-shaped content with `[REDACTED:<CATEGORY>]`. Only counts per category
 * are returned; matched values are never retained.
 */
export function redactText(input: string): RedactionResult {
  let text = input;
  const summary: RedactionSummary = {};
  let total = 0;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match) => {
      if (rule.scan) {
        const scanned = rule.scan(match);
        if (scanned.count > 0) {
          summary[rule.category] = (summary[rule.category] ?? 0) + scanned.count;
          total += scanned.count;
        }
        return scanned.text;
      }
      summary[rule.category] = (summary[rule.category] ?? 0) + 1;
      total += 1;
      return `[REDACTED:${rule.category}]`;
    });
  }
  return { text, summary, total };
}

export function containsSensitive(input: string): boolean {
  return redactText(input).total > 0;
}

export function mergeSummaries(...parts: RedactionSummary[]): RedactionSummary {
  const out: RedactionSummary = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part) as [RedactionCategory, number][]) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}
