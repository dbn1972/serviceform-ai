import type { FormSchemaNode } from './types';

/**
 * Builds synthetic SAMPLE_LAB answers for a form JSON Schema.
 * Never invents statute; values are lab-only placeholders (names start with SAMPLE/Lab).
 */

/** Legacy Residence-style sample (OD) when schema still uses SAMPLE_LAB OD/XX enum. */
const SAMPLE_ADDRESS_LEGACY = {
  house_no_or_name: 'SAMPLE Plot 1',
  locality: 'SAMPLE Locality',
  post_office: 'SAMPLE Post Office',
  district: 'SAMPLE District',
  state_code: 'OD',
  pincode: '751001',
} as const;

/** Tenant-scoped LGD sample (matches SAMPLE_LAB defaults allowed_* lists). */
const SAMPLE_ADDRESS_LGD = {
  house_no_or_name: 'SAMPLE Plot 1',
  locality: 'SAMPLE Locality',
  post_office: 'SAMPLE Post Office',
  district: 'LGD-D-0101',
  state_code: 'LGD-S-01',
  pincode: '751001',
} as const;

function sampleAddressFor(node: FormSchemaNode) {
  const state = node.properties?.['state_code'];
  if (state?.enum?.includes('OD')) return { ...SAMPLE_ADDRESS_LEGACY };
  return { ...SAMPLE_ADDRESS_LGD };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sampleForNode(name: string, node: FormSchemaNode): unknown {
  if (node.const !== undefined) return node.const;
  if (node.type === 'object' && node.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.properties)) {
      out[key] = sampleForNode(key, child);
    }
    return out;
  }
  if (node.type === 'boolean') return node.const === true ? true : false;
  if (node.type === 'integer' || node.type === 'number') {
    if (name.includes('income')) return 120_000;
    if (name.includes('duration') || name.includes('months')) return 24;
    if (typeof node.minimum === 'number') return node.minimum;
    return 1;
  }
  if (node.enum && node.enum.length > 0) return node.enum[0];
  if (node.format === 'date') return '1990-01-15';
  if (node.format === 'email') return 'sample.citizen@example.test';
  if (node.pattern === '^[0-9]{6}$') return '751001';
  if (node.pattern === '^[0-9]{10}$') return '9123456789';
  if (node.pattern === '^[0-9]{4}$') return '4321';
  if (node.pattern === '^[0-9]{4}-[0-9]{2}$') return '2025-26';
  if (
    node.semanticElementId?.includes('NAME') ||
    name.endsWith('_name') ||
    name === 'applicant_name' ||
    name === 'child_name' ||
    name === 'guardian_name' ||
    name === 'mother_name' ||
    name === 'father_name' ||
    name === 'informant_name'
  ) {
    return 'SAMPLE Lab Citizen';
  }
  if (name.includes('address') && node.type === 'object') {
    return sampleAddressFor(node);
  }
  if (node.semanticElementId === 'SF-SEM-ADDR-STATE-CODE') {
    if (node.enum && node.enum.length > 0) return node.enum[0];
    return SAMPLE_ADDRESS_LGD.state_code;
  }
  if (node.semanticElementId === 'SF-SEM-ADDR-DISTRICT') {
    if (node.enum && node.enum.length > 0) return node.enum[0];
    return SAMPLE_ADDRESS_LGD.district;
  }
  if (name.includes('purpose')) return 'SAMPLE_LAB purpose — synthetic only';
  if (name.includes('evidence_type')) return 'SAMPLE_LAB_DUMMY_EVIDENCE_ANY';
  if (name.includes('evidence_file')) return 'sample-evidence.pdf';
  if (name.includes('evidence_mime')) return 'application/pdf';
  if (name.includes('place')) return 'SAMPLE Place';
  if (typeof node.minLength === 'number' && node.minLength > 0) {
    return 'SAMPLE'.padEnd(Math.min(node.minLength, 20), 'x');
  }
  return 'SAMPLE';
}

/** Synthetic SAMPLE_LAB form payload matching required (+ optional) schema fields. */
export function buildSampleLabFormData(schema: FormSchemaNode): Record<string, unknown> {
  if (schema.type !== 'object' || !schema.properties) {
    throw new Error('SAMPLE_LAB form schema must be an object with properties');
  }
  // Prefer a known address shape when the whole property is a postal address object.
  const data: Record<string, unknown> = {};
  for (const [name, node] of Object.entries(schema.properties)) {
    if (
      node.type === 'object' &&
      node.properties &&
      'pincode' in node.properties &&
      'state_code' in node.properties
    ) {
      data[name] = sampleAddressFor(node);
      continue;
    }
    data[name] = sampleForNode(name, node);
  }
  return data;
}

/** Drop declaration / optional-only fields to force validation failures. */
export function buildInvalidLabFormData(schema: FormSchemaNode): Record<string, unknown> {
  const valid = buildSampleLabFormData(schema);
  const next: Record<string, unknown> = { ...valid };
  for (const key of Object.keys(next)) {
    if (key === 'declaration_accepted') {
      next[key] = false;
      continue;
    }
    const node = schema.properties?.[key];
    if (node?.type === 'object' && isRecord(next[key])) {
      const nested = { ...(next[key] as Record<string, unknown>) };
      if ('pincode' in nested) nested['pincode'] = '12';
      next[key] = nested;
    }
  }
  next['unexpected_lab_field'] = 'x';
  return next;
}
