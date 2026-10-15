import type {
  ConsentRecord,
  OperatorActionRecord,
  RepresentationRecord,
  SessionAggregate,
  SessionRecord,
} from '../domain/session.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

/** Read surface; the session read port receives only this and runs in a READ ONLY transaction. */
export interface AssistedReadTx {
  getSession(sessionId: string): Promise<SessionAggregate | undefined>;
  listActions(sessionId: string): Promise<OperatorActionRecord[]>;
}

export interface AssistedTx extends AssistedReadTx {
  getSessionForUpdate(sessionId: string): Promise<SessionAggregate | undefined>;
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
  insertSession(row: SessionRecord): Promise<void>;
  updateSession(row: SessionRecord): Promise<void>;
  insertRepresentation(row: RepresentationRecord): Promise<void>;
  insertConsent(row: ConsentRecord): Promise<void>;
  insertAction(row: OperatorActionRecord): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface AssistedRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: AssistedTx) => Promise<T>): Promise<T>;
  withReadTx<T>(ctx: RequestContext, fn: (tx: AssistedReadTx) => Promise<T>): Promise<T>;
}
