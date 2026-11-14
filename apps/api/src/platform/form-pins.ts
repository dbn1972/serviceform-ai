import type { RequestContext } from '@serviceform/contracts';
import type { PublishedBindingPort } from '@serviceform/cmp-015-application-case';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { StudioPublishedFormPort } from './forms.js';

/**
 * SAMPLE_LAB helpers: resolve CMP-009 form pins for Studio-published versions / live TSB
 * offerings so the citizen BFF can validate against the pin cases will actually use.
 */
export async function registerFormPinRoutes(
  app: FastifyInstance,
  opts: {
    forms: StudioPublishedFormPort | null;
    bindings: PublishedBindingPort;
    /** catalogue_id → placement tenant_service_binding_id */
    offerings: Map<string, string>;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  },
): Promise<void> {
  const unauthorized = (request: FastifyRequest) => ({
    error_code: 'SF-AUTH-001',
    message: 'Authentication required',
    correlation_id: request.id,
  });

  app.get<{ Params: { versionId: string } }>(
    '/v1/lab/form-pins/:versionId',
    async (request, reply) => {
      const ctx = await opts.resolveContext(request);
      if (!ctx || !ctx.tenant_id) return reply.code(401).send(unauthorized(request));
      if (!opts.forms) {
        return reply.code(404).send({
          error_code: 'SF-SYS-002',
          message: 'Studio form pins are not mounted',
          correlation_id: ctx.correlation_id,
        });
      }
      const form = await opts.forms.resolveStudioVersion(ctx.tenant_id, request.params.versionId);
      if (!form) {
        return reply.code(404).send({
          error_code: 'SF-SYS-002',
          message: 'Published form not found',
          correlation_id: ctx.correlation_id,
        });
      }
      return reply.code(200).header('cache-control', 'no-store').send({
        form_key: form.form_key,
        version_id: form.version_id,
        content_hash: form.content_hash,
        source: 'CMP-033',
      });
    },
  );

  app.get<{ Params: { catalogueId: string } }>(
    '/v1/lab/offerings/:catalogueId/form-pin',
    async (request, reply) => {
      const ctx = await opts.resolveContext(request);
      if (!ctx || !ctx.tenant_id) return reply.code(401).send(unauthorized(request));
      const bindingId = opts.offerings.get(request.params.catalogueId);
      if (!bindingId) {
        return reply.code(404).send({
          error_code: 'SF-SYS-002',
          message: 'Service not offered here',
          correlation_id: ctx.correlation_id,
        });
      }
      const binding = await opts.bindings.resolve({
        tenant_id: ctx.tenant_id,
        tenant_service_binding_id: bindingId,
      });
      const formVersionId = binding?.pins.form_version_id;
      if (!formVersionId) {
        return reply.code(404).send({
          error_code: 'SF-SYS-002',
          message: 'Published binding has no form pin',
          correlation_id: ctx.correlation_id,
        });
      }
      if (opts.forms) {
        const studio = await opts.forms.resolveStudioVersion(ctx.tenant_id, formVersionId);
        if (studio) {
          return reply.code(200).header('cache-control', 'no-store').send({
            form_key: studio.form_key,
            version_id: studio.version_id,
            content_hash: studio.content_hash,
            source: 'CMP-033',
            tenant_service_binding_id: binding.tenant_service_binding_id,
          });
        }
      }
      return reply.code(200).header('cache-control', 'no-store').send({
        version_id: formVersionId,
        source: 'BINDING',
        tenant_service_binding_id: binding.tenant_service_binding_id,
      });
    },
  );
}
