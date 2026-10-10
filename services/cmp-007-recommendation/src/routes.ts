import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY_KEY, requestFingerprint } from './domain/fingerprint.js';
import { Cmp007Error, detail } from './errors.js';
import {
  CREATE_POLICY_BODY,
  CREATE_RECOMMENDATION_BODY,
  DISPOSITION_BODY,
  UUID_PARAM,
} from './schemas/http.js';
import type {
  DispositionInput,
  Idempotency,
  PolicyInput,
  RecommendationInput,
  RecommendationService,
} from './service/recommendation-service.js';

function rejectUnknownFields(schema: { properties: Record<string, unknown> }) {
  const allowed = new Set(Object.keys(schema.properties));
  return async (request: FastifyRequest): Promise<void> => {
    const body = request.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) throw new Cmp007Error('SF-SYS-003', detail('UNKNOWN_FIELD'));
    }
  };
}

function sendPrivate(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store');
}

function idempotency(request: FastifyRequest, endpoint: string): Idempotency {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw new Cmp007Error('SF-SYS-003', detail('IDEMPOTENCY_KEY'));
  }
  return { key, endpoint, fingerprint: requestFingerprint(request.method, endpoint, request.body) };
}

export function registerRoutes(app: FastifyInstance, service: RecommendationService): void {
  app.post<{ Body: PolicyInput }>(
    '/recommendation-policies',
    {
      schema: { body: CREATE_POLICY_BODY },
      preValidation: rejectUnknownFields(CREATE_POLICY_BODY),
    },
    async (request, reply) => {
      const result = await service.createPolicy(
        request.sfContext,
        request.body,
        idempotency(request, 'POST /v1/recommendation-policies'),
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Body: RecommendationInput }>(
    '/recommendations',
    {
      schema: { body: CREATE_RECOMMENDATION_BODY },
      preValidation: rejectUnknownFields(CREATE_RECOMMENDATION_BODY),
    },
    async (request, reply) => {
      const result = await service.createRecommendation(
        request.sfContext,
        request.body,
        idempotency(request, 'POST /v1/recommendations'),
      );
      const body = result.body as { recommendation_id?: string; status?: string };
      if (body.recommendation_id) {
        request.log.info(service.logRecord(body.recommendation_id, String(body.status)));
      }
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/recommendations/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const view = await service.getRecommendation(request.sfContext, request.params.id);
      sendPrivate(reply);
      return view;
    },
  );

  app.post<{ Params: { id: string }; Body: DispositionInput }>(
    '/recommendations/:id/disposition',
    {
      schema: { params: UUID_PARAM, body: DISPOSITION_BODY },
      preValidation: rejectUnknownFields(DISPOSITION_BODY),
    },
    async (request, reply) => {
      const view = await service.dispose(request.sfContext, request.params.id, request.body);
      sendPrivate(reply);
      return view;
    },
  );
}
