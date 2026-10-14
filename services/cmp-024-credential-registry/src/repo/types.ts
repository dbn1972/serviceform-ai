import type { RegistryEntryRecord, StatusHistoryRecord } from '../domain/status.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

/**
 * Read surface of the registry. Read ports (status lookup, QR verification) receive only this
 * type and run in a read-only transaction, so they cannot change status or history.
 */
export interface RegistryReadTx {
  getEntry(credentialId: string): Promise<RegistryEntryRecord | undefined>;
  listHistory(credentialId: string): Promise<StatusHistoryRecord[]>;
}

export interface RegistryTx extends RegistryReadTx {
  getEntryForUpdate(credentialId: string): Promise<RegistryEntryRecord | undefined>;
  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'>;
  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;
  insertEntry(row: RegistryEntryRecord): Promise<void>;
  updateEntryStatus(row: RegistryEntryRecord): Promise<void>;
  insertHistory(row: StatusHistoryRecord): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface RegistryRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: RegistryTx) => Promise<T>): Promise<T>;
  withReadTx<T>(ctx: RequestContext, fn: (tx: RegistryReadTx) => Promise<T>): Promise<T>;
}
