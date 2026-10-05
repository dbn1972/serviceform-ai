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
}

const RULES: readonly Rule[] = [
  {
    category: 'PRIVATE_KEY',
    pattern:
      /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z ]{0,30}PRIVATE KEY-----/g,
  },
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
    pattern: /[a-z][a-z0-9+.-]{1,15}:\/\/[^\s:/@]{1,128}:[^\s@/]{1,128}@/gi,
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

/** Classify/redact locally before any CMP-039 invoke. Counts only; matched values are discarded. */
export function redactText(input: string): RedactionResult {
  let text = input;
  const summary: RedactionSummary = {};
  let total = 0;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, () => {
      summary[rule.category] = (summary[rule.category] ?? 0) + 1;
      total += 1;
      return `[REDACTED:${rule.category}]`;
    });
  }
  return { text, summary, total };
}

const ALLOWED_LOG_KEYS = new Set([
  'job_id',
  'status',
  'reason_code',
  'document_class',
  'ocr_text_hash',
  'gateway_request_id',
  'correlation_id',
  'tenant_present',
]);

export function logSafe(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (ALLOWED_LOG_KEYS.has(key)) out[key] = value;
  }
  return out;
}
