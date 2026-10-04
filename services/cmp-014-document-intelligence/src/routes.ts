import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY_KEY, requestFingerprint } from './domain/fingerprint.js';
import { Cmp014Error, detail } from './errors.js';
import { CREATE_JOB_BODY, CREATE_POLICY_BODY, REVIEW_BODY, UUID_PARAM } from './schemas/http.js';
import type {
  Idempotency,
  IntelligenceService,
  JobInput,
  PolicyInput,
  ReviewInput,
} from './service/intelligence-service.js';

function sendPrivate(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store');
}

function idempotency(request: FastifyRequest, endpoint: string): Idempotency {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw new Cmp014Error('SF-SYS-003', detail('IDEMPOTENCY_KEY'));
  }
  return { key, endpoint, fingerprint: requestFingerprint(request.method, endpoint, request.body) };
}

export function registerRoutes(app: FastifyInstance, service: IntelligenceService): void {
  app.post<{ Body: PolicyInput }>(
    '/extraction-policies',
    { schema: { body: CREATE_POLICY_BODY } },
    async (request, reply) => {
      const result = await service.createPolicy(
        request.sfContext,
        request.body,
        idempotency(request, 'POST /v1/extraction-policies'),
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Body: JobInput }>(
    '/intelligence-jobs',
    { schema: { body: CREATE_JOB_BODY } },
    async (request, reply) => {
      const result = await service.createJob(
        request.sfContext,
        request.body,
        idempotency(request, 'POST /v1/intelligence-jobs'),
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/intelligence-jobs/:id/process',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const view = await service.processJob(request.sfContext, request.params.id);
      request.log.info(
        service.logRecord(view.job_id, view.status, view.rejection_code ?? undefined),
      );
      sendPrivate(reply);
      return view;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/intelligence-jobs/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const view = await service.getJob(request.sfContext, request.params.id);
      sendPrivate(reply);
      return view;
    },
  );

  app.post<{ Params: { id: string }; Body: ReviewInput }>(
    '/intelligence-jobs/:id/review',
    { schema: { params: UUID_PARAM, body: REVIEW_BODY } },
    async (request, reply) => {
      const view = await service.reviewJob(request.sfContext, request.params.id, request.body);
      sendPrivate(reply);
      return view;
    },
  );
}
