import { Cmp022Error, detail } from '../errors.js';
import type { TenantContext } from '../types.js';

export interface RenderRequest {
  credential_id: string;
  application_id: string;
  tenant_service_binding_id: string;
  service_version_id: string;
  credential_template_id: string;
  credential_template_version: number;
  /** Stable per credential: a retried render must return the same stored artifact. */
  idempotency_key: string;
}

/** Reference to bytes held by CMP-032. CMP-022 never receives or stores artifact bytes. */
export interface StoredArtifactRef {
  storage_key: string;
  sha256: string;
}

/**
 * Renders the pinned published credential template (CMP-033 metadata) for the application and
 * stores the result through CMP-032. Content and layout come only from the pinned template.
 */
export interface ArtifactRenderPort {
  render(ctx: TenantContext, req: RenderRequest): Promise<StoredArtifactRef>;
}

export class UnboundArtifactRenderPort implements ArtifactRenderPort {
  render(): Promise<StoredArtifactRef> {
    return Promise.reject(new Cmp022Error('SF-SYS-004', detail('RENDER_PORT_NOT_BOUND')));
  }
}
