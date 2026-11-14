import { createHash } from 'node:crypto';

/** Structural subset of CMP-009 `PublishedFormDefinition` / `FormDefinitionRequest`. */
export interface PublishedFormLike {
  tenant_id: string;
  form_key: string;
  version_id: string;
  content_hash: string;
  status: 'PUBLISHED';
  payload: unknown;
}

export interface FormRequestLike {
  tenantId: string;
  formKey: string;
  versionId: string;
  contentHash: string;
  correlationId: string;
}

export interface FormSourceLike {
  resolve(request: FormRequestLike): Promise<PublishedFormLike>;
}

/** CMP-033 `readPublishedDocument`, bound to CMP-033's own pool by the host. */
export type PublishedDocumentReader = (input: {
  tenantId: string;
  documentId: string;
  kind: 'FORM';
}) => Promise<{ document_id: string; payload: unknown } | null>;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function canonicalSha256(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(sortKeys(value)), 'utf8')
    .digest('hex')}`;
}

/**
 * SF-M10-C-1 CMP-009 FormDefinitionPort for the SAMPLE_LAB host: the SIMULATED template catalogue
 * first, then Studio forms frozen in CMP-033 (PUBLISHED, immutable). The version id of a Studio
 * form is its CMP-033 document id. The content hash is recomputed from the stored package rather
 * than trusted, so a pin only matches the exact bytes that were validated; CMP-009 then compares
 * it with the caller's pin and refuses any mismatch (SF-FORM-001).
 */
export class StudioPublishedFormPort implements FormSourceLike {
  constructor(
    private readonly deps: {
      catalogue: FormSourceLike;
      read: PublishedDocumentReader;
      isNotFound: (err: unknown) => boolean;
      notFound: () => Error;
    },
  ) {}

  /** Resolve a Studio FORM by CMP-033 document id (version pin), ignoring catalogue keys. */
  async resolveStudioVersion(
    tenantId: string,
    versionId: string,
  ): Promise<PublishedFormLike | null> {
    const doc = await this.deps.read({
      tenantId,
      documentId: versionId,
      kind: 'FORM',
    });
    const payload = doc?.payload as { form_package?: unknown } | undefined;
    const pkg = payload?.form_package as { form_id?: unknown } | undefined;
    if (!doc || !pkg || typeof pkg !== 'object' || typeof pkg.form_id !== 'string') {
      return null;
    }
    return {
      tenant_id: tenantId,
      form_key: pkg.form_id,
      version_id: doc.document_id,
      content_hash: canonicalSha256(pkg),
      status: 'PUBLISHED',
      payload: pkg,
    };
  }

  async resolve(request: FormRequestLike): Promise<PublishedFormLike> {
    try {
      return await this.deps.catalogue.resolve(request);
    } catch (err) {
      if (!this.deps.isNotFound(err)) throw err;
    }
    const studio = await this.resolveStudioVersion(request.tenantId, request.versionId);
    if (!studio) throw this.deps.notFound();
    return studio;
  }
}
