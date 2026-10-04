import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY_KEY, requestFingerprint } from './domain/fingerprint.js';
import { Cmp013Error, detail } from './errors.js';
import {
  CREATE_POLICY_BODY,
  CREATE_SESSION_BODY,
  POLICY_CODE_PARAM,
  UUID_PARAM,
} from './schemas/http.js';
import type {
  Idempotency,
  PolicyInput,
  SessionInput,
  UploadService,
} from './service/upload-service.js';

function sendPrivate(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store');
}

function idempotency(request: FastifyRequest, endpoint: string): Idempotency {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw new Cmp013Error('SF-SYS-003', detail('IDEMPOTENCY_KEY'));
  }
  return { key, endpoint, fingerprint: requestFingerprint(request.method, endpoint, request.body) };
}

export function registerRoutes(app: FastifyInstance, service: UploadService): void {
  app.post<{ Body: PolicyInput }>(
    '/upload-policies',
    { schema: { body: CREATE_POLICY_BODY } },
    async (request, reply) => {
      const result = await service.createPolicyVersion(
        request.sfContext,
        request.body,
        idempotency(request, 'POST /v1/upload-policies'),
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Params: { code: string } }>(
    '/upload-policies/:code',
    { schema: { params: POLICY_CODE_PARAM } },
    async (request, reply) => {
      const policy = await service.getActivePolicy(request.sfContext, request.params.code);
      sendPrivate(reply);
      return policy;
    },
  );

  app.post<{ Body: SessionInput }>(
    '/documents/upload-sessions',
    { schema: { body: CREATE_SESSION_BODY } },
    async (request, reply) => {
      const result = await service.createUploadSession(
        request.sfContext,
        request.body,
        idempotency(request, 'POST /v1/documents/upload-sessions'),
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/documents/:id/complete',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const view = await service.completeUpload(request.sfContext, request.params.id);
      sendPrivate(reply);
      return view;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/documents/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const view = await service.getDocument(request.sfContext, request.params.id);
      sendPrivate(reply);
      return view;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/documents/:id/access',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const access = await service.issueAccess(request.sfContext, request.params.id);
      sendPrivate(reply);
      return access;
    },
  );
}
