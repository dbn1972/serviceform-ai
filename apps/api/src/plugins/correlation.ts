import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CORRELATION_HEADER = 'x-correlation-id';

/** Fastify genReqId: reuse a well-formed inbound correlation id, otherwise mint one. */
export function correlationIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && UUID.test(value) ? value.toLowerCase() : randomUUID();
}

/** Echoes the correlation id on every response (AWS v1.7 s13.1 "Correlation"). */
export const correlation = fp(
  async (app: FastifyInstance) => {
    app.addHook('onRequest', async (request, reply) => {
      reply.header(CORRELATION_HEADER, request.id);
    });
  },
  { name: 'sf-correlation' },
);
