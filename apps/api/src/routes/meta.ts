import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

/** Build/runtime identity for operators. Contains no tenant, user or secret data. */
export async function metaRoutes(app: FastifyInstance, opts: { config: AppConfig }): Promise<void> {
  const payload = {
    service: opts.config.SF_SERVICE_NAME,
    version: opts.config.SF_SERVICE_VERSION,
    environment: opts.config.SF_ENVIRONMENT,
    cell_id: opts.config.SF_CELL_ID,
  };
  app.get(
    '/v1/meta',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['service', 'version', 'environment', 'cell_id'],
            properties: {
              service: { type: 'string' },
              version: { type: 'string' },
              environment: { type: 'string' },
              cell_id: { type: 'string' },
            },
          },
        },
      },
    },
    async () => payload,
  );
}
