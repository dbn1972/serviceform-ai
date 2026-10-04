import type { ConnectorMode, SimulationMarker } from '@serviceform/contracts';

export interface UploadTarget {
  method: 'PUT';
  url: string;
  expires_at: string;
  required_headers: Record<string, string>;
  simulation?: SimulationMarker;
}

export interface ObjectInspection {
  byte_size: number;
  checksum_sha256: string;
  /** Leading bytes for content sniffing only; never the full body. */
  head: Uint8Array;
}

export interface DownloadAccess {
  method: 'GET';
  url: string;
  expires_at: string;
  simulation?: SimulationMarker;
}

/**
 * CMP-013 view of CMP-032 Storage. Bytes go client -> object store directly via a short-lived
 * target; CMP-013 never proxies bodies, never holds provider credentials, and calls every method
 * outside an open database transaction (Constitution #11). Implementations must refuse keys that
 * are not owned by `tenantId`.
 */
export interface DocumentStoragePort {
  readonly mode: ConnectorMode;
  readonly connectorBindingId: string;
  /** SF-CON-SIMULATION-MARKER; required when mode is SIMULATED. */
  readonly simulation?: SimulationMarker;
  issueUploadTarget(input: {
    tenantId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    expiresAt: Date;
  }): Promise<UploadTarget>;
  inspectObject(input: { tenantId: string; objectKey: string }): Promise<ObjectInspection | null>;
  releaseFromQuarantine(input: { tenantId: string; objectKey: string }): Promise<void>;
  discard(input: { tenantId: string; objectKey: string }): Promise<void>;
  issueDownloadAccess(input: {
    tenantId: string;
    objectKey: string;
    expiresAt: Date;
  }): Promise<DownloadAccess>;
}
