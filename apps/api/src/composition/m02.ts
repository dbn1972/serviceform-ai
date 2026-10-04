import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type {
  ConnectorBinding,
  DeploymentEnvironment,
  RequestContext,
} from '@serviceform/contracts';

/**
 * Optional M02 component mounts (CMP-004 Identity & Access, CMP-005 Citizen Profile).
 * Same structural rules as Wave 1/2: non-literal dynamic import so the host does not merge
 * sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Package specifiers are preferred (stitch admits apps/api importers). File URLs are a
 * pre-lockfile fallback so host tests can load merged Wave A plugins without writing
 * pnpm-lock.yaml or apps/api/package.json in this envelope.
 *
 * SF-M03-008 mounts (catalogue/metadata/studio) are intentionally absent.
 */
export interface M02PluginMounts {
  /** CMP-004 Identity & Access. */
  identityAccess?: {
    commands: unknown;
    verifier: { verify: (req: FastifyRequest) => Promise<unknown> };
    resolveContext: {
      resolve: (principal: unknown, opts: { cellId: string }) => Promise<RequestContext | null>;
    };
    cellId: string;
    rateLimitMax?: number;
    rateLimitWindowMs?: number;
    prefix?: string;
  };
  /** CMP-005 Citizen Profile. */
  citizenProfile?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    consentAccess: {
      check: (input: unknown) => Promise<{ allowed: boolean; reason_code: string }>;
    };
    subjectDirectory: { exists: (input: unknown) => Promise<boolean> };
    audit?: unknown;
    clock?: () => Date;
    deploymentEnvironment: DeploymentEnvironment;
    digiLockerBinding: ConnectorBinding;
    digiLocker?: unknown;
    rateLimitMax?: number;
    rateLimitWindowMs?: number;
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
 * Registers M02 Fastify plugins under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other (no cross-component SQL).
 */
export async function registerM02Plugins(
  app: FastifyInstance,
  mounts: M02PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.identityAccess) {
    const mod = await loadModule<{
      registerIdentityAccess: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-004-identity-access',
        '../../../../services/cmp-004-identity-access/src/index.ts',
      ),
    );
    await mod.registerIdentityAccess(app, {
      prefix: '/v1',
      ...mounts.identityAccess,
    });
    mounted.push('CMP-004');
  }

  if (mounts.citizenProfile) {
    const mod = await loadModule<{
      registerCitizenProfile: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-005-citizen-profile',
        '../../../../services/cmp-005-citizen-profile/src/index.ts',
      ),
    );
    await mod.registerCitizenProfile(app, {
      prefix: '/v1',
      ...mounts.citizenProfile,
    });
    mounted.push('CMP-005');
  }

  return mounted;
}
