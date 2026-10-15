import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { RiskAssessmentService } from '../service/risk-assessment-service.js';
import { Cmp060Error } from '../errors.js';
import { isUuid } from '../context.js';
import type { CreateRiskAssessmentCommand, RecordDispositionCommand } from '../domain/types.js';
import type { TenantAuthzPort } from '../ports/tenant-authz.js';
import type { ReviewRoutingPort } from '../ports/review-routing.js';
import { DenyAllTenantAuthz } from '../ports/tenant-authz.js';

export interface RiskRouteOptions {
  pool: Pool;
  resolveContext: ContextResolver;
  authz?: TenantAuthzPort;
  reviewRouting?: ReviewRoutingPort | null;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof Cmp060Error) {
    return reply.status(err.statusCode).send({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? [],
      },
    });
  }
  return reply.status(500).send({
    error: { code: 'SF-SYS-001', message: 'Internal error', details: [] },
  });
}

/**
 * Fastify route registration for CMP-060.
 * Host mount is deferred to SF-M09-HOST; this package exports the registrar only.
 *
 * Routes (world-class-extensions + SF-CON-RISK-ASSESSMENT):
 * - POST /v1/risk/assessments          — evaluate / create advisory assessment
 * - GET  /v1/risk/assessments/:id      — read assessment
 * - POST /v1/risk/assessments/:id/review — record human disposition (INT-018)
 */
export function registerRiskRoutes(fastify: FastifyInstance, opts: RiskRouteOptions): void {
  // Fail closed: missing authz port must deny (never SimulatedAllowAllTenantAuthz).
  // Hosts must inject an OPA-backed TenantAuthzPort; SimulatedAllowAll is unit-test only.
  const authz = opts.authz ?? new DenyAllTenantAuthz();
  const svc = new RiskAssessmentService(opts.pool, authz, opts.reviewRouting ?? null);

  fastify.post('/v1/risk/assessments', async (request, reply) => {
    try {
      assertNoTenantIdentifyingHeaders(request.headers);
      const ctx = requireTenantContext(await opts.resolveContext(request.headers));
      const body = (request.body ?? {}) as Record<string, unknown>;

      // INT-011: reject caller-supplied tenant_id in body
      if ('tenant_id' in body) {
        throw new Cmp060Error('SF-TEN-002', {
          details: [{ code: 'TENANT_IN_BODY_FORBIDDEN', pointer: '/tenant_id' }],
        });
      }

      const subjectApplicationId = body.subject_application_id;
      const idempotencyKey = body.idempotency_key;
      if (typeof subjectApplicationId !== 'string' || !isUuid(subjectApplicationId)) {
        throw new Cmp060Error('SF-SYS-003', {
          details: [
            { code: 'SUBJECT_APPLICATION_ID_REQUIRED', pointer: '/subject_application_id' },
          ],
        });
      }
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
        throw new Cmp060Error('SF-SYS-003', {
          details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED', pointer: '/idempotency_key' }],
        });
      }

      const actorType = (
        ['CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN'] as const
      ).includes(ctx.actor.type as CreateRiskAssessmentCommand['actor_type'])
        ? (ctx.actor.type as CreateRiskAssessmentCommand['actor_type'])
        : 'SYSTEM';

      const cmd: CreateRiskAssessmentCommand = {
        tenant_id: ctx.tenant_id,
        assessment_id:
          typeof body.assessment_id === 'string' && isUuid(body.assessment_id)
            ? body.assessment_id
            : randomUUID(),
        subject_application_id: subjectApplicationId,
        cell_id: ctx.cell_id,
        idempotency_key: idempotencyKey,
        correlation_id: ctx.correlation_id,
        signals: Array.isArray(body.signals)
          ? (body.signals as CreateRiskAssessmentCommand['signals'])
          : [],
        raw_risk_score: typeof body.raw_risk_score === 'number' ? body.raw_risk_score : null,
        model_or_rule_version:
          typeof body.model_or_rule_version === 'string' ? body.model_or_rule_version : null,
        actor_type: actorType,
        requested_by: ctx.actor.id,
      };

      const result = await svc.createAssessment(cmd);
      return reply.status(201).send(result);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/v1/risk/assessments/:assessmentId', async (request, reply) => {
    try {
      assertNoTenantIdentifyingHeaders(request.headers);
      const ctx = requireTenantContext(await opts.resolveContext(request.headers));
      const params = request.params as { assessmentId: string };
      if (!isUuid(params.assessmentId)) {
        throw new Cmp060Error('SF-SYS-003', {
          details: [{ code: 'ASSESSMENT_ID_INVALID', pointer: '/assessmentId' }],
        });
      }
      const result = await svc.getAssessment({
        tenant_id: ctx.tenant_id,
        cell_id: ctx.cell_id,
        assessment_id: params.assessmentId,
        actor_id: ctx.actor.id,
        actor_type: ctx.actor.type,
      });
      return reply.status(200).send(result);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post(
    '/v1/risk/assessments/:assessmentId/review',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        assertNoTenantIdentifyingHeaders(request.headers);
        const ctx = requireTenantContext(await opts.resolveContext(request.headers));
        const params = request.params as { assessmentId: string };
        const body = (request.body ?? {}) as Record<string, unknown>;

        if ('tenant_id' in body) {
          throw new Cmp060Error('SF-TEN-002', {
            details: [{ code: 'TENANT_IN_BODY_FORBIDDEN', pointer: '/tenant_id' }],
          });
        }
        if (!isUuid(params.assessmentId)) {
          throw new Cmp060Error('SF-SYS-003', {
            details: [{ code: 'ASSESSMENT_ID_INVALID', pointer: '/assessmentId' }],
          });
        }

        const disposition = body.disposition;
        if (
          disposition !== 'CLEARED' &&
          disposition !== 'ESCALATED' &&
          disposition !== 'REFERRED_ENFORCEMENT'
        ) {
          throw new Cmp060Error('SF-SYS-003', {
            details: [{ code: 'DISPOSITION_REQUIRED', pointer: '/disposition' }],
          });
        }

        const cmd: RecordDispositionCommand & { cell_id: string } = {
          tenant_id: ctx.tenant_id,
          cell_id: ctx.cell_id,
          assessment_id: params.assessmentId,
          disposition_id:
            typeof body.disposition_id === 'string' && isUuid(body.disposition_id)
              ? body.disposition_id
              : randomUUID(),
          disposition,
          disposition_note:
            typeof body.disposition_note === 'string' ? body.disposition_note : null,
          disposed_by: ctx.actor.id,
          correlation_id: ctx.correlation_id,
        };

        await svc.recordDisposition(cmd);
        return reply.status(200).send({
          status: 'DISPOSITION_RECORDED',
          authoritative_decision_by_this_component: false,
          invented_statutory_policy_forbidden: true,
        });
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );
}
