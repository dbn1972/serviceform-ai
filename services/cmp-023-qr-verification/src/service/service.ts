import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import {
  buildPublicView,
  buildVerificationToken,
  isCredentialView,
  isExpired,
  isRegistryStatusRecord,
  signedArtifactHash,
  STATUS_SOURCE_CMP,
  TOKEN_PURPOSE,
  generateOpaqueToken,
  tokenRef,
  type VerificationTokenRecord,
} from '../domain/token.js';
import { Cmp023Error, detail, type ErrorCode } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { CredentialPort, IssuedCredentialView } from '../ports/credential-port.js';
import type { RegistryStatusPort, RegistryStatusRecord } from '../ports/registry-status-port.js';
import type { QrRepository, QrTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { IssueTokenInput } from './input.js';

export interface QrServiceDeps {
  repo: QrRepository;
  authorizer: AuthorizationPort;
  registry: RegistryStatusPort;
  credentials: CredentialPort;
  clock: () => Date;
  tokenFactory?: () => string;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface CommandResult {
  status: number;
  body: unknown;
}

type ActorType = TenantContext['actor']['type'];
/** Tokens are minted by the issuing side (staff or the CMP-022 workload), never by citizens. */
const ISSUE_ACTORS: readonly ActorType[] = ['OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM'];
const READ_ACTORS: readonly ActorType[] = ['OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM'];
/** Public verification: any server-derived actor; OPA decides. */
const VERIFY_ACTORS: readonly ActorType[] = [
  'CITIZEN',
  'OFFICER',
  'PRIVILEGED_ADMIN',
  'SYSTEM',
  'INTEGRATION',
];

export const TOKEN_RESOURCE_TYPE = 'VerificationToken';

export const ACTIONS = {
  issue: 'QR_TOKEN_ISSUE',
  read: 'QR_TOKEN_READ',
  verify: 'QR_TOKEN_VERIFY',
} as const;

type PortName = 'REGISTRY' | 'CREDENTIAL';

class AuditedRefusal extends Cmp023Error {
  constructor(
    code: ErrorCode,
    readonly reason: string,
  ) {
    super(code, detail(reason));
  }
}

export class QrVerificationService {
  private readonly newToken: () => string;

  constructor(private readonly deps: QrServiceDeps) {
    this.newToken = deps.tokenFactory ?? generateOpaqueToken;
  }

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp023Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private async external<T>(
    port: PortName,
    call: () => Promise<unknown>,
    valid: (v: unknown) => v is T,
  ): Promise<T | null> {
    this.assertNotInTx();
    let out: unknown;
    try {
      out = await call();
    } catch (err) {
      throw new Cmp023Error('SF-INT-001', { ...detail(`${port}_UNAVAILABLE`), cause: err });
    }
    if (out === null) return null;
    if (!valid(out)) throw new Cmp023Error('SF-INT-001', detail(`${port}_RESPONSE_INVALID`));
    return out;
  }

  /**
   * Live CMP-024 read. There is no cached or stored fallback: an outage fails closed so a
   * verifier is never shown a status the registry did not just confirm.
   */
  private async registryStatus(
    ctx: TenantContext,
    credentialId: string,
  ): Promise<RegistryStatusRecord> {
    const rec = await this.external(
      'REGISTRY',
      () => this.deps.registry.getStatus({ tenantId: ctx.tenant_id, credentialId }),
      isRegistryStatusRecord,
    );
    if (rec === null) throw new AuditedRefusal('SF-APP-001', 'REGISTRY_RECORD_NOT_FOUND');
    if (rec.tenant_id !== ctx.tenant_id) {
      throw new AuditedRefusal('SF-TEN-002', 'CROSS_TENANT_RECORD_BLOCKED');
    }
    if (rec.credential_id !== credentialId) {
      throw new Cmp023Error('SF-INT-001', detail('REGISTRY_RESPONSE_INVALID'));
    }
    return rec;
  }

  private async guard(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    actors: readonly ActorType[],
  ): Promise<void> {
    this.assertNotInTx();
    if (!actors.includes(ctx.actor.type)) {
      throw new Cmp023Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action, TOKEN_RESOURCE_TYPE));
    } catch (err) {
      if (err instanceof Cmp023Error && err.code === 'SF-AUTH-002') {
        await this.auditOutcome(ctx, action, resourceId, 'DENIED');
      }
      throw err;
    }
  }

  private async auditOutcome(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    result: 'SUCCESS' | 'DENIED' | 'FAILED',
    reason?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action === ACTIONS.issue ? 'WRITE' : 'READ',
        resourceType: TOKEN_RESOURCE_TYPE,
        resourceId,
        result,
        ...(reason === undefined ? {} : { reason }),
        now,
      }),
    );
  }

  private async auditedFailure(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    err: unknown,
  ): Promise<never> {
    if (err instanceof Cmp023Error && err.code !== 'SF-SYS-001') {
      const reason =
        err instanceof AuditedRefusal ? err.reason : (err.details?.[0]?.code ?? err.code);
      await this.auditOutcome(ctx, action, resourceId, 'FAILED', reason);
    }
    throw err;
  }

  /**
   * Mints the single public-verification token for an ISSUED credential. CMP-022 and CMP-024 are
   * read first with no transaction open. Re-minting for the same credential returns the existing
   * token (200) without a second row or event; a replayed Idempotency-Key does the same. Every
   * response renders registry_status from the read just made, never from a stored response.
   */
  async issueToken(
    ctx: TenantContext,
    input: IssueTokenInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const resourceId = input.credential_id;
    await this.guard(ctx, ACTIONS.issue, resourceId, ISSUE_ACTORS);
    try {
      const credential = await this.issuedCredential(ctx, input.credential_id);
      const status = await this.registryStatus(ctx, input.credential_id);
      const now = this.deps.clock();
      if (input.expires_at !== null && Date.parse(input.expires_at) <= now.getTime()) {
        throw new Cmp023Error('SF-SYS-003', detail('EXPIRES_AT_NOT_IN_FUTURE', '/expires_at'));
      }
      return await this.deps.repo.withTx(ctx, async (tx) => {
        const claim = await tx.claimIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          fingerprint: idem.fingerprint,
          now,
        });
        if (claim !== 'claimed') {
          const tokenId = (claim.body as { token_id?: unknown } | null)?.token_id;
          const row = typeof tokenId === 'string' ? await tx.getToken(tokenId) : undefined;
          if (!row) throw new Cmp023Error('SF-APP-002');
          return this.tokenResponse(claim.status, row, status, now);
        }
        const existing = await tx.getTokenByCredential(input.credential_id);
        let result: CommandResult;
        if (existing) {
          if (
            existing.credential_type_ref !== input.credential_type_ref ||
            existing.expires_at !== input.expires_at
          ) {
            throw new AuditedRefusal('SF-APP-002', 'TOKEN_EXISTS_WITH_DIFFERENT_TERMS');
          }
          result = this.tokenResponse(200, existing, status, now);
        } else {
          const row = this.newRecord(ctx, input, credential, status, now);
          await tx.insertToken(row);
          await this.emitIssued(tx, ctx, row, now);
          await appendAudit(tx, ctx, {
            action: ACTIONS.issue,
            actionClass: 'WRITE',
            resourceType: TOKEN_RESOURCE_TYPE,
            resourceId: row.token_id,
            result: 'SUCCESS',
            now,
          });
          result = this.tokenResponse(201, row, status, now);
        }
        const token = (result.body as { token: { token_id: string } }).token;
        await tx.completeIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          status: result.status,
          body: { token_id: token.token_id },
        });
        return result;
      });
    } catch (err) {
      return this.auditedFailure(ctx, ACTIONS.issue, resourceId, err);
    }
  }

  private async issuedCredential(
    ctx: TenantContext,
    credentialId: string,
  ): Promise<IssuedCredentialView> {
    const c = await this.external(
      'CREDENTIAL',
      () => this.deps.credentials.getCredential({ tenantId: ctx.tenant_id, credentialId }),
      isCredentialView,
    );
    if (c === null) throw new Cmp023Error('SF-SYS-002', detail('CREDENTIAL_NOT_FOUND'));
    if (c.tenant_id !== ctx.tenant_id) {
      throw new AuditedRefusal('SF-TEN-002', 'CROSS_TENANT_RECORD_BLOCKED');
    }
    if (c.credential_id !== credentialId) {
      throw new Cmp023Error('SF-INT-001', detail('CREDENTIAL_RESPONSE_INVALID'));
    }
    if (c.lifecycle_status !== 'ISSUED') {
      throw new AuditedRefusal('SF-APP-001', 'CREDENTIAL_NOT_ISSUED');
    }
    return c;
  }

  private newRecord(
    ctx: TenantContext,
    input: IssueTokenInput,
    credential: IssuedCredentialView,
    status: RegistryStatusRecord,
    now: Date,
  ): VerificationTokenRecord {
    return {
      tenant_id: ctx.tenant_id,
      token_id: randomUUID(),
      credential_id: input.credential_id,
      opaque_token: this.newToken(),
      credential_type_ref: input.credential_type_ref,
      issuer_ref: status.issuer_ref,
      issued_at:
        credential.issued_at === undefined ? null : new Date(credential.issued_at).toISOString(),
      signed_artifact_sha256: signedArtifactHash(credential),
      expires_at: input.expires_at,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      created_at: now.toISOString(),
      correlation_id: ctx.correlation_id,
    };
  }

  private async emitIssued(
    tx: QrTx,
    ctx: TenantContext,
    row: VerificationTokenRecord,
    now: Date,
  ): Promise<void> {
    const env = envelopeOf({
      eventType: 'VerificationTokenIssued',
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: TOKEN_RESOURCE_TYPE,
      aggregateId: row.token_id,
      aggregateVersion: 1,
      occurredAt: now.toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        token_id: row.token_id,
        credential_id: row.credential_id,
        token_purpose: TOKEN_PURPOSE,
        credential_type_ref: row.credential_type_ref,
        status_source_cmp: STATUS_SOURCE_CMP,
        registry_status_read_only: true,
        embedded_pii_forbidden: true,
      },
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
  }

  private tokenResponse(
    status: number,
    row: VerificationTokenRecord,
    registry: RegistryStatusRecord,
    checkedAt: Date,
  ): CommandResult {
    this.assertIssuerConsistent(row, registry);
    return {
      status,
      body: { token: buildVerificationToken(row, registry.current_status, checkedAt) },
    };
  }

  private assertIssuerConsistent(row: VerificationTokenRecord, registry: RegistryStatusRecord): void {
    if (registry.issuer_ref !== row.issuer_ref) {
      throw new Cmp023Error('SF-INT-001', detail('REGISTRY_ISSUER_MISMATCH'));
    }
  }

  /** Issuer-side view of a token record, status read live from CMP-024. */
  async getToken(ctx: TenantContext, tokenId: string): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.read, tokenId, READ_ACTORS);
    try {
      const row = await this.deps.repo.withTx(ctx, (tx) => tx.getToken(tokenId));
      if (!row) throw new Cmp023Error('SF-SYS-002', detail('TOKEN_NOT_FOUND'));
      const registry = await this.registryStatus(ctx, row.credential_id);
      const checkedAt = this.deps.clock();
      const result = this.tokenResponse(200, row, registry, checkedAt);
      await this.auditOutcome(ctx, ACTIONS.read, row.token_id, 'SUCCESS');
      return result;
    } catch (err) {
      return this.auditedFailure(ctx, ACTIONS.read, tokenId, err);
    }
  }

  /**
   * Public QR verification. Returns only the purpose-minimised public_view: no credential id,
   * token id, tenant id or holder data. The opaque token is never written to audit; a one-way
   * token-ref is used instead.
   */
  async verify(ctx: TenantContext, opaqueToken: string): Promise<CommandResult> {
    const ref = tokenRef(opaqueToken);
    await this.guard(ctx, ACTIONS.verify, ref, VERIFY_ACTORS);
    try {
      const row = await this.deps.repo.withTx(ctx, (tx) => tx.getTokenByOpaque(opaqueToken));
      if (!row) throw new Cmp023Error('SF-SYS-002', detail('TOKEN_NOT_FOUND'));
      const now = this.deps.clock();
      if (isExpired(row, now)) throw new Cmp023Error('SF-SYS-002', detail('TOKEN_EXPIRED'));
      const registry = await this.registryStatus(ctx, row.credential_id);
      this.assertIssuerConsistent(row, registry);
      const checkedAt = this.deps.clock();
      const body = {
        token_purpose: TOKEN_PURPOSE,
        status_source_cmp: STATUS_SOURCE_CMP,
        public_view: buildPublicView(row, registry.current_status, checkedAt),
      };
      await this.auditOutcome(ctx, ACTIONS.verify, row.token_id, 'SUCCESS');
      return { status: 200, body };
    } catch (err) {
      return this.auditedFailure(ctx, ACTIONS.verify, ref, err);
    }
  }
}
