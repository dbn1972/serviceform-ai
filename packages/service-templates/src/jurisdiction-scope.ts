import type { FormSchemaNode } from './types';
import { SAMPLE_LAB_ENVIRONMENT, sampleLabDummyAllowed } from './sample-lab-dummy';

/**
 * Tenant/offering geographic scope (Constitution §2–§3).
 * Codes are LGD-like identifiers — never hard-coded place *names* in domain logic.
 * Levels: state / district / municipality (ULB / local body).
 * Applies to every catalogue offering (Certificate, Licence, Permit, Registration, …).
 */

export const STATE_SEMANTIC_ID = 'SF-SEM-ADDR-STATE-CODE';
export const DISTRICT_SEMANTIC_ID = 'SF-SEM-ADDR-DISTRICT';
export const MUNICIPALITY_SEMANTIC_ID = 'SF-SEM-ADDR-MUNICIPALITY';

/** SAMPLE_LAB synthetic LGD-like codes (starting defaults; tenants override via overlay). */
export const SAMPLE_LAB_LGD_STATES = [
  'LGD-S-01',
  'LGD-S-02',
  'LGD-S-03',
  'LGD-S-04',
  'LGD-S-05',
  'LGD-S-06',
  'LGD-S-07',
  'LGD-S-08',
  'LGD-S-09',
  'LGD-S-10',
] as const;

export const SAMPLE_LAB_LGD_DISTRICTS = [
  'LGD-D-0101',
  'LGD-D-0102',
  'LGD-D-0201',
  'LGD-D-0202',
  'LGD-D-0301',
  'LGD-D-0302',
  'LGD-D-0401',
  'LGD-D-0402',
  'LGD-D-0501',
  'LGD-D-0502',
] as const;

/** SAMPLE_LAB synthetic LGD local-body / ULB codes (municipality). */
export const SAMPLE_LAB_LGD_MUNICIPALITIES = [
  'LGD-U-010101',
  'LGD-U-010102',
  'LGD-U-020101',
  'LGD-U-020102',
  'LGD-U-030101',
  'LGD-U-030102',
  'LGD-U-040101',
  'LGD-U-040102',
  'LGD-U-050101',
  'LGD-U-050102',
] as const;

const LGD_CODE_RE = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;

export interface JurisdictionScope {
  allowed_states: readonly string[];
  allowed_districts: readonly string[];
  allowed_municipalities: readonly string[];
}

export type JurisdictionScopeIssue = {
  code:
    'JURISDICTION_SCOPE_EMPTY' | 'JURISDICTION_SCOPE_INVALID_CODE' | 'JURISDICTION_OUT_OF_SCOPE';
  pointer: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const code = item.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

export function isLgdLikeCode(value: string): boolean {
  return LGD_CODE_RE.test(value);
}

/** Extract scope from resolved owner-config / tenant overlay `jurisdiction` object. */
export function extractJurisdictionScope(ownerConfig: Record<string, unknown>): JurisdictionScope {
  const jurisdiction = isRecord(ownerConfig['jurisdiction']) ? ownerConfig['jurisdiction'] : {};
  return {
    allowed_states: normalizeCodes(jurisdiction['allowed_states']),
    allowed_districts: normalizeCodes(jurisdiction['allowed_districts']),
    allowed_municipalities: normalizeCodes(jurisdiction['allowed_municipalities']),
  };
}

/**
 * Fail-closed when any allowed list is empty outside SAMPLE_LAB.
 * Inside SAMPLE_LAB, empty lists fall back to sample LGD codes (still not statute).
 */
export function resolveJurisdictionScope(
  ownerConfig: Record<string, unknown> | null | undefined,
  environmentLabel: string | undefined | null = SAMPLE_LAB_ENVIRONMENT,
): JurisdictionScope {
  const extracted = extractJurisdictionScope(ownerConfig ?? {});
  const states = [...extracted.allowed_states];
  const districts = [...extracted.allowed_districts];
  const municipalities = [...extracted.allowed_municipalities];

  if (states.length === 0 || districts.length === 0 || municipalities.length === 0) {
    if (!sampleLabDummyAllowed(environmentLabel)) {
      throw new Error(
        'Jurisdiction scope refused: allowed_states/allowed_districts/allowed_municipalities empty outside SAMPLE_LAB (fail-closed)',
      );
    }
    return {
      allowed_states: states.length > 0 ? states : [...SAMPLE_LAB_LGD_STATES],
      allowed_districts: districts.length > 0 ? districts : [...SAMPLE_LAB_LGD_DISTRICTS],
      allowed_municipalities:
        municipalities.length > 0 ? municipalities : [...SAMPLE_LAB_LGD_MUNICIPALITIES],
    };
  }

  for (const code of [...states, ...districts, ...municipalities]) {
    if (!isLgdLikeCode(code)) {
      throw new Error(`Jurisdiction scope refused: invalid LGD-like code ${code}`);
    }
  }

  return {
    allowed_states: states,
    allowed_districts: districts,
    allowed_municipalities: municipalities,
  };
}

function cloneNode(node: FormSchemaNode): FormSchemaNode {
  return JSON.parse(JSON.stringify(node)) as FormSchemaNode;
}

function labelsFor(codes: readonly string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const code of codes) labels[code] = code;
  return labels;
}

function enumCodes(node: FormSchemaNode): string[] {
  return Array.isArray(node.enum)
    ? node.enum.filter((v): v is string => typeof v === 'string').map((v) => v.toUpperCase())
    : [];
}

/** True when the field is LGD-code shaped (pattern or already enum), not free-text district. */
function isCodeConstrainedField(node: FormSchemaNode): boolean {
  if (enumCodes(node).length > 0) return true;
  return typeof node.pattern === 'string' && node.pattern.length > 0;
}

/**
 * Effective allowed codes for a field: intersect tenant scope with a frozen form enum when present.
 * If the published form enum does not overlap the overlay/default LGD set (e.g. Residence OD/XX),
 * keep the form enum so SAMPLE_LAB PUBLISHED pins stay usable until a new version uses LGD codes.
 */
export function effectiveAllowedCodes(
  field: FormSchemaNode,
  scopeCodes: readonly string[],
): string[] | null {
  if (!isCodeConstrainedField(field)) return null;
  const existing = enumCodes(field);
  if (existing.length === 0) return [...scopeCodes];
  const scopeSet = new Set(scopeCodes.map((c) => c.toUpperCase()));
  const inter = existing.filter((c) => scopeSet.has(c));
  return inter.length > 0 ? inter : existing;
}

/**
 * Constrain address state/district/municipality choice lists from tenant scope.
 * Matches SF-SEM-ADDR-STATE-CODE, SF-SEM-ADDR-DISTRICT, SF-SEM-ADDR-MUNICIPALITY.
 * Returns a deep-cloned schema (does not mutate published catalogue metadata).
 * Free-text district fields (Residence PUBLISHED pin) are left unchanged.
 */
export function applyJurisdictionScopeToFormSchema(
  schema: FormSchemaNode,
  scope: JurisdictionScope,
): FormSchemaNode {
  const next = cloneNode(schema);

  const constrain = (
    node: FormSchemaNode,
    semanticId: string,
    scopeCodes: readonly string[],
    hint: string,
  ): void => {
    if (node.semanticElementId !== semanticId) return;
    const codes = effectiveAllowedCodes(node, scopeCodes);
    if (!codes) return;
    node.enum = codes;
    node['x-ux4g'] = {
      ...(node['x-ux4g'] ?? {}),
      enum_labels: labelsFor(codes),
      hint,
    };
    delete node.pattern;
    if (semanticId === DISTRICT_SEMANTIC_ID || semanticId === MUNICIPALITY_SEMANTIC_ID) {
      delete node.maxLength;
    }
  };

  const walk = (node: FormSchemaNode): void => {
    constrain(
      node,
      STATE_SEMANTIC_ID,
      scope.allowed_states,
      'Tenant-allowed state codes for this offering',
    );
    constrain(
      node,
      DISTRICT_SEMANTIC_ID,
      scope.allowed_districts,
      'Tenant-allowed district codes for this offering',
    );
    constrain(
      node,
      MUNICIPALITY_SEMANTIC_ID,
      scope.allowed_municipalities,
      'Tenant-allowed municipality / ULB (local body) LGD codes for this offering',
    );
    for (const child of Object.values(node.properties ?? {})) walk(child);
  };

  walk(next);
  return next;
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

function semanticFieldNodes(
  schema: FormSchemaNode,
  semanticId: string,
  base = '',
): { pointer: string; node: FormSchemaNode }[] {
  return Object.entries(schema.properties ?? {}).flatMap(([name, node]) => {
    const pointer = `${base}/${name}`;
    return [
      ...(node.semanticElementId === semanticId ? [{ pointer, node }] : []),
      ...(node.type === 'object' ? semanticFieldNodes(node, semanticId, pointer) : []),
    ];
  });
}

/** Validate submitted form data against tenant jurisdiction scope (fail closed). */
export function validateFormDataAgainstJurisdictionScope(
  schema: FormSchemaNode,
  data: Record<string, unknown>,
  scope: JurisdictionScope,
): JurisdictionScopeIssue[] {
  const issues: JurisdictionScopeIssue[] = [];

  for (const { pointer, node } of semanticFieldNodes(schema, STATE_SEMANTIC_ID)) {
    const allowed = effectiveAllowedCodes(node, scope.allowed_states);
    if (!allowed) continue;
    const value = valueAt(data, pointer);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !allowed.includes(value.toUpperCase())) {
      issues.push({
        code: 'JURISDICTION_OUT_OF_SCOPE',
        pointer,
        message: 'State/UT code is outside this tenant offering scope',
      });
    }
  }
  for (const { pointer, node } of semanticFieldNodes(schema, DISTRICT_SEMANTIC_ID)) {
    const allowed = effectiveAllowedCodes(node, scope.allowed_districts);
    if (!allowed) continue; // free-text district (e.g. Residence PUBLISHED pin)
    const value = valueAt(data, pointer);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !allowed.includes(value.toUpperCase())) {
      issues.push({
        code: 'JURISDICTION_OUT_OF_SCOPE',
        pointer,
        message: 'District code is outside this tenant offering scope',
      });
    }
  }
  for (const { pointer, node } of semanticFieldNodes(schema, MUNICIPALITY_SEMANTIC_ID)) {
    const allowed = effectiveAllowedCodes(node, scope.allowed_municipalities);
    if (!allowed) continue;
    const value = valueAt(data, pointer);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !allowed.includes(value.toUpperCase())) {
      issues.push({
        code: 'JURISDICTION_OUT_OF_SCOPE',
        pointer,
        message: 'Municipality / ULB code is outside this tenant offering scope',
      });
    }
  }
  return issues;
}

/** Parse admin textarea / comma / newline list into unique uppercase LGD-like codes. */
export function parseLgdCodeList(raw: string, limit = 200): string[] {
  const parts = raw
    .split(/[\s,;]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of parts) {
    if (!isLgdLikeCode(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= limit) break;
  }
  return out;
}
