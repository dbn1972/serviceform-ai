import type { ArtifactRow, CredentialRow } from '../domain/credential.js';
import type { DownstreamChannel, DownstreamOutcomeRow } from '../domain/outcome.js';
import type { SigningRecordRow } from '../domain/signing.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface IdempotencyPeek {
  request_fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_status: number | null;
  response_body: unknown;
}

export interface CredentialTx {
  peekIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyPeek | undefined>;
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
  /** Returns false when the (application, issuance_key) credential already exists. */
  insertCredential(row: CredentialRow): Promise<boolean>;
  getCredential(credentialId: string): Promise<CredentialRow | undefined>;
  /** Reads the credential under a row lock held until commit (serialises lifecycle steps). */
  lockCredential(credentialId: string): Promise<CredentialRow | undefined>;
  listByApplication(applicationId: string): Promise<CredentialRow[]>;
  insertArtifact(row: ArtifactRow): Promise<void>;
  listArtifacts(credentialId: string): Promise<ArtifactRow[]>;
  /** Returns false when a record for (credential, attempt_number) already exists. */
  insertSigningRecord(row: SigningRecordRow): Promise<boolean>;
  listSigningRecords(credentialId: string): Promise<SigningRecordRow[]>;
  /** Compare-and-set GENERATED → SIGNED. Returns false when the row was not GENERATED. */
  markSigned(credentialId: string, signingRecordId: string, signedAt: string): Promise<boolean>;
  /** Compare-and-set SIGNED → ISSUED. Returns false when the row was not SIGNED. */
  markIssued(credentialId: string, issuedAt: string): Promise<boolean>;
  /** Returns false when (credential, channel, outcome_ref) is already recorded. */
  insertDownstreamOutcome(row: DownstreamOutcomeRow): Promise<boolean>;
  findDownstreamOutcome(
    credentialId: string,
    channel: DownstreamChannel,
    outcomeRef: string,
  ): Promise<DownstreamOutcomeRow | undefined>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface CredentialRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: CredentialTx) => Promise<T>): Promise<T>;
}
