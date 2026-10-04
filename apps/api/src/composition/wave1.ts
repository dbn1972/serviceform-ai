import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from '@serviceform/observability';
import type { RequestContext } from '@serviceform/contracts';

/**
 * Optional Wave 1 component mounts. Structural deps only — the host must not import
 * sibling component TypeScript graphs (their Fastify module augmentations conflict).
 * Plugins load via non-literal dynamic import so tsc does not merge those graphs.
 *
 * CMP-038 Event Bus has no end-user REST surface in M01 — process/library only.
 * Wave 2 CMP-003/030/032 mounts are a follow-up by this same envelope after those merges.
 */
export interface Wave1PluginMounts {
  /** CMP-048 PEP + request-context plugin (@serviceform/security). */
  security?: {
    verifier: { verify: (req: FastifyRequest) => Promise<unknown> };
    resolver: {
      resolve: (principal: unknown, opts: { cellId: string }) => Promise<RequestContext | null>;
    };
    pdp: { decide: (input: unknown) => Promise<unknown> };
    cellId: string;
    logger?: Logger;
    audit?: unknown;
    opaUrl?: string;
    authzRateLimit?: { max: number; windowMs: number };
  };
  /** CMP-002 Tenant & Government Organisation. */
  tenantOrganisation?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    audit?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-048 security platform command routes. */
  securityPlatform?: {
    pool: Pool;
    commands: unknown;
    prefix?: string;
  };
  /** CMP-031 Audit & Evidence Ledger. */
  audit?: {
    pool: Pool;
    resolveRequestContext: (headers: Record<string, unknown>) => RequestContext | null;
    logger: Logger;
    authz?: { decide: (input: unknown) => Promise<unknown> };
    clock?: () => Date;
    config?: unknown;
    platformSources?: readonly string[];
    prefix?: string;
  };
  /** CMP-037 Integration Hub. */
  integrationHub?: Record<string, unknown> & { prefix?: string };
}

async function loadModule<T>(specifier: string): Promise<T> {
  // Non-literal specifier → TypeScript does not pull the target into this program.
  return import(specifier) as Promise<T>;
}

/**
 * Registers merged Wave 1 Fastify plugins under Eng v1.4 `/v1` paths (PLAN-REVIEW X-10).
 * Call only from the API host — services must not import each other.
 */
export async function registerWave1Plugins(
  app: FastifyInstance,
  mounts: Wave1PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.security) {
    const mod = await loadModule<{
      sfSecurity: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/security');
    await app.register(mod.sfSecurity, mounts.security);
    mounted.push('CMP-048-security-pep');
  }

  if (mounts.tenantOrganisation) {
    const mod = await loadModule<{
      registerTenantOrganisation: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/cmp-002-tenant-organisation');
    await mod.registerTenantOrganisation(app, {
      prefix: '/v1',
      ...mounts.tenantOrganisation,
    });
    mounted.push('CMP-002');
  }

  if (mounts.securityPlatform) {
    const mod = await loadModule<{
      cmp048Plugin: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/cmp-048-security-platform');
    const prefix = mounts.securityPlatform.prefix ?? '/v1/security';
    await app.register(mod.cmp048Plugin, {
      prefix,
      pool: mounts.securityPlatform.pool,
      commands: mounts.securityPlatform.commands,
    });
    mounted.push('CMP-048');
  }

  if (mounts.audit) {
    const mod = await loadModule<{
      registerAuditPlugin: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/cmp-031-audit-ledger');
    await mod.registerAuditPlugin(app, {
      ...mounts.audit,
      prefix: mounts.audit.prefix ?? '/v1',
    });
    mounted.push('CMP-031');
  }

  if (mounts.integrationHub) {
    const mod = await loadModule<{
      registerIntegrationHub: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/cmp-037-integration-hub');
    await mod.registerIntegrationHub(app, {
      ...mounts.integrationHub,
      prefix: mounts.integrationHub.prefix ?? '/v1',
    });
    mounted.push('CMP-037');
  }

  return mounted;
}
