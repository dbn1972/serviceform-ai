import type { FastifyInstance } from 'fastify';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { withContextTx } from '../db/tx.js';
import { isKnownClaim } from '../domain/claim-catalog.js';
import { assertBindingSafe, requireSimulationMarker } from '../domain/connector-guard.js';
import { valueSha256 } from '../domain/fingerprint.js';
import { canExposeClaimValues, evaluateProvenance } from '../domain/provenance.js';
import { assertNoOpenTransaction } from '../domain/txn-guard.js';
import { Cmp005Error } from '../errors.js';
import {
  definitionExists,
  ensureProfile,
  getClaim,
  getProfile,
  insertClaim,
  listClaims,
  serializeProfile,
  updateClaim,
} from '../repositories/profile.repo.js';
import { IMPORT_BODY, PURPOSE_QUERY, UPSERT_CLAIMS_BODY, UUID_PARAM } from '../schemas/http.js';
import {
  decide,
  requireConsent,
  requireTenant,
  runCommand,
  sendPrivate,
  withWriteAudit,
  writeDenied,
  type RouteDeps,
} from './helpers.js';

type UpsertBody = {
  purpose_code: string;
  claims: { section_code: string; claim_code: string; value_text: string }[];
};

type ImportBody = { purpose_code: string; scenario: string; test_run_id: string };

async function authorizeProfile(
  deps: RouteDeps,
  request: Parameters<typeof writeDenied>[2],
  ctx: Parameters<typeof decide>[1],
  action: string,
  subjectId: string,
): Promise<void> {
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
        resource_type: 'CitizenProfile',
        tenant_id: ctx.tenant_id,
        classification: 'CITIZEN_PRIVATE',
        owner_id: subjectId,
      },
      action,
    });
  } catch (err) {
    if (err instanceof Cmp005Error && err.code === 'SF-AUTH-002') {
      await writeDenied(deps, ctx, request, action, 'CitizenProfile', subjectId);
    }
    throw err;
  }
}

export function registerProfileRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.put<{ Params: { subjectId: string } }>(
    '/profiles/:subjectId',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      const subjectId = request.params.subjectId;
      if (ctx.actor.type === 'CITIZEN' && ctx.actor.id !== subjectId) {
        throw new Cmp005Error('SF-AUTH-002');
      }
      await authorizeProfile(deps, request, ctx, 'PROFILE_WRITE', subjectId);
      const exists = await deps.subjectDirectory.exists({
        tenant_id: tenantId,
        subject_id: subjectId,
      });
      if (!exists) throw new Cmp005Error('SF-SYS-002');
      const now = deps.clock();
      const result = await runCommand(
        deps,
        request,
        ctx,
        'PUT /v1/profiles/:subjectId',
        async (tx) => {
          const profile = await ensureProfile(tx, {
            tenantId,
            subjectId,
            actorId: ctx.actor.id,
            now,
          });
          const env = envelopeOf({
            eventType: 'ProfileEnsured',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'CitizenProfile',
            aggregateId: profile.profile_id,
            aggregateVersion: Number(profile.version),
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: { profile_id: profile.profile_id, subject_id: subjectId },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'PROFILE_WRITE',
            actionClass: 'WRITE',
            resourceType: 'CitizenProfile',
            resourceId: profile.profile_id,
            result: 'SUCCESS',
            now,
          });
          return {
            status: 200,
            body: { profile_id: profile.profile_id, subject_id: subjectId, status: profile.status },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Params: { subjectId: string }; Querystring: { purpose_code: string } }>(
    '/profiles/:subjectId',
    { schema: { params: UUID_PARAM, querystring: PURPOSE_QUERY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      const subjectId = request.params.subjectId;
      if (ctx.actor.type === 'CITIZEN' && ctx.actor.id !== subjectId) {
        throw new Cmp005Error('SF-AUTH-002');
      }
      await authorizeProfile(deps, request, ctx, 'PROFILE_READ', subjectId);
      await requireConsent(
        deps,
        tenantId,
        subjectId,
        request.query.purpose_code,
        ctx.correlation_id,
      );
      const body = await withContextTx(deps.pool, ctx, async (tx) => {
        const profile = await getProfile(tx, tenantId, subjectId);
        if (!profile) throw new Cmp005Error('SF-SYS-002');
        const claims = await listClaims(tx, tenantId, profile.profile_id);
        const include = canExposeClaimValues({
          actorId: ctx.actor.id,
          actorType: ctx.actor.type,
          subjectId,
          consentAllowed: true,
        });
        return serializeProfile(profile, claims, include);
      });
      sendPrivate(reply);
      return body;
    },
  );

  app.put<{ Params: { subjectId: string }; Body: UpsertBody }>(
    '/profiles/:subjectId/claims',
    { schema: { params: UUID_PARAM, body: UPSERT_CLAIMS_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      const subjectId = request.params.subjectId;
      if (ctx.actor.type === 'CITIZEN' && ctx.actor.id !== subjectId) {
        throw new Cmp005Error('SF-AUTH-002');
      }
      await authorizeProfile(deps, request, ctx, 'PROFILE_WRITE', subjectId);
      await requireConsent(
        deps,
        tenantId,
        subjectId,
        request.body.purpose_code,
        ctx.correlation_id,
      );
      const sourceKind = ctx.actor.type === 'CITIZEN' ? 'SELF' : 'OFFICER';
      const now = deps.clock();
      const result = await runCommand(
        deps,
        request,
        ctx,
        'PUT /v1/profiles/:subjectId/claims',
        async (tx) => {
          const profile = await ensureProfile(tx, {
            tenantId,
            subjectId,
            actorId: ctx.actor.id,
            now,
          });
          const written: string[] = [];
          for (const claim of request.body.claims) {
            if (!isKnownClaim(claim.section_code, claim.claim_code)) {
              throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'UNKNOWN_CLAIM_CODE' }] });
            }
            const known = await definitionExists(tx, claim.section_code, claim.claim_code);
            if (!known)
              throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'UNKNOWN_CLAIM_CODE' }] });
            const existing = await getClaim(
              tx,
              tenantId,
              profile.profile_id,
              claim.section_code,
              claim.claim_code,
            );
            const decision = evaluateProvenance({
              existingStatus: existing?.verification_status ?? null,
              nextSourceKind: sourceKind,
              nextStatus: 'UNVERIFIED',
            });
            if (decision !== 'ACCEPT') {
              throw new Cmp005Error('SF-SYS-003', { details: [{ code: decision }] });
            }
            const sha = valueSha256(claim.value_text);
            const row = existing
              ? await updateClaim(tx, {
                  tenantId,
                  claimId: existing.claim_id,
                  valueSha: sha,
                  valueText: claim.value_text,
                  sourceKind,
                  connectorType: null,
                  verification: 'UNVERIFIED',
                  purposeCode: request.body.purpose_code,
                  sourceRef: null,
                  verifiedAt: null,
                  simulation: null,
                  now,
                })
              : await insertClaim(tx, {
                  tenantId,
                  profileId: profile.profile_id,
                  subjectId,
                  section: claim.section_code,
                  code: claim.claim_code,
                  valueSha: sha,
                  valueText: claim.value_text,
                  sourceKind,
                  connectorType: null,
                  verification: 'UNVERIFIED',
                  purposeCode: request.body.purpose_code,
                  sourceRef: null,
                  verifiedAt: null,
                  simulation: null,
                  now,
                });
            written.push(row.claim_id);
            const env = envelopeOf({
              eventType: 'ProfileClaimUpserted',
              tenantId,
              cellId: ctx.cell_id,
              aggregateType: 'CitizenProfile',
              aggregateId: profile.profile_id,
              aggregateVersion: Number(row.version),
              occurredAt: now.toISOString(),
              correlationId: ctx.correlation_id,
              actor: ctx.actor,
              data: {
                claim_id: row.claim_id,
                section_code: row.section_code,
                claim_code: row.claim_code,
                value_sha256: row.value_sha256,
                source_kind: row.source_kind,
                verification_status: row.verification_status,
              },
            });
            await insertOutbox(tx, env, TOPIC_DOMAIN);
          }
          await withWriteAudit(deps, ctx, tx, {
            action: 'PROFILE_WRITE',
            actionClass: 'WRITE',
            resourceType: 'CitizenProfile',
            resourceId: profile.profile_id,
            result: 'SUCCESS',
            now,
          });
          return { status: 200, body: { profile_id: profile.profile_id, claim_ids: written } };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { subjectId: string }; Body: ImportBody }>(
    '/profiles/:subjectId/verified-claims/import',
    { schema: { params: UUID_PARAM, body: IMPORT_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      const subjectId = request.params.subjectId;
      if (ctx.actor.type === 'CITIZEN' && ctx.actor.id !== subjectId) {
        throw new Cmp005Error('SF-AUTH-002');
      }
      await authorizeProfile(deps, request, ctx, 'PROFILE_IMPORT_VERIFIED', subjectId);
      await requireConsent(
        deps,
        tenantId,
        subjectId,
        request.body.purpose_code,
        ctx.correlation_id,
      );
      assertBindingSafe(deps.digiLockerBinding, deps.deploymentEnvironment, tenantId);
      if (deps.digiLockerBinding.mode !== 'SIMULATED') {
        throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'ONLY_SIMULATED_IN_M02' }] });
      }
      const marker = requireSimulationMarker({
        environment: deps.deploymentEnvironment,
        scenario: request.body.scenario,
        testRunId: request.body.test_run_id,
        connectorBindingId: deps.digiLockerBinding.connector_binding_id,
      });
      assertNoOpenTransaction();
      const fetched = await deps.digiLocker.fetchVerifiedClaims({
        subject_id: subjectId,
        scenario: request.body.scenario,
        test_run_id: request.body.test_run_id,
      });
      const now = deps.clock();
      const result = await runCommand(
        deps,
        request,
        ctx,
        'POST /v1/profiles/:subjectId/verified-claims/import',
        async (tx) => {
          const profile = await ensureProfile(tx, {
            tenantId,
            subjectId,
            actorId: ctx.actor.id,
            now,
          });
          const claimIds: string[] = [];
          for (const claim of fetched.claims) {
            if (!isKnownClaim(claim.section_code, claim.claim_code)) {
              throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'UNKNOWN_CLAIM_CODE' }] });
            }
            const existing = await getClaim(
              tx,
              tenantId,
              profile.profile_id,
              claim.section_code,
              claim.claim_code,
            );
            const sha = valueSha256(claim.value_text);
            const row = existing
              ? await updateClaim(tx, {
                  tenantId,
                  claimId: existing.claim_id,
                  valueSha: sha,
                  valueText: claim.value_text,
                  sourceKind: 'CONNECTOR',
                  connectorType: 'DIGILOCKER',
                  verification: 'VERIFIED',
                  purposeCode: request.body.purpose_code,
                  sourceRef: claim.source_ref,
                  verifiedAt: now,
                  simulation: marker,
                  now,
                })
              : await insertClaim(tx, {
                  tenantId,
                  profileId: profile.profile_id,
                  subjectId,
                  section: claim.section_code,
                  code: claim.claim_code,
                  valueSha: sha,
                  valueText: claim.value_text,
                  sourceKind: 'CONNECTOR',
                  connectorType: 'DIGILOCKER',
                  verification: 'VERIFIED',
                  purposeCode: request.body.purpose_code,
                  sourceRef: claim.source_ref,
                  verifiedAt: now,
                  simulation: marker,
                  now,
                });
            claimIds.push(row.claim_id);
          }
          const env = envelopeOf({
            eventType: 'VerifiedClaimsImported',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'CitizenProfile',
            aggregateId: profile.profile_id,
            aggregateVersion: Number(profile.version),
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              profile_id: profile.profile_id,
              subject_id: subjectId,
              claim_ids: claimIds,
              simulation: true,
              connector_binding_id: marker.connector_binding_id,
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'PROFILE_IMPORT_VERIFIED',
            actionClass: 'WRITE',
            resourceType: 'CitizenProfile',
            resourceId: profile.profile_id,
            result: 'SUCCESS',
            now,
          });
          return {
            status: 200,
            body: {
              profile_id: profile.profile_id,
              claim_ids: claimIds,
              simulation: marker,
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
