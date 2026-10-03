export interface AuditServiceConfig {
  clockSkewSeconds: number;
  queryMaxDays: number;
  queryMaxLimit: number;
  cellId: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

function positiveInt(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

export function loadConfig(): AuditServiceConfig {
  const skew = Number(process.env['SF_AUDIT_CLOCK_SKEW_SECONDS'] ?? '300');
  const cellId = process.env['SF_CELL_ID'] ?? 'cell-01';
  assertCellId(cellId);
  return {
    clockSkewSeconds: Number.isFinite(skew) ? skew : 300,
    queryMaxDays: 31,
    queryMaxLimit: 200,
    cellId,
    rateLimitMax: positiveInt(process.env['SF_AUDIT_RATE_LIMIT_MAX'] ?? '60', 60),
    rateLimitWindowMs: positiveInt(process.env['SF_AUDIT_RATE_LIMIT_WINDOW_MS'] ?? '60000', 60_000),
  };
}

export function assertCellId(cellId: string): void {
  if (!isCellId(cellId)) {
    throw new Error('Invalid SF_CELL_ID');
  }
}

function isCellId(value: string): boolean {
  if (!value.startsWith('cell-')) return false;
  const rest = value.slice(5);
  if (rest.length < 1 || rest.length > 40) return false;
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest.charCodeAt(i);
    const lower = c >= 97 && c <= 122;
    const digit = c >= 48 && c <= 57;
    const hyphen = c === 45;
    if (!lower && !digit && !hyphen) return false;
  }
  return true;
}
