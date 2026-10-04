import type { ErrorResponse } from '@serviceform/contracts';
import { SecurityError } from '@serviceform/security';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { PlatformError } from '../errors.js';

function body(
  request: FastifyRequest,
  code: string,
  message: string,
  details?: ErrorResponse['details'],
): ErrorResponse {
  const out: ErrorResponse = { error_code: code, message, correlation_id: request.id };
  if (details && details.length > 0) out.details = details;
  return out;
}

/**
 * Maps every failure to the contracts ErrorResponse. Never exposes stack traces, SQL or raw
 * exception messages (AWS v1.7 s13.1 "Errors").
 */
export const errorHandler = fp(
  async (app: FastifyInstance) => {
    app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(404).send(body(request, 'SF-SYS-002', 'Resource or route not found'));
    });

    app.setErrorHandler(
      async (error: FastifyError | PlatformError | SecurityError, request, reply) => {
        if (error instanceof PlatformError || error instanceof SecurityError) {
          if (error.statusCode >= 500) request.log.error({ err: error }, 'platform error');
          return reply
            .code(error.statusCode)
            .send(body(request, error.code, error.message, error.details));
        }
        const fe = error as FastifyError;
        if (fe.validation) {
          const details = fe.validation.slice(0, 100).map((v) => ({
            code: v.keyword,
            pointer: `/${fe.validationContext ?? 'request'}${v.instancePath}`,
            ...(v.message ? { message: v.message } : {}),
          }));
          return reply
            .code(400)
            .send(body(request, 'SF-SYS-003', 'Request validation failed', details));
        }
        if (fe.statusCode === 429) {
          return reply.code(429).send(body(request, 'SF-RATE-001', 'Rate limit exceeded'));
        }
        if (fe.statusCode === 503) {
          return reply
            .code(503)
            .send(body(request, 'SF-SYS-004', 'Service temporarily unavailable'));
        }
        if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
          // Client errors raised by Fastify itself (malformed JSON, body too large, ...).
          return reply
            .code(fe.statusCode)
            .send(body(request, 'SF-SYS-003', 'Request validation failed'));
        }
        request.log.error({ err: error }, 'unhandled error');
        return reply.code(500).send(body(request, 'SF-SYS-001', 'Unexpected server error'));
      },
    );
  },
  { name: 'sf-error-handler' },
);
