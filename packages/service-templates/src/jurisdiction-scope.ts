import type { FormSchemaNode } from './types';
import { SAMPLE_LAB_ENVIRONMENT, sampleLabDummyAllowed } from './sample-lab-dummy';

/**
 * Tenant/offering geographic scope (Constitution §2–§3).
 * Codes are LGD-like identifiers — never hard-coded state/district *names* in domain logic.
 * Applies to every catalogue offering (Certificate, Licence, Permit, Registration, …).
 */

export const STATE_SEMANTIC_ID = 'SF-SEM-ADDR-STATE-CODE';
export const DISTRICT_SEMANTIC_ID = 'SF-SEM-ADDR-DISTRICT';

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

const LGD_CODE_RE = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;

export interface JurisdictionScope {
  allowed_states: readonly string[];
  allowed_districts: readonly string[];
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
  };
}

/**
 * Fail-closed when allowed lists are empty outside SAMPLE_LAB.
 * Inside SAMPLE_LAB, empty lists fall back to sample LGD codes (still not statute).
 */
export function resolveJurisdictionScope(
  ownerConfig: Record<string, unknown> | null | undefined,
  environmentLabel: string | undefined | null = SAMPLE_LAB_ENVIRONMENT,
): JurisdictionScope {
  const extracted = extractJurisdictionScope(ownerConfig ?? {});
  const states = [...extracted.allowed_states];
  const districts = [...extracted.allowed_districts];

  if (states.length === 0 || districts.length === 0) {
    if (!sampleLabDummyAllowed(environmentLabel)) {
      throw new Error(
        'Jurisdiction scope refused: allowed_states/allowed_districts empty outside SAMPLE_LAB (fail-closed)',
      );
    }
    return {
      allowed_states: states.length > 0 ? states : [...SAMPLE_LAB_LGD_STATES],
      allowed_districts: districts.length > 0 ? districts : [...SAMPLE_LAB_LGD_DISTRICTS],
    };
  }

  for (const code of [...states, ...districts]) {
    if (!isLgdLikeCode(code)) {
      throw new Error(`Jurisdiction scope refused: invalid LGD-like code ${code}`);
    }
  }

  return { allowed_states: states, allowed_districts: districts };
}

function cloneNode(node: FormSchemaNode): FormSchemaNode {
  return JSON.parse(JSON.stringify(node)) as FormSchemaNode;
}

function labelsFor(codes: readonly string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const code of codes) labels[code] = code;
  return labels;
}

/**
 * Constrain address state/district choice lists from tenant scope.
 * Matches SF-SEM-ADDR-STATE-CODE and SF-SEM-ADDR-DISTRICT anywhere in the schema.
 * Returns a deep-cloned schema (does not mutate published catalogue metadata).
 */
export function applyJurisdictionScopeToFormSchema(
  schema: FormSchemaNode,
  scope: JurisdictionScope,
): FormSchemaNode {
  const next = cloneNode(schema);

  const walk = (node: FormSchemaNode): void => {
    if (node.semanticElementId === STATE_SEMANTIC_ID) {
      node.enum = [...scope.allowed_states];
      node['x-ux4g'] = {
        ...(node['x-ux4g'] ?? {}),
        enum_labels: labelsFor(scope.allowed_states),
        hint: 'Tenant-allowed state LGD codes',
      };
      delete node.pattern;
    }
    if (node.semanticElementId === DISTRICT_SEMANTIC_ID) {
      node.enum = [...scope.allowed_districts];
      node['x-ux4g'] = {
        ...(node['x-ux4g'] ?? {}),
        enum_labels: labelsFor(scope.allowed_districts),
        hint: 'Tenant-allowed district LGD codes',
      };
      delete node.pattern;
      delete node.maxLength;
    }
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

function semanticPointers(schema: FormSchemaNode, semanticId: string, base = ''): string[] {
  return Object.entries(schema.properties ?? {}).flatMap(([name, node]) => {
    const pointer = `${base}/${name}`;
    return [
      ...(node.semanticElementId === semanticId ? [pointer] : []),
      ...(node.type === 'object' ? semanticPointers(node, semanticId, pointer) : []),
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
  const states = new Set(scope.allowed_states);
  const districts = new Set(scope.allowed_districts);

  for (const pointer of semanticPointers(schema, STATE_SEMANTIC_ID)) {
    const value = valueAt(data, pointer);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !states.has(value.toUpperCase())) {
      issues.push({
        code: 'JURISDICTION_OUT_OF_SCOPE',
        pointer,
        message: 'State/UT code is outside this tenant offering scope',
      });
    }
  }
  for (const pointer of semanticPointers(schema, DISTRICT_SEMANTIC_ID)) {
    const value = valueAt(data, pointer);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !districts.has(value.toUpperCase())) {
      issues.push({
        code: 'JURISDICTION_OUT_OF_SCOPE',
        pointer,
        message: 'District code is outside this tenant offering scope',
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
