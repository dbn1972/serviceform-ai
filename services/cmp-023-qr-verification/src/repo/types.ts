import type { VerificationTokenRecord } from '../domain/token.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

/**
 * CMP-023's own rows only. There is intentionally no method that reads or writes a registry
 * status: status lives in CMP-024 and is fetched through RegistryStatusPort on every request.
 */
export interface QrTx {
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
  insertToken(row: VerificationTokenRecord): Promise<void>;
  getToken(tokenId: string): Promise<VerificationTokenRecord | undefined>;
  getTokenByOpaque(opaqueToken: string): Promise<VerificationTokenRecord | undefined>;
  getTokenByCredential(credentialId: string): Promise<VerificationTokenRecord | undefined>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface QrRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: QrTx) => Promise<T>): Promise<T>;
}
