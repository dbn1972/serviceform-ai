import type { SimulationMarker } from '@serviceform/contracts';
import type { StorageMode } from './modes.js';

export interface StoredObjectBytes {
  objectId: string;
  objectKey: string;
  contentType: string;
  bytes: Uint8Array;
  checksumSha256: string;
}

export interface PutObjectInput {
  objectId: string;
  objectKey: string;
  contentType: string;
  bytes: Uint8Array;
  checksumSha256: string;
  mode: StorageMode;
  simulation?: SimulationMarker;
}

export interface PresignedAccess {
  url: string;
  expiresAt: string;
  method: 'GET';
  simulation?: SimulationMarker;
}

export interface ObjectStorePort {
  put(input: PutObjectInput): Promise<void>;
  getBytes(objectId: string): Promise<StoredObjectBytes | null>;
  archive(objectId: string): Promise<void>;
  delete(objectId: string): Promise<void>;
}

/** Narrow KMS port used by CMP-032 (implemented by CMP-048 adapters at host mount). */
export interface StorageKmsPort {
  wrapDek(
    keyRef: string,
    dek: Uint8Array,
    context: Record<string, string>,
  ): Promise<{ wrappedDek: string; keyVersion: string }>;
}

/** Narrow secrets port for signing simulated presign tokens. */
export interface StorageSecretsPort {
  getHmacKey(name: string): Promise<Uint8Array>;
}
