import {
  SAMPLE_LAB_LGD_DISTRICTS,
  SAMPLE_LAB_LGD_STATES,
  parseLgdCodeList,
} from '@serviceform/service-templates';
import {
  loadTenantOverlay,
  resolveTenantJurisdictionScope,
  saveTenantOverlay,
} from '@serviceform/service-templates/sample-lab-dummy-resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CATALOGUE_RE = /^IND-[A-Z]{3}-[0-9]{3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET ?tenant_id=&catalogue_id= — load overlay or SAMPLE_LAB defaults. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') ?? '';
  const catalogueId = (url.searchParams.get('catalogue_id') ?? '').toUpperCase();
  if (!UUID_RE.test(tenantId) || !CATALOGUE_RE.test(catalogueId)) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'tenant_id (UUID) and catalogue_id (IND-XXX-000) required',
    });
  }
  const overlay = loadTenantOverlay(tenantId, catalogueId);
  const scope = resolveTenantJurisdictionScope({
    catalogueId,
    tenantId,
    environmentLabel: 'SAMPLE_LAB',
  });
  return json(200, {
    overlay,
    scope,
    defaults: {
      allowed_states: [...SAMPLE_LAB_LGD_STATES],
      allowed_districts: [...SAMPLE_LAB_LGD_DISTRICTS],
    },
    certified: false,
    g6_issued: false,
  });
}

/** PUT — save tenant jurisdiction overlay for any catalogue offering. */
export async function PUT(request: Request) {
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) return json(400, { error_code: 'SF-SYS-003', message: 'JSON body required' });
  const tenantId = typeof raw['tenant_id'] === 'string' ? raw['tenant_id'] : '';
  const catalogueId =
    typeof raw['catalogue_id'] === 'string' ? raw['catalogue_id'].toUpperCase() : '';
  if (!UUID_RE.test(tenantId) || !CATALOGUE_RE.test(catalogueId)) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'tenant_id (UUID) and catalogue_id (IND-XXX-000) required',
    });
  }
  const jur = (raw['jurisdiction'] ?? {}) as Record<string, unknown>;
  const statesRaw =
    typeof jur['allowed_states'] === 'string'
      ? jur['allowed_states']
      : Array.isArray(jur['allowed_states'])
        ? (jur['allowed_states'] as string[]).join('\n')
        : '';
  const districtsRaw =
    typeof jur['allowed_districts'] === 'string'
      ? jur['allowed_districts']
      : Array.isArray(jur['allowed_districts'])
        ? (jur['allowed_districts'] as string[]).join('\n')
        : '';
  const allowed_states = parseLgdCodeList(statesRaw);
  const allowed_districts = parseLgdCodeList(districtsRaw);
  if (allowed_states.length < 1 || allowed_districts.length < 1) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Provide at least one LGD code for allowed_states and allowed_districts',
    });
  }
  try {
    const binding =
      typeof raw['tenant_service_binding_id'] === 'string' && raw['tenant_service_binding_id']
        ? raw['tenant_service_binding_id']
        : null;
    const overlay = saveTenantOverlay({
      tenant_id: tenantId,
      catalogue_id: catalogueId,
      environment_label: 'SAMPLE_LAB',
      jurisdiction: { allowed_states, allowed_districts },
      ...(binding ? { tenant_service_binding_id: binding } : {}),
    });
    return json(200, { overlay, certified: false, g6_issued: false });
  } catch (err) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: err instanceof Error ? err.message : 'overlay refused',
    });
  }
}
