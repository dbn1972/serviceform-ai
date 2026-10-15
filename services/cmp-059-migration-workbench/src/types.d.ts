import type { RequestContext } from '@serviceform/contracts';

declare module 'fastify' {
  interface FastifyRequest {
    sfContext?: RequestContext;
  }
}
