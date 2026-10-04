import { Cmp011Error } from '../errors.js';

export const EVIDENCE_SOURCES = ['UPLOAD', 'DIGILOCKER'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const ASSURANCE_LEVELS = ['LOW', 'SUBSTANTIAL', 'HIGH'] as const;
export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number];

export const PREDICATE_OPS = ['eq', 'neq', 'in', 'exists', 'gt', 'gte', 'lt', 'lte'] as const;
export type PredicateOp = (typeof PREDICATE_OPS)[number];

export type Scalar = string | number | boolean;

export interface PredicateRef {
  kind: 'fact' | 'rule_outcome';
  key: string;
}

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { ref: PredicateRef; op: PredicateOp; value?: Scalar | Scalar[] };

export interface EvidenceSourceDef {
  source: EvidenceSource;
  document_type_ref?: string;
}

export interface EvidenceTypeDef {
  code: string;
  label_key: string;
  sources: EvidenceSourceDef[];
  max_age_days?: number;
  min_assurance?: AssuranceLevel;
  reusable: boolean;
}

export interface AlternativeSet {
  code: string;
  evidence_type_codes: string[];
}

export interface ExemptionDef {
  reason_code: string;
  when: Predicate;
}

export interface RequirementDef {
  code: string;
  reason_code: string;
  mandatory: boolean;
  applies_when?: Predicate;
  exempt_when: ExemptionDef[];
  alternative_sets: AlternativeSet[];
  source_preference: EvidenceSource[];
}

export interface EvidencePolicyDefinition {
  schema_version: 1;
  evidence_types: EvidenceTypeDef[];
  requirements: RequirementDef[];
}

export const LIMITS = {
  evidenceTypes: 200,
  requirements: 200,
  setsPerRequirement: 20,
  typesPerSet: 20,
  exemptions: 20,
  sources: 4,
  predicateDepth: 8,
  predicateNodes: 100,
  inValues: 50,
  maxAgeDays: 36500,
} as const;

const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const KEY_RE = /^[a-z][a-z0-9._-]{0,127}$/;
const LABEL_RE = /^[a-z][a-z0-9._-]{1,127}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function fail(code: string, pointer: string): never {
  throw new Cmp011Error('SF-SYS-003', { details: [{ code, pointer }] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], pointer: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `${pointer}/${key}`);
  }
}

function code(value: unknown, pointer: string): string {
  if (typeof value !== 'string' || !CODE_RE.test(value)) fail('INVALID_CODE', pointer);
  return value;
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function parsePredicate(
  raw: unknown,
  pointer: string,
  state: { nodes: number },
  depth: number,
): Predicate {
  if (depth > LIMITS.predicateDepth) fail('PREDICATE_TOO_DEEP', pointer);
  state.nodes += 1;
  if (state.nodes > LIMITS.predicateNodes) fail('PREDICATE_TOO_LARGE', pointer);
  if (!isRecord(raw)) fail('PREDICATE_INVALID', pointer);
  if ('all' in raw || 'any' in raw) {
    const key = 'all' in raw ? 'all' : 'any';
    onlyKeys(raw, [key], pointer);
    const list = raw[key];
    if (!Array.isArray(list) || list.length < 1 || list.length > 50) {
      fail('PREDICATE_INVALID', `${pointer}/${key}`);
    }
    const children = list.map((c, i) =>
      parsePredicate(c, `${pointer}/${key}/${i}`, state, depth + 1),
    );
    return key === 'all' ? { all: children } : { any: children };
  }
  if ('not' in raw) {
    onlyKeys(raw, ['not'], pointer);
    return { not: parsePredicate(raw['not'], `${pointer}/not`, state, depth + 1) };
  }
  onlyKeys(raw, ['ref', 'op', 'value'], pointer);
  const ref = raw['ref'];
  if (!isRecord(ref)) fail('PREDICATE_INVALID', `${pointer}/ref`);
  onlyKeys(ref, ['kind', 'key'], `${pointer}/ref`);
  if (ref['kind'] !== 'fact' && ref['kind'] !== 'rule_outcome')
    fail('PREDICATE_REF_KIND', `${pointer}/ref/kind`);
  if (typeof ref['key'] !== 'string' || !KEY_RE.test(ref['key']))
    fail('PREDICATE_REF_KEY', `${pointer}/ref/key`);
  const op = raw['op'];
  if (typeof op !== 'string' || !(PREDICATE_OPS as readonly string[]).includes(op)) {
    fail('PREDICATE_OP', `${pointer}/op`);
  }
  const typedOp = op as PredicateOp;
  const out: { ref: PredicateRef; op: PredicateOp; value?: Scalar | Scalar[] } = {
    ref: { kind: ref['kind'], key: ref['key'] },
    op: typedOp,
  };
  const value = raw['value'];
  if (typedOp === 'exists') {
    if (value !== undefined) fail('PREDICATE_VALUE', `${pointer}/value`);
    return out;
  }
  if (typedOp === 'in') {
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > LIMITS.inValues ||
      !value.every(isScalar)
    ) {
      fail('PREDICATE_VALUE', `${pointer}/value`);
    }
    out.value = value as Scalar[];
    return out;
  }
  if (!isScalar(value)) fail('PREDICATE_VALUE', `${pointer}/value`);
  if (['gt', 'gte', 'lt', 'lte'].includes(typedOp) && typeof value !== 'number') {
    fail('PREDICATE_VALUE', `${pointer}/value`);
  }
  out.value = value;
  return out;
}

function parseSources(raw: unknown, pointer: string): EvidenceSourceDef[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > LIMITS.sources)
    fail('SOURCES_INVALID', pointer);
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const p = `${pointer}/${i}`;
    if (!isRecord(entry)) fail('SOURCES_INVALID', p);
    onlyKeys(entry, ['source', 'document_type_ref'], p);
    const source = entry['source'];
    if (typeof source !== 'string' || !(EVIDENCE_SOURCES as readonly string[]).includes(source)) {
      fail('SOURCE_UNKNOWN', `${p}/source`);
    }
    if (seen.has(source)) fail('SOURCE_DUPLICATE', `${p}/source`);
    seen.add(source);
    const def: EvidenceSourceDef = { source: source as EvidenceSource };
    const ref = entry['document_type_ref'];
    if (ref !== undefined) {
      if (typeof ref !== 'string' || !REF_RE.test(ref))
        fail('DOCUMENT_TYPE_REF', `${p}/document_type_ref`);
      if (source !== 'DIGILOCKER') fail('DOCUMENT_TYPE_REF_SOURCE', `${p}/document_type_ref`);
      def.document_type_ref = ref;
    }
    return def;
  });
}

function parseEvidenceType(raw: unknown, pointer: string): EvidenceTypeDef {
  if (!isRecord(raw)) fail('EVIDENCE_TYPE_INVALID', pointer);
  onlyKeys(
    raw,
    ['code', 'label_key', 'sources', 'max_age_days', 'min_assurance', 'reusable'],
    pointer,
  );
  const labelKey = raw['label_key'];
  if (typeof labelKey !== 'string' || !LABEL_RE.test(labelKey))
    fail('LABEL_KEY', `${pointer}/label_key`);
  const def: EvidenceTypeDef = {
    code: code(raw['code'], `${pointer}/code`),
    label_key: labelKey,
    sources: parseSources(raw['sources'], `${pointer}/sources`),
    reusable: false,
  };
  const age = raw['max_age_days'];
  if (age !== undefined) {
    if (!Number.isInteger(age) || (age as number) < 1 || (age as number) > LIMITS.maxAgeDays) {
      fail('MAX_AGE_DAYS', `${pointer}/max_age_days`);
    }
    def.max_age_days = age as number;
  }
  const assurance = raw['min_assurance'];
  if (assurance !== undefined) {
    if (
      typeof assurance !== 'string' ||
      !(ASSURANCE_LEVELS as readonly string[]).includes(assurance)
    ) {
      fail('MIN_ASSURANCE', `${pointer}/min_assurance`);
    }
    def.min_assurance = assurance as AssuranceLevel;
  }
  const reusable = raw['reusable'];
  if (reusable !== undefined) {
    if (typeof reusable !== 'boolean') fail('REUSABLE', `${pointer}/reusable`);
    def.reusable = reusable;
  }
  return def;
}

function parseRequirement(
  raw: unknown,
  pointer: string,
  typeCodes: ReadonlySet<string>,
): RequirementDef {
  if (!isRecord(raw)) fail('REQUIREMENT_INVALID', pointer);
  onlyKeys(
    raw,
    [
      'code',
      'reason_code',
      'mandatory',
      'applies_when',
      'exempt_when',
      'alternative_sets',
      'source_preference',
    ],
    pointer,
  );
  if (typeof raw['mandatory'] !== 'boolean') fail('MANDATORY', `${pointer}/mandatory`);
  const sets = raw['alternative_sets'];
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > LIMITS.setsPerRequirement) {
    fail('ALTERNATIVE_SETS', `${pointer}/alternative_sets`);
  }
  const setCodes = new Set<string>();
  const alternative_sets = sets.map((s, i): AlternativeSet => {
    const p = `${pointer}/alternative_sets/${i}`;
    if (!isRecord(s)) fail('ALTERNATIVE_SET_INVALID', p);
    onlyKeys(s, ['code', 'evidence_type_codes'], p);
    const setCode = code(s['code'], `${p}/code`);
    if (setCodes.has(setCode)) fail('ALTERNATIVE_SET_DUPLICATE', `${p}/code`);
    setCodes.add(setCode);
    const codes = s['evidence_type_codes'];
    if (!Array.isArray(codes) || codes.length < 1 || codes.length > LIMITS.typesPerSet) {
      fail('ALTERNATIVE_SET_EMPTY', `${p}/evidence_type_codes`);
    }
    const seen = new Set<string>();
    const evidence_type_codes = codes.map((c, j) => {
      const tc = code(c, `${p}/evidence_type_codes/${j}`);
      if (!typeCodes.has(tc)) fail('EVIDENCE_TYPE_UNKNOWN', `${p}/evidence_type_codes/${j}`);
      if (seen.has(tc)) fail('EVIDENCE_TYPE_DUPLICATE', `${p}/evidence_type_codes/${j}`);
      seen.add(tc);
      return tc;
    });
    return { code: setCode, evidence_type_codes };
  });
  const exemptRaw = raw['exempt_when'] ?? [];
  if (!Array.isArray(exemptRaw) || exemptRaw.length > LIMITS.exemptions) {
    fail('EXEMPTIONS_INVALID', `${pointer}/exempt_when`);
  }
  const exempt_when = exemptRaw.map((e, i): ExemptionDef => {
    const p = `${pointer}/exempt_when/${i}`;
    if (!isRecord(e)) fail('EXEMPTION_INVALID', p);
    onlyKeys(e, ['reason_code', 'when'], p);
    return {
      reason_code: code(e['reason_code'], `${p}/reason_code`),
      when: parsePredicate(e['when'], `${p}/when`, { nodes: 0 }, 1),
    };
  });
  const prefRaw = raw['source_preference'] ?? [];
  if (!Array.isArray(prefRaw) || prefRaw.length > EVIDENCE_SOURCES.length) {
    fail('SOURCE_PREFERENCE', `${pointer}/source_preference`);
  }
  const source_preference = prefRaw.map((s, i) => {
    if (typeof s !== 'string' || !(EVIDENCE_SOURCES as readonly string[]).includes(s)) {
      fail('SOURCE_PREFERENCE', `${pointer}/source_preference/${i}`);
    }
    return s as EvidenceSource;
  });
  if (new Set(source_preference).size !== source_preference.length) {
    fail('SOURCE_PREFERENCE', `${pointer}/source_preference`);
  }
  const def: RequirementDef = {
    code: code(raw['code'], `${pointer}/code`),
    reason_code: code(raw['reason_code'], `${pointer}/reason_code`),
    mandatory: raw['mandatory'],
    exempt_when,
    alternative_sets,
    source_preference,
  };
  if (raw['applies_when'] !== undefined) {
    def.applies_when = parsePredicate(
      raw['applies_when'],
      `${pointer}/applies_when`,
      { nodes: 0 },
      1,
    );
  }
  return def;
}

export function parsePolicyDefinition(raw: unknown): EvidencePolicyDefinition {
  if (!isRecord(raw)) fail('POLICY_REQUIRED', '');
  onlyKeys(raw, ['schema_version', 'evidence_types', 'requirements'], '');
  if (raw['schema_version'] !== 1) fail('SCHEMA_VERSION', '/schema_version');
  const types = raw['evidence_types'];
  if (!Array.isArray(types) || types.length < 1 || types.length > LIMITS.evidenceTypes) {
    fail('EVIDENCE_TYPES', '/evidence_types');
  }
  const typeCodes = new Set<string>();
  const evidence_types = types.map((t, i) => {
    const def = parseEvidenceType(t, `/evidence_types/${i}`);
    if (typeCodes.has(def.code)) fail('EVIDENCE_TYPE_DUPLICATE', `/evidence_types/${i}/code`);
    typeCodes.add(def.code);
    return def;
  });
  const reqs = raw['requirements'];
  if (!Array.isArray(reqs) || reqs.length < 1 || reqs.length > LIMITS.requirements) {
    fail('REQUIREMENTS', '/requirements');
  }
  const reqCodes = new Set<string>();
  const requirements = reqs.map((r, i) => {
    const def = parseRequirement(r, `/requirements/${i}`, typeCodes);
    if (reqCodes.has(def.code)) fail('REQUIREMENT_DUPLICATE', `/requirements/${i}/code`);
    reqCodes.add(def.code);
    return def;
  });
  return { schema_version: 1, evidence_types, requirements };
}
