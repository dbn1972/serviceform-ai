import type { AuthAssurance, RequestContext, SimulationMarker } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import type { DigiLockerIdentityAdapter } from './adapters/digilocker.js';
import type { IdpAdapter } from './adapters/idp.js';
import type { OtpAdapter } from './adapters/otp.js';
import { auditEvent, type AuditRecorder } from './audit.js';
import { authorize, type AuthorizationPort } from './authz.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from './db/outbox.js';
import { claimIdempotency, completeIdempotency } from './db/idempotency.js';
import { withContextTx } from './db/tx.js';
import { Cmp004Error } from './errors.js';
import {
  fingerprintRequest,
  hmacHex,
  newId,
  newOpaqueToken,
  sha256Hex,
  tokenFingerprint,
} from './hashing.js';

const CHANNEL_RE = /^\+[1-9][0-9]{7,14}$/;
const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export interface IdentityServiceOptions {
  pool: Pool;
  pepper: string;
  otp: OtpAdapter;
  idp: IdpAdapter;
  digilocker: DigiLockerIdentityAdapter;
  authorizer: AuthorizationPort;
  audit: AuditRecorder;
  clock: () => Date;
  testRunId: string;
}

export class IdentityService {
  constructor(private readonly opts: IdentityServiceOptions) {}

  async requestCitizenOtp(
    ctx: RequestContext,
    body: { channel: string },
    idempotencyKey: string | undefined,
  ): Promise<{ challenge_id: string; expires_at: string; simulation: SimulationMarker }> {
    if (!CHANNEL_RE.test(body.channel)) throw new Cmp004Error('SF-SYS-003');
    const now = this.opts.clock();
    const channelHash = hmacHex(this.opts.pepper, `channel:${body.channel}`);
    const challengeId = newId();
    const generated = this.opts.otp.createChallenge({
      challengeId,
      channelHash,
      testRunId: this.opts.testRunId,
    });
    const codeHash = sha256Hex(generated.code);
    const expires = new Date(now.getTime() + OTP_TTL_MS);
    const fp = fingerprintRequest({ channel_hash: channelHash });
    const result = await withContextTx(this.opts.pool, ctx, async (c) => {
      const claimed = await this.claim(c, ctx, 'citizen.otp.challenge', idempotencyKey, fp, now);
      if (claimed !== 'claimed') return claimed.body as typeof out;
      let citizenId: string;
      const existing = await c.query<{ citizen_id: string; status: string }>(
        `SELECT citizen_id, status FROM sf_identity.citizen_principal WHERE channel_hash = $1`,
        [channelHash],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].status !== 'ACTIVE') throw new Cmp004Error('SF-AUTH-002');
        citizenId = existing.rows[0].citizen_id;
      } else {
        citizenId = newId();
        await c.query(
          `INSERT INTO sf_identity.citizen_principal (citizen_id, channel_hash, status, created_at, updated_at)
           VALUES ($1,$2,'ACTIVE',$3,$3)`,
          [citizenId, channelHash, now.toISOString()],
        );
      }
      await c.query(
        `INSERT INTO sf_identity.citizen_otp_challenge (
           challenge_id, citizen_id, channel_hash, purpose, code_hash, status, attempts, max_attempts, expires_at, simulation, created_at
         ) VALUES ($1,$2,$3,'AUTH',$4,'PENDING',0,$5,$6,$7::jsonb,$8)`,
        [
          challengeId,
          citizenId,
          channelHash,
          codeHash,
          MAX_ATTEMPTS,
          expires.toISOString(),
          JSON.stringify(generated.simulation),
          now.toISOString(),
        ],
      );
      await c.query(
        `INSERT INTO sf_identity.identity_link (link_id, citizen_id, method, subject_hash, status, created_at)
         VALUES ($1,$2,'OTP',$3,'ACTIVE',$4)
         ON CONFLICT (citizen_id, method, subject_hash) DO NOTHING`,
        [newId(), citizenId, channelHash, now.toISOString()],
      );
      await insertOutbox(
        c,
        envelopeOf({
          eventType: 'CitizenOtpChallengeCreated',
          tenantId: null,
          cellId: ctx.cell_id,
          aggregateType: 'CitizenOtpChallenge',
          aggregateId: challengeId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: { challenge_id: challengeId, purpose: 'AUTH', simulation: true },
        }),
        TOPIC_DOMAIN,
      );
      await this.opts.audit.append(
        c,
        auditEvent(ctx, {
          action: 'CITIZEN_OTP_CHALLENGE',
          actionClass: 'WRITE',
          resourceType: 'CitizenOtpChallenge',
          resourceId: challengeId,
          result: 'SUCCESS',
          now,
        }),
      );
      const out = {
        challenge_id: challengeId,
        expires_at: expires.toISOString(),
        simulation: generated.simulation,
      };
      await completeIdempotency(c, {
        tenantId: ctx.tenant_id,
        principalId: ctx.actor.id,
        endpoint: 'citizen.otp.challenge',
        key: idempotencyKey ?? challengeId,
        status: 201,
        body: out,
      });
      return out;
    });
    await this.opts.otp.dispatch({ challengeId: result.challenge_id, channelHash });
    return result;
  }

  async verifyCitizenOtp(
    ctx: RequestContext,
    body: { challenge_id: string; code: string },
  ): Promise<{ session_token: string; citizen_id: string; expires_at: string }> {
    if (!body.challenge_id || !/^[0-9a-f-]{36}$/i.test(body.challenge_id)) {
      throw new Cmp004Error('SF-SYS-003');
    }
    if (!/^[0-9]{6}$/.test(body.code)) throw new Cmp004Error('SF-AUTH-001');
    const now = this.opts.clock();
    const codeHash = sha256Hex(body.code);
    const token = newOpaqueToken();
    const tokenHash = tokenFingerprint(token);
    const expires = new Date(now.getTime() + SESSION_TTL_MS);
    const sessionId = newId();
    const citizenId = await withContextTx(this.opts.pool, ctx, async (c) => {
      const row = await c.query<{
        citizen_id: string;
        status: string;
        code_hash: string;
        attempts: number;
        max_attempts: number;
        expires_at: Date;
      }>(
        `SELECT citizen_id, status, code_hash, attempts, max_attempts, expires_at
           FROM sf_identity.citizen_otp_challenge WHERE challenge_id = $1`,
        [body.challenge_id],
      );
      const ch = row.rows[0];
      if (!ch) throw new Cmp004Error('SF-AUTH-001');
      if (ch.status !== 'PENDING') throw new Cmp004Error('SF-AUTH-001');
      if (ch.expires_at.getTime() <= now.getTime()) {
        await c.query(
          `UPDATE sf_identity.citizen_otp_challenge SET status = 'EXPIRED' WHERE challenge_id = $1`,
          [body.challenge_id],
        );
        throw new Cmp004Error('SF-AUTH-001');
      }
      if (ch.code_hash !== codeHash) {
        const attempts = ch.attempts + 1;
        const locked = attempts >= ch.max_attempts;
        await c.query(
          `UPDATE sf_identity.citizen_otp_challenge SET attempts = $1, status = $2 WHERE challenge_id = $3`,
          [attempts, locked ? 'LOCKED' : 'PENDING', body.challenge_id],
        );
        throw new Cmp004Error('SF-AUTH-001');
      }
      await c.query(
        `UPDATE sf_identity.citizen_otp_challenge SET status = 'VERIFIED', attempts = attempts + 1 WHERE challenge_id = $1`,
        [body.challenge_id],
      );
      await c.query(
        `INSERT INTO sf_identity.citizen_session (
           session_id, citizen_id, token_hash, status, assurance, expires_at, created_at
         ) VALUES ($1,$2,$3,'ACTIVE','OTP',$4,$5)`,
        [sessionId, ch.citizen_id, tokenHash, expires.toISOString(), now.toISOString()],
      );
      await c.query(
        `INSERT INTO sf_identity.session_lookup (
           token_hash, session_id, actor_type, subject_id, tenant_id, assurance, status, expires_at
         ) VALUES ($1,$2,'CITIZEN',$3,NULL,'OTP','ACTIVE',$4)`,
        [tokenHash, sessionId, ch.citizen_id, expires.toISOString()],
      );
      await insertOutbox(
        c,
        envelopeOf({
          eventType: 'CitizenSessionIssued',
          tenantId: null,
          cellId: ctx.cell_id,
          aggregateType: 'CitizenSession',
          aggregateId: sessionId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: { type: 'CITIZEN', id: ch.citizen_id },
          data: { session_id: sessionId, citizen_id: ch.citizen_id, assurance: 'OTP' },
        }),
        TOPIC_DOMAIN,
      );
      await this.opts.audit.append(
        c,
        auditEvent(
          { ...ctx, actor: { type: 'CITIZEN', id: ch.citizen_id } },
          {
            action: 'CITIZEN_SESSION_ISSUE',
            actionClass: 'WRITE',
            resourceType: 'CitizenSession',
            resourceId: sessionId,
            result: 'SUCCESS',
            now,
          },
        ),
      );
      return ch.citizen_id;
    });
    return { session_token: token, citizen_id: citizenId, expires_at: expires.toISOString() };
  }

  async revokeCitizenSession(ctx: RequestContext): Promise<{ ok: true }> {
    if (ctx.actor.type !== 'CITIZEN') throw new Cmp004Error('SF-AUTH-002');
    const now = this.opts.clock();
    await withContextTx(this.opts.pool, ctx, async (c) => {
      await c.query(
        `UPDATE sf_identity.citizen_session SET status = 'REVOKED', revoked_at = $1
          WHERE citizen_id = $2 AND status = 'ACTIVE'`,
        [now.toISOString(), ctx.actor.id],
      );
      await c.query(
        `UPDATE sf_identity.session_lookup SET status = 'REVOKED'
          WHERE subject_id = $1 AND actor_type = 'CITIZEN' AND status = 'ACTIVE'`,
        [ctx.actor.id],
      );
      await this.opts.audit.append(
        c,
        auditEvent(ctx, {
          action: 'CITIZEN_SESSION_REVOKE',
          actionClass: 'WRITE',
          resourceType: 'CitizenSession',
          resourceId: ctx.actor.id,
          result: 'SUCCESS',
          now,
        }),
      );
    });
    return { ok: true };
  }

  async completeRecovery(
    ctx: RequestContext,
    body: { challenge_id: string; code: string },
  ): Promise<{ session_token: string; citizen_id: string; expires_at: string }> {
    const issued = await this.verifyCitizenOtp(ctx, body);
    const now = this.opts.clock();
    await withContextTx(this.opts.pool, ctx, async (c) => {
      await c.query(
        `UPDATE sf_identity.citizen_otp_challenge SET purpose = purpose WHERE challenge_id = $1 AND purpose = 'AUTH'`,
        [body.challenge_id],
      );
      const recoveryId = newId();
      await c.query(
        `INSERT INTO sf_identity.account_recovery (
           recovery_id, citizen_id, challenge_id, status, expires_at, created_at, completed_at
         ) VALUES ($1,$2,$3,'COMPLETED',$4,$5,$5)`,
        [recoveryId, issued.citizen_id, body.challenge_id, issued.expires_at, now.toISOString()],
      );
      await insertOutbox(
        c,
        envelopeOf({
          eventType: 'CitizenRecoveryCompleted',
          tenantId: null,
          cellId: ctx.cell_id,
          aggregateType: 'AccountRecovery',
          aggregateId: recoveryId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: { type: 'CITIZEN', id: issued.citizen_id },
          data: { recovery_id: recoveryId, citizen_id: issued.citizen_id },
        }),
        TOPIC_DOMAIN,
      );
    });
    return issued;
  }

  async linkDigiLocker(
    ctx: RequestContext,
    body: { authorization_code: string },
  ): Promise<{ link_id: string; method: 'DIGILOCKER' }> {
    if (ctx.actor.type !== 'CITIZEN') throw new Cmp004Error('SF-AUTH-002');
    if (!body.authorization_code) throw new Cmp004Error('SF-SYS-003');
    const exchanged = await this.opts.digilocker.exchangeAuthorizationCode({
      code: body.authorization_code,
      citizenId: ctx.actor.id,
      testRunId: this.opts.testRunId,
    });
    const now = this.opts.clock();
    const linkId = newId();
    await withContextTx(this.opts.pool, ctx, async (c) => {
      await c.query(
        `INSERT INTO sf_identity.identity_link (
           link_id, citizen_id, method, subject_hash, status, simulation, created_at
         ) VALUES ($1,$2,'DIGILOCKER',$3,'ACTIVE',$4::jsonb,$5)`,
        [
          linkId,
          ctx.actor.id,
          exchanged.subjectHash,
          JSON.stringify(exchanged.simulation),
          now.toISOString(),
        ],
      );
      await insertOutbox(
        c,
        envelopeOf({
          eventType: 'IdentityLinkCreated',
          tenantId: null,
          cellId: ctx.cell_id,
          aggregateType: 'IdentityLink',
          aggregateId: linkId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: { link_id: linkId, method: 'DIGILOCKER', simulation: true },
        }),
        TOPIC_DOMAIN,
      );
      await this.opts.audit.append(
        c,
        auditEvent(ctx, {
          action: 'IDENTITY_LINK_DIGILOCKER',
          actionClass: 'WRITE',
          resourceType: 'IdentityLink',
          resourceId: linkId,
          result: 'SUCCESS',
          now,
        }),
      );
    });
    return { link_id: linkId, method: 'DIGILOCKER' };
  }

  async issueOfficerSession(
    ctx: RequestContext,
    body: { assertion: string },
    idempotencyKey: string | undefined,
  ): Promise<{ session_token: string; officer_id: string; tenant_id: string; expires_at: string }> {
    const claims = this.opts.idp.verifyAssertion(body.assertion, this.opts.testRunId);
    const now = this.opts.clock();
    const token = newOpaqueToken();
    const tokenHash = tokenFingerprint(token);
    const sessionId = newId();
    const expires = new Date(now.getTime() + SESSION_TTL_MS);
    const subjectHash = hmacHex(this.opts.pepper, `idp:${claims.subject}`);
    const tenantCtx: RequestContext = {
      ...ctx,
      tenant_id: claims.tenant_id,
      actor: { type: 'OFFICER', id: claims.officer_id },
      roles: claims.roles,
      auth_assurance: claims.assurance,
    };
    await authorize(this.opts.authorizer, {
      subject: {
        user_id: claims.officer_id,
        actor_type: 'OFFICER',
        tenant_id: claims.tenant_id,
        roles: claims.roles,
        jurisdiction_ids: [],
        assurance: claims.assurance,
      },
      resource: {
        resource_type: 'OfficerSession',
        tenant_id: claims.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'OFFICER_SESSION_ISSUE',
    });
    const fp = fingerprintRequest({ subject: subjectHash, tenant_id: claims.tenant_id });
    await withContextTx(this.opts.pool, tenantCtx, async (c) => {
      const claimed = await this.claim(c, tenantCtx, 'officer.session', idempotencyKey, fp, now);
      if (claimed !== 'claimed') {
        throw new Cmp004Error('SF-APP-002');
      }
      await c.query(
        `INSERT INTO sf_identity.officer_principal (
           tenant_id, officer_id, idp_subject_hash, status, created_at, updated_at
         ) VALUES ($1,$2,$3,'ACTIVE',$4,$4)
         ON CONFLICT (tenant_id, officer_id) DO UPDATE SET updated_at = EXCLUDED.updated_at, status = 'ACTIVE'`,
        [claims.tenant_id, claims.officer_id, subjectHash, now.toISOString()],
      );
      await c.query(
        `INSERT INTO sf_identity.officer_session (
           tenant_id, session_id, officer_id, token_hash, status, assurance, role_codes, expires_at, created_at
         ) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8)`,
        [
          claims.tenant_id,
          sessionId,
          claims.officer_id,
          tokenHash,
          claims.assurance,
          claims.roles,
          expires.toISOString(),
          now.toISOString(),
        ],
      );
      await c.query(
        `INSERT INTO sf_identity.session_lookup (
           token_hash, session_id, actor_type, subject_id, tenant_id, assurance, status, expires_at
         ) VALUES ($1,$2,'OFFICER',$3,$4,$5,'ACTIVE',$6)`,
        [
          tokenHash,
          sessionId,
          claims.officer_id,
          claims.tenant_id,
          claims.assurance,
          expires.toISOString(),
        ],
      );
      await insertOutbox(
        c,
        envelopeOf({
          eventType: 'OfficerSessionIssued',
          tenantId: claims.tenant_id,
          cellId: tenantCtx.cell_id,
          aggregateType: 'OfficerSession',
          aggregateId: sessionId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: tenantCtx.correlation_id,
          actor: tenantCtx.actor,
          data: { session_id: sessionId, officer_id: claims.officer_id, simulation: true },
        }),
        TOPIC_DOMAIN,
      );
      await this.opts.audit.append(
        c,
        auditEvent(tenantCtx, {
          action: 'OFFICER_SESSION_ISSUE',
          actionClass: 'WRITE',
          resourceType: 'OfficerSession',
          resourceId: sessionId,
          result: 'SUCCESS',
          tenantId: claims.tenant_id,
          classification: 'TENANT_SCOPED',
          now,
        }),
      );
      const bodyOut = {
        session_token: token,
        officer_id: claims.officer_id,
        tenant_id: claims.tenant_id,
        expires_at: expires.toISOString(),
      };
      await completeIdempotency(c, {
        tenantId: claims.tenant_id,
        principalId: claims.officer_id,
        endpoint: 'officer.session',
        key: idempotencyKey ?? sessionId,
        status: 201,
        body: {
          officer_id: bodyOut.officer_id,
          tenant_id: bodyOut.tenant_id,
          expires_at: bodyOut.expires_at,
        },
      });
    });
    return {
      session_token: token,
      officer_id: claims.officer_id,
      tenant_id: claims.tenant_id,
      expires_at: expires.toISOString(),
    };
  }

  async revokeOfficerSession(ctx: RequestContext): Promise<{ ok: true }> {
    if (ctx.actor.type !== 'OFFICER' || ctx.tenant_id === null)
      throw new Cmp004Error('SF-AUTH-002');
    await authorize(this.opts.authorizer, {
      subject: {
        user_id: ctx.actor.id,
        actor_type: 'OFFICER',
        tenant_id: ctx.tenant_id,
        roles: ctx.roles,
        jurisdiction_ids: ctx.jurisdiction_ids,
        assurance: ctx.auth_assurance,
      },
      resource: {
        resource_type: 'OfficerSession',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'OFFICER_SESSION_REVOKE',
    });
    const now = this.opts.clock();
    await withContextTx(this.opts.pool, ctx, async (c) => {
      await c.query(
        `UPDATE sf_identity.officer_session SET status = 'REVOKED', revoked_at = $1
          WHERE tenant_id = $2 AND officer_id = $3 AND status = 'ACTIVE'`,
        [now.toISOString(), ctx.tenant_id, ctx.actor.id],
      );
      await c.query(
        `UPDATE sf_identity.session_lookup SET status = 'REVOKED'
          WHERE subject_id = $1 AND actor_type = 'OFFICER' AND tenant_id = $2 AND status = 'ACTIVE'`,
        [ctx.actor.id, ctx.tenant_id],
      );
      await this.opts.audit.append(
        c,
        auditEvent(ctx, {
          action: 'OFFICER_SESSION_REVOKE',
          actionClass: 'WRITE',
          resourceType: 'OfficerSession',
          resourceId: ctx.actor.id,
          result: 'SUCCESS',
          classification: 'TENANT_SCOPED',
          now,
        }),
      );
    });
    return { ok: true };
  }

  async me(ctx: RequestContext): Promise<{
    actor_type: string;
    subject_id: string;
    tenant_id: string | null;
    assurance: AuthAssurance;
    methods: string[];
  }> {
    if (ctx.actor.type === 'CITIZEN') {
      const methods = await withContextTx(this.opts.pool, ctx, async (c) => {
        const rows = await c.query<{ method: string }>(
          `SELECT method FROM sf_identity.identity_link WHERE citizen_id = $1 AND status = 'ACTIVE'`,
          [ctx.actor.id],
        );
        return rows.rows.map((r) => r.method);
      });
      return {
        actor_type: 'CITIZEN',
        subject_id: ctx.actor.id,
        tenant_id: null,
        assurance: ctx.auth_assurance,
        methods,
      };
    }
    if (ctx.actor.type === 'OFFICER') {
      return {
        actor_type: 'OFFICER',
        subject_id: ctx.actor.id,
        tenant_id: ctx.tenant_id,
        assurance: ctx.auth_assurance,
        methods: ['IDP'],
      };
    }
    throw new Cmp004Error('SF-AUTH-002');
  }

  private async claim(
    c: PoolClient,
    ctx: RequestContext,
    endpoint: string,
    key: string | undefined,
    fingerprint: string,
    now: Date,
  ) {
    return claimIdempotency(c, {
      tenantId: ctx.tenant_id,
      principalId: ctx.actor.id,
      endpoint,
      key: key ?? newId(),
      fingerprint,
      now,
    });
  }
}
