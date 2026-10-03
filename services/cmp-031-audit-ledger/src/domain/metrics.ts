export interface Metrics {
  ingest: number;
  duplicates: number;
  piiRejected: number;
  verifyFailures: number;
  clientContextDropped: number;
}

export function createMetrics(): Metrics {
  return {
    ingest: 0,
    duplicates: 0,
    piiRejected: 0,
    verifyFailures: 0,
    clientContextDropped: 0,
  };
}
