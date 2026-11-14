import { validateDisplayName } from '@serviceform/m10-sample-lab/identity-rules';
import {
  formPin,
  publishedVersion,
  templateByCatalogueId,
  type CertificateTemplate,
  type FormSchemaNode,
  type TemplateVersion,
} from '@serviceform/service-templates';
import {
  offeringFor,
  platform,
  portalPlacement,
  type Citizen,
  type PlatformResponse,
  type PortalOffering,
} from './platform';

/**
 * Citizen BFF → CMP-009 (CCR-M10-002). The published form comes from the Studio template
 * catalogue through a SIMULATED publication (CMP-052 replaces it in slice B-4); the host's CMP-009
 * serves the same pinned version and refuses a pin whose id or content hash differs.
 */
export const FORM_LOCALE = 'en-IN';
/** Person-name semantic elements (applicant, guardian, parents, informant). */
const PERSON_NAME = /^SF-SEM-[A-Z-]*NAME$/;

export interface OfferedForm {
  template: CertificateTemplate;
  version: TemplateVersion;
  offering: PortalOffering;
}

export function offeredForm(catalogueId: string): OfferedForm | null {
  const offering = offeringFor(catalogueId);
  const template = offering ? templateByCatalogueId(catalogueId) : null;
  const version = template ? publishedVersion(template) : null;
  return offering && template && version ? { template, version, offering } : null;
}

export function sampleLab(): boolean {
  return portalPlacement().environment_label === 'SAMPLE_LAB';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pointers of every field whose semantic element id matches. */
export function semanticPointers(schema: FormSchemaNode, match: RegExp, base = ''): string[] {
  return Object.entries(schema.properties ?? {}).flatMap(([name, node]) => {
    const pointer = `${base}/${name}`;
    return [
      ...(node.semanticElementId && match.test(node.semanticElementId) ? [pointer] : []),
      ...(node.type === 'object' ? semanticPointers(node, match, pointer) : []),
    ];
  });
}

function valueAt(data: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .filter(Boolean)
    .reduce<unknown>(
      (cur, p) => (isRecord(cur) && Object.hasOwn(cur, p) ? cur[p] : undefined),
      data,
    );
}

/** SAMPLE_LAB refuses non-synthetic person names server-side (Phase A finding L-2). */
export function syntheticNameRefusal(
  schema: FormSchemaNode,
  data: Record<string, unknown>,
): { field: string; message: string } | null {
  for (const pointer of semanticPointers(schema, PERSON_NAME)) {
    const value = valueAt(data, pointer);
    if (typeof value !== 'string' || value.trim() === '') continue;
    const message = validateDisplayName(value.trim());
    if (message) return { field: pointer.slice(1).replaceAll('/', '.'), message };
  }
  return null;
}

/** The apply body is `{ catalogue_id, data }`; a bare form object is read as IND-SOC-002 data. */
export function applyBody(raw: unknown): { catalogueId: string; data: Record<string, unknown> } {
  if (isRecord(raw) && isRecord(raw['data'])) {
    const id = typeof raw['catalogue_id'] === 'string' ? raw['catalogue_id'] : 'IND-SOC-002';
    return { catalogueId: id, data: raw['data'] };
  }
  return { catalogueId: 'IND-SOC-002', data: isRecord(raw) ? raw : {} };
}

export type FormPin = { form_key: string; version_id: string; content_hash: string };

/** Live TSB / Studio form pin (CMP-033) when the published binding no longer matches the catalogue. */
export async function studioFormPin(citizen: Citizen, versionId: string): Promise<FormPin | null> {
  const res = await platform('GET', `/v1/lab/form-pins/${versionId}`, { token: citizen.token });
  if (res.status !== 200) return null;
  const key = res.body['form_key'];
  const id = res.body['version_id'];
  const hash = res.body['content_hash'];
  if (typeof key !== 'string' || typeof id !== 'string' || typeof hash !== 'string') return null;
  return { form_key: key, version_id: id, content_hash: hash };
}

export function pinFor(version: TemplateVersion): FormPin {
  return formPin(version);
}

/**
 * Resolve the form pin the placement binding will pin cases to — without creating a draft.
 * Prefers Studio (CMP-033) when the live TSB form version differs from the catalogue pin.
 */
export async function liveOfferingFormPin(
  citizen: Citizen,
  catalogueId: string,
  catalogue: FormPin,
): Promise<FormPin> {
  const res = await platform('GET', `/v1/lab/offerings/${catalogueId}/form-pin`, {
    token: citizen.token,
  });
  if (res.status !== 200 || typeof res.body['version_id'] !== 'string') return catalogue;
  const versionId = res.body['version_id'] as string;
  if (versionId === catalogue.version_id) return catalogue;
  if (
    res.body['source'] === 'CMP-033' &&
    typeof res.body['form_key'] === 'string' &&
    typeof res.body['content_hash'] === 'string'
  ) {
    return {
      form_key: res.body['form_key'] as string,
      version_id: versionId,
      content_hash: res.body['content_hash'] as string,
    };
  }
  return (await studioFormPin(citizen, versionId)) ?? catalogue;
}

export async function interpret(
  citizen: Citizen,
  pin: FormPin,
  data: Record<string, unknown>,
): Promise<PlatformResponse> {
  return platform('POST', '/v1/interpretations', {
    token: citizen.token,
    body: { form: pin, data, locale: FORM_LOCALE },
  });
}

export interface FormIssue {
  code: string;
  pointer: string;
}

export type ValidationOutcome =
  | { ok: true; execution: { execution_id: string; data_hash: string; result_code: 'VALID' } }
  | { ok: false; issues: FormIssue[] }
  | { ok: false; res: PlatformResponse };

/** Authoritative CMP-009 execution. Any status other than 201/422 fails closed. */
export async function validateWithEngine(
  citizen: Citizen,
  pin: FormPin,
  data: Record<string, unknown>,
  idempotency: { idempotencyKey: string } | { idempotent: true },
): Promise<ValidationOutcome> {
  const res = await platform('POST', '/v1/executions', {
    token: citizen.token,
    ...idempotency,
    body: { form: pin, data, purpose_code: 'APPLICATION_SUBMIT', locale: FORM_LOCALE },
  });
  if (res.status === 201 && res.body['result_code'] === 'VALID') {
    return {
      ok: true,
      execution: {
        execution_id: String(res.body['execution_id']),
        data_hash: String(res.body['data_hash']),
        result_code: 'VALID',
      },
    };
  }
  if (res.status === 422 && Array.isArray(res.body['details'])) {
    const issues = (res.body['details'] as unknown[]).filter(
      (d): d is FormIssue =>
        isRecord(d) && typeof d['code'] === 'string' && typeof d['pointer'] === 'string',
    );
    return { ok: false, issues };
  }
  return { ok: false, res };
}
