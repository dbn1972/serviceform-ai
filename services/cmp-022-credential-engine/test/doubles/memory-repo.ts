import { AsyncLocalStorage } from 'node:async_hooks';
import type { ArtifactRow, CredentialRow } from '../../src/domain/credential.js';
import type { DownstreamChannel, DownstreamOutcomeRow } from '../../src/domain/outcome.js';
import type { SigningRecordRow } from '../../src/domain/signing.js';
import { Cmp022Error } from '../../src/errors.js';
import type {
  CredentialRepository,
  CredentialTx,
  IdempotencyPeek,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

interface IdemRow extends IdempotencyPeek {
  key: string;
}

export interface TenantState {
  credentials: Map<string, CredentialRow>;
  artifacts: ArtifactRow[];
  signing: SigningRecordRow[];
  outcomes: DownstreamOutcomeRow[];
  idempotency: Map<string, IdemRow>;
  outbox: { topic: string; envelope: EventEnvelope<Record<string, unknown>> }[];
}

function emptyTenant(): TenantState {
  return {
    credentials: new Map(),
    artifacts: [],
    signing: [],
    outcomes: [],
    idempotency: new Map(),
    outbox: [],
  };
}

function cloneTenant(s: TenantState): TenantState {
  return {
    credentials: new Map([...s.credentials].map(([k, v]) => [k, { ...v }])),
    artifacts: s.artifacts.map((a) => ({ ...a })),
    signing: s.signing.map((r) => ({ ...r })),
    outcomes: s.outcomes.map((o) => ({ ...o })),
    idempotency: new Map([...s.idempotency].map(([k, v]) => [k, { ...v }])),
    outbox: [...s.outbox],
  };
}

const pgError = (code: string): Error => Object.assign(new Error(code), { code });
const idemKey = (p: { principalId: string; endpoint: string; key: string }): string =>
  `${p.principalId}|${p.endpoint}|${p.key}`;

/** Mirrors the sf_credential triggers: forward-only lifecycle and status-gated child inserts. */
class MemoryTx implements CredentialTx {
  constructor(private readonly s: TenantState) {}

  private requireStatus(credentialId: string, status: CredentialRow['lifecycle_status']): void {
    const row = this.s.credentials.get(credentialId);
    if (!row) throw pgError('23503');
    if (row.lifecycle_status !== status) throw pgError('55000');
  }

  peekIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyPeek | undefined> {
    const row = this.s.idempotency.get(idemKey(p));
    return Promise.resolve(row ? { ...row } : undefined);
  }

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const k = idemKey(p);
    const row = this.s.idempotency.get(k);
    if (!row) {
      this.s.idempotency.set(k, {
        key: p.key,
        request_fingerprint: p.fingerprint,
        status: 'IN_PROGRESS',
        response_status: null,
        response_body: null,
      });
      return Promise.resolve('claimed');
    }
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp022Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return Promise.resolve({ status: row.response_status, body: row.response_body });
    }
    throw new Cmp022Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const row = this.s.idempotency.get(idemKey(p));
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = p.status;
      row.response_body = JSON.parse(JSON.stringify(p.body)) as unknown;
    }
    return Promise.resolve();
  }

  insertCredential(row: CredentialRow): Promise<boolean> {
    if (row.lifecycle_status !== 'GENERATED') throw pgError('55000');
    for (const c of this.s.credentials.values()) {
      if (c.application_id === row.application_id && c.issuance_key === row.issuance_key) {
        return Promise.resolve(false);
      }
    }
    if (this.s.credentials.has(row.credential_id)) throw pgError('23505');
    this.s.credentials.set(row.credential_id, { ...row });
    return Promise.resolve(true);
  }

  getCredential(credentialId: string): Promise<CredentialRow | undefined> {
    const c = this.s.credentials.get(credentialId);
    return Promise.resolve(c ? { ...c } : undefined);
  }

  lockCredential(credentialId: string): Promise<CredentialRow | undefined> {
    return this.getCredential(credentialId);
  }

  listByApplication(applicationId: string): Promise<CredentialRow[]> {
    return Promise.resolve(
      [...this.s.credentials.values()]
        .filter((c) => c.application_id === applicationId)
        .sort(
          (a, b) =>
            a.generated_at.localeCompare(b.generated_at) ||
            a.credential_id.localeCompare(b.credential_id),
        )
        .map((c) => ({ ...c })),
    );
  }

  insertArtifact(row: ArtifactRow): Promise<void> {
    this.requireStatus(row.credential_id, 'GENERATED');
    if (
      this.s.artifacts.some(
        (a) => a.credential_id === row.credential_id && a.artifact_kind === row.artifact_kind,
      )
    ) {
      throw pgError('23505');
    }
    this.s.artifacts.push({ ...row });
    return Promise.resolve();
  }

  listArtifacts(credentialId: string): Promise<ArtifactRow[]> {
    return Promise.resolve(
      this.s.artifacts.filter((a) => a.credential_id === credentialId).map((a) => ({ ...a })),
    );
  }

  insertSigningRecord(row: SigningRecordRow): Promise<boolean> {
    this.requireStatus(row.credential_id, 'GENERATED');
    if (
      this.s.signing.some(
        (r) => r.credential_id === row.credential_id && r.attempt_number === row.attempt_number,
      )
    ) {
      return Promise.resolve(false);
    }
    this.s.signing.push({ ...row });
    return Promise.resolve(true);
  }

  listSigningRecords(credentialId: string): Promise<SigningRecordRow[]> {
    return Promise.resolve(
      this.s.signing
        .filter((r) => r.credential_id === credentialId)
        .sort((a, b) => a.attempt_number - b.attempt_number)
        .map((r) => ({ ...r })),
    );
  }

  markSigned(credentialId: string, signingRecordId: string, signedAt: string): Promise<boolean> {
    const row = this.s.credentials.get(credentialId);
    if (!row || row.lifecycle_status !== 'GENERATED') return Promise.resolve(false);
    const attempt = this.s.signing.find(
      (r) => r.signing_record_id === signingRecordId && r.credential_id === credentialId,
    );
    const artifact = this.s.artifacts.find(
      (a) => a.credential_id === credentialId && a.artifact_kind === 'SIGNED_ARTIFACT',
    );
    if (
      attempt?.signing_result !== 'SIGNED' ||
      !artifact ||
      artifact.sha256 !== attempt.signed_artifact_sha256
    ) {
      throw pgError('55000');
    }
    row.lifecycle_status = 'SIGNED';
    row.signing_record_id = signingRecordId;
    row.signed_at = signedAt;
    return Promise.resolve(true);
  }

  markIssued(credentialId: string, issuedAt: string): Promise<boolean> {
    const row = this.s.credentials.get(credentialId);
    if (!row || row.lifecycle_status !== 'SIGNED') return Promise.resolve(false);
    row.lifecycle_status = 'ISSUED';
    row.issued_at = issuedAt;
    return Promise.resolve(true);
  }

  insertDownstreamOutcome(row: DownstreamOutcomeRow): Promise<boolean> {
    this.requireStatus(row.credential_id, 'ISSUED');
    if (
      this.s.outcomes.some(
        (o) =>
          o.credential_id === row.credential_id &&
          o.channel === row.channel &&
          o.outcome_ref === row.outcome_ref,
      )
    ) {
      return Promise.resolve(false);
    }
    this.s.outcomes.push({ ...row });
    return Promise.resolve(true);
  }

  findDownstreamOutcome(
    credentialId: string,
    channel: DownstreamChannel,
    outcomeRef: string,
  ): Promise<DownstreamOutcomeRow | undefined> {
    const o = this.s.outcomes.find(
      (x) =>
        x.credential_id === credentialId && x.channel === channel && x.outcome_ref === outcomeRef,
    );
    return Promise.resolve(o ? { ...o } : undefined);
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({
      topic,
      envelope: JSON.parse(JSON.stringify(envelope)) as EventEnvelope<Record<string, unknown>>,
    });
    return Promise.resolve();
  }
}

/** Tenant-partitioned store with all-or-nothing transactions, mirroring RLS + COMMIT/ROLLBACK. */
export class MemoryCredentialRepository implements CredentialRepository {
  private readonly als = new AsyncLocalStorage<true>();
  private readonly tenants = new Map<string, TenantState>();
  txCount = 0;

  tenant(id: string): TenantState {
    let s = this.tenants.get(id);
    if (!s) {
      s = emptyTenant();
      this.tenants.set(id, s);
    }
    return s;
  }

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: CredentialTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp022Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp022Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    this.txCount += 1;
    const live = this.tenant(ctx.tenant_id);
    const work = cloneTenant(live);
    const result = await this.als.run(true, () => fn(new MemoryTx(work)));
    this.tenants.set(ctx.tenant_id, work);
    return result;
  }
}
