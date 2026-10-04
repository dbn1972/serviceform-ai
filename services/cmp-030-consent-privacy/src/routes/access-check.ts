import type { FastifyInstance } from 'fastify';
import { withContextTx } from '../db/tx.js';
import { evaluateAccessCheck } from '../domain/access-check.js';
import { Cmp030Error } from '../errors.js';
import { getLatestConsent, getPurposeByCode } from '../repositories/consent.repo.js';
import { ACCESS_CHECK_BODY } from '../schemas/http.js';
import { decide, requireTenant, sendPrivate, writeDenied, type RouteDeps } from './helpers.js';

export function registerAccessCheckRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Body: { subject_id: string; purpose_code: string } }>(
    '/privacy/access-check',
    { schema: { body: ACCESS_CHECK_BODY } },
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
          action: 'PRIVACY_ACCESS_CHECK',
        });
      } catch (err) {
        if (err instanceof Cmp030Error && err.code === 'SF-AUTH-002') {
          await writeDenied(
            deps,
            ctx,
            request,
            'PRIVACY_ACCESS_CHECK',
            'Consent',
            request.body.subject_id,
          );
        }
        throw err;
      }

      const body = await withContextTx(deps.pool, ctx, async (tx) => {
        const purpose = await getPurposeByCode(tx, tenantId, request.body.purpose_code);
        const latest = purpose
          ? await getLatestConsent(tx, tenantId, request.body.subject_id, purpose.purpose_id)
          : null;
        const decision = evaluateAccessCheck({
          purposeStatus: purpose?.status ?? null,
          requiresConsent: purpose?.requires_consent ?? null,
          consentStatus: latest?.status ?? null,
        });
        return {
          allowed: decision.allowed,
          reason_code: decision.reason_code,
          purpose_id: purpose?.purpose_id ?? null,
          consent_id: latest?.consent_id ?? null,
          consent_status: latest?.status ?? null,
        };
      });
      sendPrivate(reply);
      return body;
    },
  );
}
