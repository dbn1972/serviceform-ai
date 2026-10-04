import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { RequestContext } from '@serviceform/contracts';
import { SecurityError } from '@serviceform/security';

function requireCtx(req: FastifyRequest): RequestContext {
  if (!req.sfContext) throw new SecurityError('SF-TEN-001', { statusCode: 401 });
  return req.sfContext;
}
import type { PrivilegedAccessCommands } from './privileged-access/commands.js';
import { activatePolicy, registerPolicy } from './policy-metadata/commands.js';
import { reportIncident } from './incidents.js';
import type { Pool } from 'pg';

export interface Cmp048Options {
  prefix?: string;
  pool: Pool;
  commands: PrivilegedAccessCommands;
}

export const cmp048Plugin = fp(async (app: FastifyInstance, opts: Cmp048Options) => {
  const p = opts.prefix ?? '';

  app.post(`${p}/privileged-access`, {
    config: {
      sfAuthz: {
        action: 'PRIVILEGED_ACCESS_REQUEST',
        resource: (req) => ({
          resource_type: 'PrivilegedAccess',
          tenant_id: req.sfContext?.tenant_id ?? null,
          classification: 'TENANT_SCOPED' as const,
        }),
      },
    },
    handler: async (req) => {
      const key = req.headers['idempotency-key'];
      return opts.commands.request(
        requireCtx(req),
        req.body as Parameters<PrivilegedAccessCommands['request']>[1],
        typeof key === 'string' ? key : undefined,
      );
    },
  });

  app.post(`${p}/privileged-access/:id/approve`, {
    config: {
      sfAuthz: {
        action: 'PRIVILEGED_ACCESS_APPROVE',
        resource: (req) => ({
          resource_type: 'PrivilegedAccess',
          tenant_id: req.sfContext?.tenant_id ?? null,
          classification: 'TENANT_SCOPED' as const,
        }),
      },
    },
    handler: async (req) =>
      opts.commands.approve(requireCtx(req), (req.params as { id: string }).id),
  });

  app.post(`${p}/privileged-access/:id/revoke`, {
    config: {
      sfAuthz: {
        action: 'PRIVILEGED_ACCESS_REVOKE',
        resource: (req) => ({
          resource_type: 'PrivilegedAccess',
          tenant_id: req.sfContext?.tenant_id ?? null,
          classification: 'TENANT_SCOPED' as const,
        }),
      },
    },
    handler: async (req) => {
      await opts.commands.revoke(requireCtx(req), (req.params as { id: string }).id);
      return { ok: true };
    },
  });

  app.post(`${p}/privileged-access/:id/review`, {
    config: {
      sfAuthz: {
        action: 'PRIVILEGED_ACCESS_REVIEW',
        resource: (req) => ({
          resource_type: 'PrivilegedAccess',
          tenant_id: req.sfContext?.tenant_id ?? null,
          classification: 'TENANT_SCOPED' as const,
        }),
      },
    },
    handler: async (req) => {
      await opts.commands.review(
        requireCtx(req),
        (req.params as { id: string }).id,
        (req.body as { outcome: string }).outcome,
      );
      return { ok: true };
    },
  });

  app.post(`${p}/policy-revisions`, {
    config: {
      sfAuthz: {
        action: 'SECURITY_POLICY_REGISTER',
        resource: () => ({
          resource_type: 'SecurityPolicy',
          tenant_id: null,
          classification: 'PLATFORM_OPERATIONAL' as const,
        }),
      },
    },
    handler: async (req) =>
      registerPolicy(opts.pool, requireCtx(req), req.body as Parameters<typeof registerPolicy>[2]),
  });

  app.post(`${p}/policy-revisions/:id/activate`, {
    config: {
      sfAuthz: {
        action: 'SECURITY_POLICY_ACTIVATE',
        resource: () => ({
          resource_type: 'SecurityPolicy',
          tenant_id: null,
          classification: 'PLATFORM_OPERATIONAL' as const,
        }),
      },
    },
    handler: async (req) => {
      await activatePolicy(opts.pool, requireCtx(req), (req.params as { id: string }).id);
      return { ok: true };
    },
  });

  app.post(`${p}/incidents`, {
    config: {
      sfAuthz: {
        action: 'SECURITY_INCIDENT_REPORT',
        resource: (req) => ({
          resource_type: 'SecurityIncident',
          tenant_id: req.sfContext?.tenant_id ?? null,
          classification: req.sfContext?.tenant_id
            ? ('TENANT_SCOPED' as const)
            : ('PLATFORM_OPERATIONAL' as const),
        }),
      },
    },
    handler: async (req) =>
      reportIncident(opts.pool, requireCtx(req), req.body as Parameters<typeof reportIncident>[2]),
  });
});
