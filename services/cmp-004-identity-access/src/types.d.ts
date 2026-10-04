import type { RequestContext } from '@serviceform/contracts';

declare module 'fastify' {
  interface FastifyContextConfig {
    sfPublic?: boolean;
  }
  interface FastifyRequest {
    sfContext?: RequestContext;
  }
}
