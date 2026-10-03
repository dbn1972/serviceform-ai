/**
 * Keys whose values must never reach logs, traces or telemetry (Constitution #21,
 * AWS v1.7 s5 "PII must not be copied to logs, traces, prompts ..."). Matching is
 * case-insensitive on the key name at any depth for redactDeep(), and on the listed
 * pino paths for the logger.
 */
export const REDACTED = '[REDACTED]';

export const SENSITIVE_KEYS = [
  // credentials and secrets
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passcode',
  'secret',
  'client_secret',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'private_key',
  'otp',
  'pin',
  // personal identifiers
  'aadhaar',
  'aadhaar_number',
  'vid',
  'pan',
  'pan_number',
  'mobile',
  'mobile_number',
  'phone',
  'phone_number',
  'email',
  'email_address',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'father_name',
  'mother_name',
  'spouse_name',
  'dob',
  'date_of_birth',
  'address',
  'address_line',
  'pincode',
  'annual_income',
  'bank_account',
  'account_number',
  'ifsc',
  'upi_id',
  'document',
  'document_content',
] as const;

const sensitive = new Set<string>(SENSITIVE_KEYS.map((k) => k.toLowerCase()));

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-\s]/g, '_');
  if (sensitive.has(k)) return true;
  const camelToSnake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return sensitive.has(camelToSnake);
}

/** Returns a copy of `value` with every sensitive key's value replaced. Handles cycles. */
export function redactDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]' as T;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v: unknown) => redactDeep(v, seen)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redactDeep(v, seen);
  }
  return out as T;
}

/** pino redact paths: each sensitive key at top level and up to three levels deep. */
export function pinoRedactPaths(): string[] {
  const paths: string[] = [];
  for (const key of [...SENSITIVE_KEYS, 'x-api-key']) {
    const plain = /^[a-z_]+$/i.test(key);
    const seg = plain ? `.${key}` : `["${key}"]`;
    if (plain) paths.push(key);
    for (const prefix of ['*', '*.*', '*.*.*']) paths.push(`${prefix}${seg}`);
  }
  return [...new Set(paths)];
}
