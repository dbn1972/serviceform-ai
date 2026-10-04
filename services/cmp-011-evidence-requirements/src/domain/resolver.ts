import { evaluatePredicate, type PredicateEvaluation, type PredicateInputs } from './predicate.js';
import {
  ASSURANCE_LEVELS,
  type AssuranceLevel,
  type EvidencePolicyDefinition,
  type EvidenceSource,
  type EvidenceTypeDef,
  type RequirementDef,
  type Scalar,
} from './policy.js';

export type VerificationState = 'VERIFIED' | 'UNVERIFIED' | 'ADVISORY';

export interface HeldEvidence {
  evidence_ref: string;
  evidence_type_code: string;
  source: EvidenceSource;
  verification: VerificationState;
  scope: 'APPLICATION' | 'PROFILE';
  assurance?: AssuranceLevel;
  issued_at?: string;
  expires_at?: string;
}

export interface ResolveInput {
  policy: EvidencePolicyDefinition;
  facts: Readonly<Record<string, Scalar>>;
  rule_outcomes: Readonly<Record<string, Scalar>>;
  held_evidence: readonly HeldEvidence[];
  digilocker_availability: Readonly<Record<string, boolean>>;
  as_of: string;
}

export type RequirementStatus =
  | 'NOT_APPLICABLE'
  | 'EXEMPT'
  | 'SATISFIED'
  | 'PROVIDED_PENDING_VERIFICATION'
  | 'REQUIRED'
  | 'OPTIONAL'
  | 'UNDETERMINED';

export type ItemStatus = 'SATISFIED' | 'PROVIDED' | 'MISSING';
export type SetStatus = 'SATISFIED' | 'PROVIDED' | 'INCOMPLETE';
export type Availability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' | 'ALWAYS';

export interface SourceOption {
  source: EvidenceSource;
  document_type_ref?: string;
  availability: Availability;
  recommended: boolean;
}

export interface Rejection {
  evidence_ref: string;
  reason_code: string;
}

export interface ItemOutcome {
  evidence_type_code: string;
  label_key: string;
  status: ItemStatus;
  evidence_ref?: string;
  source?: EvidenceSource;
  options: SourceOption[];
  rejections: Rejection[];
}

export interface SetOutcome {
  set_code: string;
  status: SetStatus;
  items: ItemOutcome[];
}

export interface ExplanationLine {
  set_code: string;
  evidence_type_code: string;
  reason_code: string;
}

export interface RequirementOutcome {
  requirement_code: string;
  reason_code: string;
  mandatory: boolean;
  status: RequirementStatus;
  exemption_reason_code?: string;
  unresolved_inputs: string[];
  selected_set_code?: string;
  recommended_set_code?: string;
  alternative_sets: SetOutcome[];
  missing_evidence_explanation: ExplanationLine[];
}

export interface TraceEntry {
  requirement_code: string;
  applies_when?: PredicateEvaluation;
  exemptions: (PredicateEvaluation & { reason_code: string })[];
}

export interface Checklist {
  as_of: string;
  complete: boolean;
  summary: Record<string, number>;
  requirements: RequirementOutcome[];
  advisory_evidence: { evidence_ref: string; evidence_type_code: string }[];
}

export interface ResolveResult {
  checklist: Checklist;
  trace: TraceEntry[];
}

const DAY_MS = 86_400_000;

function parseTime(value: string | undefined): number | null {
  if (value === undefined) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

type Assessment = { ok: true; grade: 'SATISFIED' | 'PROVIDED' } | { ok: false; reason: string };

function assess(type: EvidenceTypeDef, held: HeldEvidence, asOf: number): Assessment {
  if (!type.sources.some((s) => s.source === held.source)) {
    return { ok: false, reason: 'SOURCE_NOT_ACCEPTED' };
  }
  if (held.verification === 'ADVISORY') return { ok: false, reason: 'ADVISORY_ONLY' };
  if (held.scope === 'PROFILE' && !type.reusable) return { ok: false, reason: 'NOT_REUSABLE' };
  if (held.expires_at !== undefined) {
    const expires = parseTime(held.expires_at);
    if (expires === null || expires <= asOf) return { ok: false, reason: 'EVIDENCE_EXPIRED' };
  }
  if (type.max_age_days !== undefined) {
    const issued = parseTime(held.issued_at);
    if (issued === null) return { ok: false, reason: 'ISSUE_DATE_UNKNOWN' };
    if (asOf - issued > type.max_age_days * DAY_MS) return { ok: false, reason: 'EVIDENCE_STALE' };
  }
  if (type.min_assurance !== undefined) {
    const have = held.assurance === undefined ? -1 : ASSURANCE_LEVELS.indexOf(held.assurance);
    if (have < ASSURANCE_LEVELS.indexOf(type.min_assurance)) {
      return { ok: false, reason: 'ASSURANCE_INSUFFICIENT' };
    }
  }
  return { ok: true, grade: held.verification === 'VERIFIED' ? 'SATISFIED' : 'PROVIDED' };
}

function sourceOrder(type: EvidenceTypeDef, requirement: RequirementDef): EvidenceSource[] {
  const declared = type.sources.map((s) => s.source);
  const preferred = requirement.source_preference.filter((s) => declared.includes(s));
  return [...preferred, ...declared.filter((s) => !preferred.includes(s))];
}

function buildOptions(
  type: EvidenceTypeDef,
  requirement: RequirementDef,
  digilocker: Readonly<Record<string, boolean>>,
): SourceOption[] {
  const options = sourceOrder(type, requirement).map((source): SourceOption => {
    const def = type.sources.find((s) => s.source === source);
    let availability: Availability = 'ALWAYS';
    if (source === 'DIGILOCKER') {
      const known = digilocker[type.code];
      availability = known === undefined ? 'UNKNOWN' : known ? 'AVAILABLE' : 'UNAVAILABLE';
    }
    const option: SourceOption = { source, availability, recommended: false };
    if (def?.document_type_ref) option.document_type_ref = def.document_type_ref;
    return option;
  });
  const first = options.find((o) => o.availability !== 'UNAVAILABLE');
  if (first) first.recommended = true;
  return options;
}

function resolveItem(
  type: EvidenceTypeDef,
  requirement: RequirementDef,
  input: ResolveInput,
  asOf: number,
): ItemOutcome {
  const order = sourceOrder(type, requirement);
  const candidates = input.held_evidence
    .filter((h) => h.evidence_type_code === type.code)
    .slice()
    .sort((a, b) => {
      const byPref = order.indexOf(a.source) - order.indexOf(b.source);
      return byPref !== 0 ? byPref : a.evidence_ref.localeCompare(b.evidence_ref);
    });
  const rejections: Rejection[] = [];
  let satisfied: HeldEvidence | undefined;
  let provided: HeldEvidence | undefined;
  for (const candidate of candidates) {
    const verdict = assess(type, candidate, asOf);
    if (!verdict.ok) {
      rejections.push({ evidence_ref: candidate.evidence_ref, reason_code: verdict.reason });
    } else if (verdict.grade === 'SATISFIED') {
      satisfied ??= candidate;
    } else {
      provided ??= candidate;
    }
  }
  const chosen = satisfied ?? provided;
  const item: ItemOutcome = {
    evidence_type_code: type.code,
    label_key: type.label_key,
    status: satisfied ? 'SATISFIED' : provided ? 'PROVIDED' : 'MISSING',
    options: chosen ? [] : buildOptions(type, requirement, input.digilocker_availability),
    rejections,
  };
  if (chosen) {
    item.evidence_ref = chosen.evidence_ref;
    item.source = chosen.source;
  }
  return item;
}

function setStatus(items: readonly ItemOutcome[]): SetStatus {
  if (items.some((i) => i.status === 'MISSING')) return 'INCOMPLETE';
  return items.every((i) => i.status === 'SATISFIED') ? 'SATISFIED' : 'PROVIDED';
}

function resolveRequirement(
  requirement: RequirementDef,
  typesByCode: ReadonlyMap<string, EvidenceTypeDef>,
  input: ResolveInput,
  predicateInputs: PredicateInputs,
  asOf: number,
): { outcome: RequirementOutcome; trace: TraceEntry } {
  const trace: TraceEntry = { requirement_code: requirement.code, exemptions: [] };
  const base = {
    requirement_code: requirement.code,
    reason_code: requirement.reason_code,
    mandatory: requirement.mandatory,
    alternative_sets: [] as SetOutcome[],
    missing_evidence_explanation: [] as ExplanationLine[],
  };
  let appliesResult: 'TRUE' | 'FALSE' | 'UNKNOWN' = 'TRUE';
  const unresolved = new Set<string>();
  if (requirement.applies_when) {
    const evaluation = evaluatePredicate(requirement.applies_when, predicateInputs);
    trace.applies_when = evaluation;
    appliesResult = evaluation.result;
    evaluation.unresolved.forEach((u) => unresolved.add(u));
  }
  if (appliesResult === 'FALSE') {
    return {
      outcome: { ...base, status: 'NOT_APPLICABLE', unresolved_inputs: [] },
      trace,
    };
  }
  if (appliesResult === 'TRUE') {
    for (const exemption of requirement.exempt_when) {
      const evaluation = evaluatePredicate(exemption.when, predicateInputs);
      trace.exemptions.push({ ...evaluation, reason_code: exemption.reason_code });
      if (evaluation.result === 'TRUE') {
        return {
          outcome: {
            ...base,
            status: 'EXEMPT',
            exemption_reason_code: exemption.reason_code,
            unresolved_inputs: [],
          },
          trace,
        };
      }
      evaluation.unresolved.forEach((u) => unresolved.add(u));
    }
  }

  const sets: SetOutcome[] = requirement.alternative_sets.map((set) => {
    const items = set.evidence_type_codes.map((typeCode) =>
      resolveItem(typesByCode.get(typeCode) as EvidenceTypeDef, requirement, input, asOf),
    );
    return { set_code: set.code, status: setStatus(items), items };
  });
  const satisfiedSet = sets.find((s) => s.status === 'SATISFIED');
  const providedSet = sets.find((s) => s.status === 'PROVIDED');

  let status: RequirementStatus;
  if (appliesResult === 'UNKNOWN') status = 'UNDETERMINED';
  else if (satisfiedSet) status = 'SATISFIED';
  else if (providedSet) status = 'PROVIDED_PENDING_VERIFICATION';
  else status = requirement.mandatory ? 'REQUIRED' : 'OPTIONAL';

  const outcome: RequirementOutcome = {
    ...base,
    status,
    unresolved_inputs: [...unresolved].sort(),
    alternative_sets: sets,
  };
  const selected = satisfiedSet ?? providedSet;
  if (selected) outcome.selected_set_code = selected.set_code;

  if (!satisfiedSet && !providedSet) {
    let best: SetOutcome | undefined;
    let bestMissing = Number.POSITIVE_INFINITY;
    for (const set of sets) {
      const missing = set.items.filter((i) => i.status === 'MISSING').length;
      if (missing < bestMissing) {
        best = set;
        bestMissing = missing;
      }
    }
    if (best) {
      outcome.recommended_set_code = best.set_code;
      for (const item of best.items) {
        if (item.status !== 'MISSING') continue;
        outcome.missing_evidence_explanation.push({
          set_code: best.set_code,
          evidence_type_code: item.evidence_type_code,
          reason_code: item.rejections[0]?.reason_code ?? 'EVIDENCE_MISSING',
        });
      }
    }
  }
  return { outcome, trace };
}

const STATUS_KEYS: readonly RequirementStatus[] = [
  'SATISFIED',
  'PROVIDED_PENDING_VERIFICATION',
  'REQUIRED',
  'OPTIONAL',
  'EXEMPT',
  'NOT_APPLICABLE',
  'UNDETERMINED',
];

/**
 * Deterministic requirement resolution. The output depends only on the pinned policy definition and the
 * supplied inputs; there is no clock, randomness, network or model call. Requirements that are not in the
 * policy can never appear.
 */
export function resolveRequirements(input: ResolveInput): ResolveResult {
  const asOf = Date.parse(input.as_of);
  const typesByCode = new Map(input.policy.evidence_types.map((t) => [t.code, t]));
  const predicateInputs: PredicateInputs = {
    facts: input.facts,
    rule_outcomes: input.rule_outcomes,
  };
  const requirements: RequirementOutcome[] = [];
  const trace: TraceEntry[] = [];
  for (const requirement of input.policy.requirements) {
    const resolved = resolveRequirement(requirement, typesByCode, input, predicateInputs, asOf);
    requirements.push(resolved.outcome);
    trace.push(resolved.trace);
  }
  const summary: Record<string, number> = { total: requirements.length };
  for (const key of STATUS_KEYS) summary[key] = requirements.filter((r) => r.status === key).length;
  const complete = requirements.every((r) =>
    ['SATISFIED', 'EXEMPT', 'NOT_APPLICABLE', 'OPTIONAL'].includes(r.status),
  );
  const advisory = input.held_evidence
    .filter((h) => h.verification === 'ADVISORY' && typesByCode.has(h.evidence_type_code))
    .map((h) => ({ evidence_ref: h.evidence_ref, evidence_type_code: h.evidence_type_code }))
    .sort((a, b) => a.evidence_ref.localeCompare(b.evidence_ref));
  return {
    checklist: { as_of: input.as_of, complete, summary, requirements, advisory_evidence: advisory },
    trace,
  };
}
