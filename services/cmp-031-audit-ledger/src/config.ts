export interface AuditServiceConfig {
  clockSkewSeconds: number;
  queryMaxDays: number;
  queryMaxLimit: number;
  cellId: string;
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
  };
}

export function assertCellId(cellId: string): void {
  if (!/^cell-[a-z0-9-]{1,40}$/.test(cellId)) {
    throw new Error('Invalid SF_CELL_ID');
  }
}
