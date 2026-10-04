import type { SimulationMarker } from '@serviceform/contracts';
import { assertChecksum } from './checksum.js';
import { StoragePortError } from './errors.js';
import type { ObjectStorePort, PutObjectInput, StoredObjectBytes } from './ports.js';

interface Entry {
  objectKey: string;
  contentType: string;
  bytes: Uint8Array;
  checksumSha256: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  simulation?: SimulationMarker;
}

/**
 * In-process SIMULATED/local object store. Not durable across process restarts.
 * Authoritative object metadata remains in PostgreSQL (CMP-032). Constitution:
 * no local pod filesystem as durable storage.
 */
export class SimulatedObjectStore implements ObjectStorePort {
  private readonly objects = new Map<string, Entry>();

  async put(input: PutObjectInput): Promise<void> {
    if (input.mode === 'SIMULATED' && !input.simulation) {
      throw new StoragePortError(
        'SIMULATION_MARKER_REQUIRED',
        'SIMULATED put requires SF-CON-SIMULATION-MARKER',
      );
    }
    try {
      assertChecksum(input.bytes, input.checksumSha256);
    } catch {
      throw new StoragePortError('CHECKSUM_MISMATCH', 'content checksum mismatch');
    }
    const existing = this.objects.get(input.objectId);
    if (existing && existing.status !== 'DELETED') {
      // Idempotent put: same checksum succeeds; conflict otherwise.
      if (
        existing.checksumSha256 === input.checksumSha256 &&
        existing.objectKey === input.objectKey
      ) {
        return;
      }
      throw new StoragePortError('OBJECT_EXISTS', 'object already exists with different content');
    }
    const copy = Uint8Array.from(input.bytes);
    const entry: Entry = {
      objectKey: input.objectKey,
      contentType: input.contentType,
      bytes: copy,
      checksumSha256: input.checksumSha256,
      status: 'ACTIVE',
    };
    if (input.simulation) entry.simulation = input.simulation;
    this.objects.set(input.objectId, entry);
  }

  async getBytes(objectId: string): Promise<StoredObjectBytes | null> {
    const entry = this.objects.get(objectId);
    if (!entry || entry.status === 'DELETED') return null;
    return {
      objectId,
      objectKey: entry.objectKey,
      contentType: entry.contentType,
      bytes: Uint8Array.from(entry.bytes),
      checksumSha256: entry.checksumSha256,
    };
  }

  async archive(objectId: string): Promise<void> {
    const entry = this.objects.get(objectId);
    if (!entry || entry.status === 'DELETED') {
      throw new StoragePortError('OBJECT_NOT_FOUND', 'object not found');
    }
    entry.status = 'ARCHIVED';
  }

  async delete(objectId: string): Promise<void> {
    const entry = this.objects.get(objectId);
    if (!entry) {
      throw new StoragePortError('OBJECT_NOT_FOUND', 'object not found');
    }
    entry.status = 'DELETED';
    entry.bytes = new Uint8Array(0);
  }

  /** Test helper */
  size(): number {
    return this.objects.size;
  }
}
