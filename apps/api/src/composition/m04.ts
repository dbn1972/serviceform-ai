import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { DeploymentEnvironment, RequestContext } from '@serviceform/contracts';

/**
 * Optional M04 mounts: CMP-039 AI Gateway, CMP-008 Rules, CMP-011 Evidence,
 * CMP-013 Document Upload, CMP-009 Dynamic Forms, CMP-014 Document Intelligence.
 *
 * Same structural rules as Wave 1/2/M02/M03: non-literal dynamic import so the host does not
 * merge sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Package specifiers are preferred (stitch admits apps/api importers). File URLs are a
 * pre-lockfile fallback so host tests can load plugins without writing pnpm-lock.yaml
 * or apps/api/package.json in this envelope.
 *
 * CMP-036 API Gateway is already registered on the host in app.ts — do not remount it here.
 * Host composition does not construct provider SDKs, OCR vendors, or SQL across components.
 * CMP-014 inference is an AiGatewayPort only (CMP-039-facing); never a model provider SDK.
 */
export interface M04PluginMounts {
  /** CMP-039 AI Gateway. */
  aiGateway?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    providers?: unknown;
    consent?: unknown;
    sources?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-008 Eligibility / Rules Engine. */
  rules?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    rulePacks?: unknown;
    engine?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-011 Evidence & Document Requirement Engine. Upload/OCR/consent/binding/DigiLocker stay ports. */
  evidence?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    bindingPins: { resolveEvidencePin: (input: unknown) => Promise<unknown> };
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    approval?: unknown;
    uploads?: unknown;
    classification?: unknown;
    consent?: unknown;
    digiLocker?: unknown;
    digiLockerBinding?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /** CMP-013 Document Upload. Storage/scanner remain injected ports. */
  documentUpload?: {
    environment: DeploymentEnvironment;
    pool?: Pool;
    repository?: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    storage: unknown;
    scanner: unknown;
    workerActorId: string;
    clock?: () => Date;
    downloadTtlSeconds?: number;
    connectorBindings?: unknown[];
    prefix?: string;
  };
  /** CMP-009 Dynamic Forms. Form-definition and localization remain ports. */
  forms?: {
    pool: Pool;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer?: { decide: (input: unknown) => Promise<unknown> };
    forms?: unknown;
    localization?: unknown;
    config?: unknown;
    clock?: () => Date;
    prefix?: string;
  };
  /**
   * CMP-014 Document Intelligence. `gateway` is the CMP-039-facing AiGatewayPort.
   * Host must not supply a provider SDK here.
   */
  documentIntelligence?: {
    environment: DeploymentEnvironment;
    pool?: Pool;
    repository?: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    sources: unknown;
    sourceAcl: unknown;
    ocr: unknown;
    gateway: {
      invoke: (...args: unknown[]) => Promise<unknown>;
    };
    clock?: () => Date;
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
 * Registers M04 Fastify plugins under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other (no cross-component SQL).
 * Mount order: CMP-039, CMP-008, CMP-011, CMP-013, CMP-009, CMP-014.
 */
export async function registerM04Plugins(
  app: FastifyInstance,
  mounts: M04PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.aiGateway) {
    const mod = await loadModule<{
      registerAiGateway: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-039-ai-gateway',
        '../../../../services/cmp-039-ai-gateway/src/index.ts',
      ),
    );
    await mod.registerAiGateway(app, {
      prefix: '/v1',
      ...mounts.aiGateway,
    });
    mounted.push('CMP-039');
  }

  if (mounts.rules) {
    const mod = await loadModule<{
      registerRules: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-008-rules',
        '../../../../services/cmp-008-rules/src/index.ts',
      ),
    );
    await mod.registerRules(app, {
      prefix: '/v1',
      ...mounts.rules,
    });
    mounted.push('CMP-008');
  }

  if (mounts.evidence) {
    const mod = await loadModule<{
      registerEvidence: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-011-evidence-requirements',
        '../../../../services/cmp-011-evidence-requirements/src/index.ts',
      ),
    );
    await mod.registerEvidence(app, {
      prefix: '/v1',
      ...mounts.evidence,
    });
    mounted.push('CMP-011');
  }

  if (mounts.documentUpload) {
    const mod = await loadModule<{
      registerDocumentUpload: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-013-document-upload',
        '../../../../services/cmp-013-document-upload/src/index.ts',
      ),
    );
    await mod.registerDocumentUpload(app, {
      prefix: '/v1',
      ...mounts.documentUpload,
    });
    mounted.push('CMP-013');
  }

  if (mounts.forms) {
    const mod = await loadModule<{
      registerForms: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-009-dynamic-forms',
        '../../../../services/cmp-009-dynamic-forms/src/index.ts',
      ),
    );
    await mod.registerForms(app, {
      prefix: '/v1',
      ...mounts.forms,
    });
    mounted.push('CMP-009');
  }

  if (mounts.documentIntelligence) {
    const mod = await loadModule<{
      registerDocumentIntelligence: (instance: FastifyInstance, opts: unknown) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-014-document-intelligence',
        '../../../../services/cmp-014-document-intelligence/src/index.ts',
      ),
    );
    await mod.registerDocumentIntelligence(app, {
      prefix: '/v1',
      ...mounts.documentIntelligence,
    });
    mounted.push('CMP-014');
  }

  return mounted;
}
