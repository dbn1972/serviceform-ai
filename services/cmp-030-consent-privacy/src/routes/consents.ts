import type { FastifyInstance } from 'fastify';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { withContextTx } from '../db/tx.js';
import { Cmp030Error } from '../errors.js';
import {
  getConsent,
  getNotice,
  getPurposeById,
  insertConsent,
  insertConsentEvent,
  listConsents,
  serializeConsent,
  withdrawConsent,
} from '../repositories/consent.repo.js';
import {
  GRANT_CONSENT_BODY,
  LIST_CONSENTS_QUERY,
  UUID_PARAM,
  WITHDRAW_BODY,
} from '../schemas/http.js';
import {
  decide,
  requireTenant,
  runCommand,
  sendPrivate,
  withWriteAudit,
  writeDenied,
  type RouteDeps,
} from './helpers.js';

type GrantBody = {
  subject_id: string;
  purpose_id: string;
  notice_id?: string;
  channel: 'WEB' | 'COUNTER' | 'API';
  representation_basis?: 'SELF' | 'ASSISTED' | 'LEGAL_REP';
  applied_for?: string;
};

export function registerConsentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Body: GrantBody }>(
    '/consents',
    { schema: { body: GRANT_CONSENT_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      try {
        await decide(deps, ctx, {
          subject: {
            user_id: ctx.actor.id,
            actor_type: ctx.actor.type,
            tenant_id: ctx.tenant_id,
            roles: ctx.roles,
            jurisdiction_ids: ctx.jurisdiction_ids,
          },
          resource: {
            resource_type: 'Consent',
            tenant_id: ctx.tenant_id,
            classification: 'TENANT_SCOPED',
          },
          action: 'CONSENT_GRANT',
        });
      } catch (err) {
        if (err instanceof Cmp030Error && err.code === 'SF-AUTH-002') {
          await writeDenied(deps, ctx, request, 'CONSENT_GRANT', 'Consent', tenantId);
        }
        throw err;
      }

      const appliedFor = request.body.applied_for ?? request.body.subject_id;
      if (appliedFor !== request.body.subject_id) {
        throw new Cmp030Error('SF-SYS-003', {
          details: [{ code: 'APPLIED_FOR_SUBJECT_MISMATCH' }],
        });
      }
      let basis = request.body.representation_basis;
      if (!basis) {
        basis = ctx.actor.id === request.body.subject_id ? 'SELF' : 'ASSISTED';
      }
      if (basis === 'SELF' && ctx.actor.id !== request.body.subject_id) {
        throw new Cmp030Error('SF-AUTH-002', {
          details: [{ code: 'SELF_REQUIRES_SUBJECT_ACTOR' }],
        });
      }

      const now = deps.clock();
      const result = await runCommand(deps, request, ctx, 'POST /v1/consents', async (tx) => {
        const purpose = await getPurposeById(tx, tenantId, request.body.purpose_id);
        if (!purpose || purpose.status !== 'ACTIVE') throw new Cmp030Error('SF-SYS-002');
        if (request.body.notice_id) {
          const notice = await getNotice(tx, tenantId, request.body.notice_id);
          if (!notice || notice.status !== 'PUBLISHED') throw new Cmp030Error('SF-SYS-002');
          if (notice.purpose_id !== request.body.purpose_id) {
            throw new Cmp030Error('SF-SYS-003', { details: [{ code: 'NOTICE_PURPOSE_MISMATCH' }] });
          }
        }
        const row = await insertConsent(tx, {
          tenantId,
          subjectId: request.body.subject_id,
          purposeId: request.body.purpose_id,
          noticeId: request.body.notice_id ?? null,
          appliedBy: ctx.actor.id,
          appliedFor,
          representationBasis: basis,
          channel: request.body.channel,
          now,
        });
        await insertConsentEvent(tx, {
          tenantId,
          consentId: row.consent_id,
          eventType: 'GRANTED',
          occurredAt: now,
          actorId: ctx.actor.id,
          correlationId: ctx.correlation_id,
          noticeId: row.notice_id,
        });
        const env = envelopeOf({
          eventType: 'ConsentGranted',
          tenantId,
          cellId: ctx.cell_id,
          aggregateType: 'Consent',
          aggregateId: row.consent_id,
          aggregateVersion: Number(row.version),
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            consent_id: row.consent_id,
            subject_id: row.subject_id,
            purpose_id: row.purpose_id,
            notice_id: row.notice_id,
            representation_basis: row.representation_basis,
            channel: row.channel,
            granted_at: row.granted_at.toISOString(),
          },
        });
        await insertOutbox(tx, env, TOPIC_DOMAIN);
        await withWriteAudit(deps, ctx, tx, {
          action: 'CONSENT_GRANT',
          actionClass: 'WRITE',
          resourceType: 'Consent',
          resourceId: row.consent_id,
          result: 'SUCCESS',
          now,
        });
        return { status: 201, body: serializeConsent(row) };
      });
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Querystring: { subject_id: string; purpose_id?: string } }>(
    '/consents',
    { schema: { querystring: LIST_CONSENTS_QUERY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      await decide(deps, ctx, {
        subject: {
          user_id: ctx.actor.id,
          actor_type: ctx.actor.type,
          tenant_id: ctx.tenant_id,
          roles: ctx.roles,
          jurisdiction_ids: ctx.jurisdiction_ids,
        },
        resource: {
          resource_type: 'Consent',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CONSENT_READ',
      });
      const rows = await withContextTx(deps.pool, ctx, async (tx) =>
        listConsents(tx, {
          tenantId,
          subjectId: request.query.subject_id,
          ...(request.query.purpose_id ? { purposeId: request.query.purpose_id } : {}),
        }),
      );
      sendPrivate(reply);
      return { items: rows.map(serializeConsent) };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason_code?: string } }>(
    '/consents/:id/withdraw',
    { schema: { params: UUID_PARAM, body: WITHDRAW_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      try {
        await decide(deps, ctx, {
          subject: {
            user_id: ctx.actor.id,
            actor_type: ctx.actor.type,
            tenant_id: ctx.tenant_id,
            roles: ctx.roles,
            jurisdiction_ids: ctx.jurisdiction_ids,
          },
          resource: {
            resource_type: 'Consent',
            tenant_id: ctx.tenant_id,
            classification: 'TENANT_SCOPED',
          },
          action: 'CONSENT_WITHDRAW',
        });
      } catch (err) {
        if (err instanceof Cmp030Error && err.code === 'SF-AUTH-002') {
          await writeDenied(deps, ctx, request, 'CONSENT_WITHDRAW', 'Consent', request.params.id);
        }
        throw err;
      }
      const now = deps.clock();
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/consents/${request.params.id}/withdraw`,
        async (tx) => {
          const before = await getConsent(tx, tenantId, request.params.id);
          if (!before) throw new Cmp030Error('SF-SYS-002');
          const alreadyWithdrawn = before.status === 'WITHDRAWN';
          const row = await withdrawConsent(tx, {
            tenantId,
            consentId: request.params.id,
            now,
          });
          if (!alreadyWithdrawn) {
            await insertConsentEvent(tx, {
              tenantId,
              consentId: row.consent_id,
              eventType: 'WITHDRAWN',
              occurredAt: now,
              actorId: ctx.actor.id,
              correlationId: ctx.correlation_id,
              noticeId: row.notice_id,
            });
            const env = envelopeOf({
              eventType: 'ConsentWithdrawn',
              tenantId,
              cellId: ctx.cell_id,
              aggregateType: 'Consent',
              aggregateId: row.consent_id,
              aggregateVersion: Number(row.version),
              occurredAt: now.toISOString(),
              correlationId: ctx.correlation_id,
              actor: ctx.actor,
              data: {
                consent_id: row.consent_id,
                subject_id: row.subject_id,
                purpose_id: row.purpose_id,
                withdrawn_at: row.withdrawn_at?.toISOString() ?? now.toISOString(),
                reason_code: request.body?.reason_code ?? 'WITHDRAWN',
              },
            });
            await insertOutbox(tx, env, TOPIC_DOMAIN);
            await withWriteAudit(deps, ctx, tx, {
              action: 'CONSENT_WITHDRAW',
              actionClass: 'WRITE',
              resourceType: 'Consent',
              resourceId: row.consent_id,
              result: 'SUCCESS',
              reason: request.body?.reason_code ?? 'WITHDRAWN',
              now,
            });
          }
          return { status: 200, body: serializeConsent(row) };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
