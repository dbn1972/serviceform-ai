import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { RequestContext } from '@serviceform/contracts';

/**
 * Optional Wave 2 component mounts (CMP-003 / CMP-030 / CMP-032).
 * Same structural rules as Wave 1: non-literal dynamic import so the host does not
 * merge sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Phase B of SF-M01-W2-004 — completed on the Wave 2 stitch branch after peer merges.
 */
export interface Wave2PluginMounts {
  /** CMP-003 Jurisdiction Engine. */
  jurisdiction?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    audit?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-030 Consent & Privacy. */
  consentPrivacy?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    audit?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-032 Storage (SIMULATED/local object store by default inside the plugin). */
  storage?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    store?: unknown;
    kms?: unknown;
    secrets?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
}

async function loadModule<T>(specifier: string): Promise<T> {
  // Non-literal specifier → TypeScript does not pull the target into this program.
  return import(specifier) as Promise<T>;
}

/**
 * Registers Wave 2 Fastify plugins under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other.
 */
export async function registerWave2Plugins(
  app: FastifyInstance,
  mounts: Wave2PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.jurisdiction) {
    const mod = await loadModule<{
      registerJurisdiction: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/cmp-003-jurisdiction');
    await mod.registerJurisdiction(app, {
      prefix: '/v1',
      ...mounts.jurisdiction,
    });
    mounted.push('CMP-003');
  }

  if (mounts.consentPrivacy) {
    const mod = await loadModule<{
      registerConsentPrivacy: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/cmp-030-consent-privacy');
    await mod.registerConsentPrivacy(app, {
      prefix: '/v1',
      ...mounts.consentPrivacy,
    });
    mounted.push('CMP-030');
  }

  if (mounts.storage) {
    const mod = await loadModule<{
      registerStorage: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>('@serviceform/cmp-032-storage');
    await mod.registerStorage(app, {
      prefix: '/v1',
      ...mounts.storage,
    });
    mounted.push('CMP-032');
  }

  return mounted;
}
