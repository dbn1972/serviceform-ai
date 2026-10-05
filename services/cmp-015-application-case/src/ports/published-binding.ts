import type { PinGraph } from '../domain/pins.js';

/**
 * Resolves the exact published TenantServiceBinding pin graph (CMP-001/CMP-052 publication plane)
 * through an API port. Clients never supply version ids directly; CMP-015 pins what publication
 * returns (Constitution #9).
 */
export interface PublishedBinding {
  tenant_service_binding_id: string;
  service_id: string;
  status: 'PUBLISHED';
  pins: PinGraph;
}

export interface PublishedBindingPort {
  resolve(params: {
    tenant_id: string;
    tenant_service_binding_id: string;
  }): Promise<PublishedBinding | null>;
}

export class DenyPublishedBindingPort implements PublishedBindingPort {
  async resolve(): Promise<PublishedBinding | null> {
    return null;
  }
}

/** LOCAL/CI only (config refuses SIMULATED in PRODUCTION). Tenant-keyed in-memory catalogue. */
export class SimulatedPublishedBindingPort implements PublishedBindingPort {
  readonly simulation = 'SIMULATED' as const;
  private readonly bindings = new Map<string, PublishedBinding>();

  put(tenantId: string, binding: PublishedBinding): void {
    this.bindings.set(`${tenantId}:${binding.tenant_service_binding_id}`, binding);
  }

  async resolve(params: {
    tenant_id: string;
    tenant_service_binding_id: string;
  }): Promise<PublishedBinding | null> {
    return this.bindings.get(`${params.tenant_id}:${params.tenant_service_binding_id}`) ?? null;
  }
}
