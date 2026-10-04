import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type {
  ConnectorBinding,
  DeploymentEnvironment,
  RequestContext,
} from '@serviceform/contracts';

/**
 * Optional M03 control-plane mounts: CMP-001 catalogue, CMP-033 metadata,
 * CMP-034 master data, CMP-051 maker-checker, CMP-052 versioning, CMP-053 localization.
 *
 * Same structural rules as Wave 1/2/M02: non-literal dynamic import so the host does not
 * merge sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Package specifiers are preferred (stitch admits apps/api importers). File URLs are a
 * pre-lockfile fallback so host tests can load plugins without writing pnpm-lock.yaml
 * or apps/api/package.json in this envelope.
 *
 * CMP-050 Studio portal is a Next.js/session library with no Fastify register API —
 * keep it out of this host (SF-M03-007). CMP-054 UX4G is a React design package
 * (`@serviceform/ui-ux4g`) with no Fastify plugin — not mounted here.
 */
export interface M03PluginMounts {
  /** CMP-001 Service Catalogue & Registry. */
  catalogue?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    audit?: unknown;
    clock?: () => Date;
    connectorBindings?: unknown[];
    prefix?: string;
  };
  /** CMP-033 Metadata / Configuration Service. */
  metadata?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    registry?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-034 Master Data Service. */
  masterData?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    audit?: unknown;
    clock?: () => Date;
    environment?: string;
    importPort?: unknown;
    prefix?: string;
  };
  /** CMP-051 Maker-Checker / Publishing Service. */
  makerChecker?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    metadata?: unknown;
    versioning?: unknown;
    ai?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-052 Versioning & Configuration Registry. */
  versioning?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    approval?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-053 Localization Service. */
  localization?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    audit?: unknown;
    clock?: () => Date;
    deploymentEnvironment?: DeploymentEnvironment;
    assistBinding?: ConnectorBinding | null;
    assist?: unknown;
    prefix?: string;
  };
}

async function loadModule<T>(specifiers: readonly string[]): Promise<T> {
  // Non-literal specifier → TypeScript does not pull the target into this program.
  let last: unknown;
  for (const specifier of specifiers) {
    try {
      return (await import(specifier)) as T;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function workspaceSpecifiers(pkg: string, srcIndexFromHere: string): string[] {
  return [pkg, new URL(srcIndexFromHere, import.meta.url).href];
}

/**
 * Registers M03 Fastify plugins under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other (no cross-component SQL).
 */
export async function registerM03Plugins(
  app: FastifyInstance,
  mounts: M03PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.catalogue) {
    const mod = await loadModule<{
      registerCatalogue: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-001-catalogue',
        '../../../../services/cmp-001-catalogue/src/index.ts',
      ),
    );
    await mod.registerCatalogue(app, {
      prefix: '/v1',
      ...mounts.catalogue,
    });
    mounted.push('CMP-001');
  }

  if (mounts.metadata) {
    const mod = await loadModule<{
      registerMetadata: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-033-metadata',
        '../../../../services/cmp-033-metadata/src/index.ts',
      ),
    );
    await mod.registerMetadata(app, {
      prefix: '/v1',
      ...mounts.metadata,
    });
    mounted.push('CMP-033');
  }

  if (mounts.masterData) {
    const mod = await loadModule<{
      registerMasterData: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-034-master-data',
        '../../../../services/cmp-034-master-data/src/index.ts',
      ),
    );
    await mod.registerMasterData(app, {
      prefix: '/v1',
      ...mounts.masterData,
    });
    mounted.push('CMP-034');
  }

  if (mounts.makerChecker) {
    const mod = await loadModule<{
      registerMakerChecker: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-051-maker-checker',
        '../../../../services/cmp-051-maker-checker/src/index.ts',
      ),
    );
    await mod.registerMakerChecker(app, {
      prefix: '/v1',
      ...mounts.makerChecker,
    });
    mounted.push('CMP-051');
  }

  if (mounts.versioning) {
    const mod = await loadModule<{
      registerVersioning: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-052-versioning',
        '../../../../services/cmp-052-versioning/src/index.ts',
      ),
    );
    await mod.registerVersioning(app, {
      prefix: '/v1',
      ...mounts.versioning,
    });
    mounted.push('CMP-052');
  }

  if (mounts.localization) {
    const mod = await loadModule<{
      registerLocalization: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-053-localization',
        '../../../../services/cmp-053-localization/src/index.ts',
      ),
    );
    await mod.registerLocalization(app, {
      prefix: '/v1',
      ...mounts.localization,
    });
    mounted.push('CMP-053');
  }

  return mounted;
}
