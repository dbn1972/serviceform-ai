import { describe, expect, it } from 'vitest';
import { sha256Of } from '../../src/domain/canonical.js';
import { parsePolicyDefinition, type EvidencePolicyDefinition } from '../../src/domain/policy.js';
import {
  resolveRequirements,
  type HeldEvidence,
  type RequirementOutcome,
} from '../../src/domain/resolver.js';
import { samplePolicy } from '../fixtures/policy.js';

const AS_OF = '2026-10-04T12:00:00.000Z';

type HeldInput = { [K in keyof HeldEvidence]?: HeldEvidence[K] | undefined } & {
  evidence_type_code: string;
};

function held(partial: HeldInput): HeldEvidence {
  const out: Record<string, unknown> = {
    evidence_ref: `ref-${partial.evidence_type_code}-${partial.source ?? 'UPLOAD'}`,
    source: 'UPLOAD',
    verification: 'VERIFIED',
    scope: 'APPLICATION',
    assurance: 'HIGH',
    issued_at: '2026-09-30T00:00:00.000Z',
    ...partial,
  };
  for (const key of Object.keys(out)) if (out[key] === undefined) Reflect.deleteProperty(out, key);
  return out as unknown as HeldEvidence;
}

function run(
  opts: {
    policy?: EvidencePolicyDefinition;
    facts?: Record<string, string | number | boolean>;
    rules?: Record<string, string | number | boolean>;
    evidence?: HeldEvidence[];
    dl?: Record<string, boolean>;
  } = {},
) {
  return resolveRequirements({
    policy: parsePolicyDefinition(opts.policy ?? samplePolicy()),
    facts: opts.facts ?? { 'applicant.category': 'P', 'applicant.age': 30 },
    rule_outcomes: opts.rules ?? { needs_extra: false },
    held_evidence: opts.evidence ?? [],
    digilocker_availability: opts.dl ?? {},
    as_of: AS_OF,
  });
}

function req(result: ReturnType<typeof run>, code: string): RequirementOutcome {
  return result.checklist.requirements.find(
    (r) => r.requirement_code === code,
  ) as RequirementOutcome;
}

describe('requirement resolution driven by published metadata', () => {
  it('lists only requirements present in the policy (no hidden requirements)', () => {
    const result = run();
    const codes = result.checklist.requirements.map((r) => r.requirement_code);
    expect(codes).toEqual(['REQ_IDENTITY', 'REQ_PLACE', 'REQ_EXTRA']);
    expect(result.trace.map((t) => t.requirement_code)).toEqual(codes);
    for (const r of result.checklist.requirements) expect(r.reason_code).toMatch(/^POLICY_/);
  });

  it('marks unmet mandatory requirements REQUIRED with a missing-evidence explanation', () => {
    const result = run();
    const identity = req(result, 'REQ_IDENTITY');
    expect(identity.status).toBe('REQUIRED');
    expect(identity.recommended_set_code).toBe('SET_ID_A');
    expect(identity.missing_evidence_explanation).toEqual([
      { set_code: 'SET_ID_A', evidence_type_code: 'ID_DOC_A', reason_code: 'EVIDENCE_MISSING' },
    ]);
    expect(result.checklist.complete).toBe(false);
    expect(req(result, 'REQ_EXTRA').status).toBe('NOT_APPLICABLE');
    expect(result.checklist.summary['REQUIRED']).toBe(2);
  });

  it('recommends the alternative set with the fewest missing items, ties go to the first', () => {
    const tie = req(run({ evidence: [held({ evidence_type_code: 'PLACE_DOC_Y' })] }), 'REQ_PLACE');
    expect(tie.recommended_set_code).toBe('SET_PLACE_X');
    const policy = samplePolicy();
    (policy.requirements[1] as { alternative_sets: unknown[] }).alternative_sets.reverse();
    const place = req(
      run({ policy, evidence: [held({ evidence_type_code: 'PLACE_DOC_Y' })] }),
      'REQ_PLACE',
    );
    expect(place.status).toBe('REQUIRED');
    expect(place.recommended_set_code).toBe('SET_PLACE_YZ');
    const none = req(run({ policy }), 'REQ_PLACE');
    expect(none.recommended_set_code).toBe('SET_PLACE_X');
    expect(none.missing_evidence_explanation.map((m) => m.evidence_type_code)).toEqual([
      'PLACE_DOC_X',
    ]);
  });
});

describe('alternative evidence sets cover every branch', () => {
  it('first alternative satisfies', () => {
    const r = req(run({ evidence: [held({ evidence_type_code: 'ID_DOC_A' })] }), 'REQ_IDENTITY');
    expect(r.status).toBe('SATISFIED');
    expect(r.selected_set_code).toBe('SET_ID_A');
  });

  it('second alternative satisfies', () => {
    const r = req(run({ evidence: [held({ evidence_type_code: 'ID_DOC_B' })] }), 'REQ_IDENTITY');
    expect(r.status).toBe('SATISFIED');
    expect(r.selected_set_code).toBe('SET_ID_B');
  });

  it('multi-item alternative needs every item (AND within a set, OR across sets)', () => {
    const only = req(run({ evidence: [held({ evidence_type_code: 'PLACE_DOC_Z' })] }), 'REQ_PLACE');
    expect(only.status).toBe('REQUIRED');
    const both = req(
      run({
        evidence: [
          held({ evidence_type_code: 'PLACE_DOC_Y' }),
          held({ evidence_type_code: 'PLACE_DOC_Z' }),
        ],
      }),
      'REQ_PLACE',
    );
    expect(both.status).toBe('SATISFIED');
    expect(both.selected_set_code).toBe('SET_PLACE_YZ');
  });

  it('prefers the earliest satisfied set when several are satisfied', () => {
    const r = req(
      run({
        evidence: [
          held({ evidence_type_code: 'ID_DOC_B' }),
          held({ evidence_type_code: 'ID_DOC_A' }),
        ],
      }),
      'REQ_IDENTITY',
    );
    expect(r.selected_set_code).toBe('SET_ID_A');
  });

  it('reports PROVIDED_PENDING_VERIFICATION for unverified uploads', () => {
    const r = req(
      run({ evidence: [held({ evidence_type_code: 'ID_DOC_B', verification: 'UNVERIFIED' })] }),
      'REQ_IDENTITY',
    );
    expect(r.status).toBe('PROVIDED_PENDING_VERIFICATION');
    expect(
      run({ evidence: [held({ evidence_type_code: 'ID_DOC_B', verification: 'UNVERIFIED' })] })
        .checklist.complete,
    ).toBe(false);
  });

  it('complete only when every mandatory requirement is satisfied', () => {
    const result = run({
      evidence: [
        held({ evidence_type_code: 'ID_DOC_B' }),
        held({ evidence_type_code: 'PLACE_DOC_X', source: 'UPLOAD' }),
      ],
    });
    expect(result.checklist.complete).toBe(true);
  });
});

describe('DigiLocker versus upload options', () => {
  it('recommends DigiLocker first when preferred and available', () => {
    const r = req(run({ dl: { ID_DOC_A: true } }), 'REQ_IDENTITY');
    const item = r.alternative_sets[0]?.items[0];
    expect(item?.options.map((o) => [o.source, o.availability, o.recommended])).toEqual([
      ['DIGILOCKER', 'AVAILABLE', true],
      ['UPLOAD', 'ALWAYS', false],
    ]);
    expect(item?.options[0]?.document_type_ref).toBe('DL-TYPE-A');
  });

  it('falls back to upload when DigiLocker is unavailable, and reports UNKNOWN when unchecked', () => {
    const unavailable = req(run({ dl: { ID_DOC_A: false } }), 'REQ_IDENTITY').alternative_sets[0]
      ?.items[0];
    expect(unavailable?.options.map((o) => [o.source, o.recommended])).toEqual([
      ['DIGILOCKER', false],
      ['UPLOAD', true],
    ]);
    const unknown = req(run(), 'REQ_IDENTITY').alternative_sets[0]?.items[0];
    expect(unknown?.options[0]?.availability).toBe('UNKNOWN');
    expect(unknown?.options[0]?.recommended).toBe(true);
  });

  it('honours the requirement source_preference over declaration order', () => {
    const policy = samplePolicy();
    (policy.requirements[0] as { source_preference: string[] }).source_preference = ['UPLOAD'];
    const item = req(run({ policy }), 'REQ_IDENTITY').alternative_sets[0]?.items[0];
    expect(item?.options.map((o) => o.source)).toEqual(['UPLOAD', 'DIGILOCKER']);
  });

  it('accepts DigiLocker-sourced evidence as satisfying', () => {
    const r = req(
      run({ evidence: [held({ evidence_type_code: 'ID_DOC_A', source: 'DIGILOCKER' })] }),
      'REQ_IDENTITY',
    );
    expect(r.status).toBe('SATISFIED');
    expect(r.alternative_sets[0]?.items[0]?.source).toBe('DIGILOCKER');
  });
});

describe('evidence constraints', () => {
  const cases: [string, HeldInput, string][] = [
    [
      'expired',
      { evidence_type_code: 'PLACE_DOC_X', expires_at: '2026-10-01T00:00:00.000Z' },
      'EVIDENCE_EXPIRED',
    ],
    [
      'invalid expiry',
      { evidence_type_code: 'PLACE_DOC_X', expires_at: 'invalid' },
      'EVIDENCE_EXPIRED',
    ],
    [
      'stale',
      { evidence_type_code: 'PLACE_DOC_X', issued_at: '2026-01-01T00:00:00.000Z' },
      'EVIDENCE_STALE',
    ],
    [
      'unknown issue date',
      { evidence_type_code: 'PLACE_DOC_X', issued_at: undefined },
      'ISSUE_DATE_UNKNOWN',
    ],
    [
      'weak assurance',
      { evidence_type_code: 'ID_DOC_A', assurance: 'LOW' },
      'ASSURANCE_INSUFFICIENT',
    ],
    [
      'no assurance',
      { evidence_type_code: 'ID_DOC_A', assurance: undefined },
      'ASSURANCE_INSUFFICIENT',
    ],
    [
      'not reusable profile evidence',
      { evidence_type_code: 'ID_DOC_B', scope: 'PROFILE' },
      'NOT_REUSABLE',
    ],
    [
      'advisory only',
      { evidence_type_code: 'ID_DOC_B', verification: 'ADVISORY' },
      'ADVISORY_ONLY',
    ],
    [
      'source not accepted',
      { evidence_type_code: 'ID_DOC_B', source: 'DIGILOCKER' },
      'SOURCE_NOT_ACCEPTED',
    ],
  ];
  for (const [name, partial, reason] of cases) {
    it(`rejects ${name} evidence without satisfying`, () => {
      const result = run({ evidence: [held(partial)] });
      const code = partial.evidence_type_code === 'PLACE_DOC_X' ? 'REQ_PLACE' : 'REQ_IDENTITY';
      const r = req(result, code);
      expect(r.status).toBe('REQUIRED');
      const rejections = r.alternative_sets.flatMap((s) => s.items.flatMap((i) => i.rejections));
      expect(rejections.map((x) => x.reason_code)).toContain(reason);
      expect(
        r.missing_evidence_explanation.some(
          (m) => m.reason_code === reason || m.reason_code === 'EVIDENCE_MISSING',
        ),
      ).toBe(true);
    });
  }

  it('lets reusable profile evidence satisfy a requirement', () => {
    const r = req(
      run({ evidence: [held({ evidence_type_code: 'ID_DOC_A', scope: 'PROFILE' })] }),
      'REQ_IDENTITY',
    );
    expect(r.status).toBe('SATISFIED');
  });

  it('never lets advisory (OCR/AI) evidence satisfy, and surfaces it separately', () => {
    const result = run({
      evidence: [
        held({ evidence_type_code: 'ID_DOC_B', verification: 'ADVISORY', evidence_ref: 'adv-1' }),
      ],
    });
    expect(req(result, 'REQ_IDENTITY').status).toBe('REQUIRED');
    expect(result.checklist.advisory_evidence).toEqual([
      { evidence_ref: 'adv-1', evidence_type_code: 'ID_DOC_B' },
    ]);
  });

  it('ignores held evidence for types outside the policy', () => {
    const result = run({
      evidence: [held({ evidence_type_code: 'UNLISTED', verification: 'ADVISORY' })],
    });
    expect(result.checklist.advisory_evidence).toEqual([]);
  });
});

describe('conditions, exemptions and unknown inputs', () => {
  it('exempts with a policy-defined reason code', () => {
    const r = req(run({ facts: { 'applicant.category': 'Q' } }), 'REQ_IDENTITY');
    expect(r.status).toBe('EXEMPT');
    expect(r.exemption_reason_code).toBe('EXEMPT_CATEGORY_Q');
    expect(r.alternative_sets).toEqual([]);
  });

  it('does not exempt on unknown input and reports the unresolved fact', () => {
    const r = req(run({ facts: {} }), 'REQ_IDENTITY');
    expect(r.status).toBe('REQUIRED');
    expect(r.unresolved_inputs).toEqual(['fact:applicant.category']);
  });

  it('applies conditional requirements from rule outcomes', () => {
    const r = req(run({ rules: { needs_extra: true } }), 'REQ_EXTRA');
    expect(r.status).toBe('OPTIONAL');
    const minor = req(
      run({ rules: { needs_extra: true }, facts: { 'applicant.age': 10 } }),
      'REQ_EXTRA',
    );
    expect(minor.status).toBe('NOT_APPLICABLE');
  });

  it('reports UNDETERMINED when applicability inputs are missing', () => {
    const result = run({ rules: {}, facts: {} });
    const r = req(result, 'REQ_EXTRA');
    expect(r.status).toBe('UNDETERMINED');
    expect(r.unresolved_inputs).toEqual(['fact:applicant.age', 'rule_outcome:needs_extra']);
    expect(result.checklist.complete).toBe(false);
  });

  it('keeps the trace free of input values', () => {
    const result = run({ facts: { 'applicant.category': 'Q' } });
    expect(JSON.stringify(result.trace)).not.toContain('"Q"');
    expect(result.trace[0]?.exemptions[0]?.referenced).toEqual(['fact:applicant.category']);
  });
});

describe('determinism and version pinning', () => {
  it('is replay-deterministic for identical inputs', () => {
    const evidence = [
      held({ evidence_type_code: 'ID_DOC_B' }),
      held({ evidence_type_code: 'PLACE_DOC_Y' }),
    ];
    const a = run({ evidence });
    const b = run({ evidence: [...evidence].reverse() });
    expect(sha256Of(a)).toBe(sha256Of(b));
  });

  it('a changed policy version changes the outcome without altering the pinned version', () => {
    const v1 = samplePolicy();
    const v2 = samplePolicy();
    (v2.requirements[1] as { alternative_sets: unknown[] }).alternative_sets = [
      { code: 'SET_PLACE_ONLY_Z', evidence_type_codes: ['PLACE_DOC_Z'] },
    ];
    const evidence = [held({ evidence_type_code: 'PLACE_DOC_Z' })];
    expect(req(run({ policy: v1, evidence }), 'REQ_PLACE').status).toBe('REQUIRED');
    expect(req(run({ policy: v2, evidence }), 'REQ_PLACE').status).toBe('SATISFIED');
    expect(req(run({ policy: v1, evidence }), 'REQ_PLACE').status).toBe('REQUIRED');
    expect(sha256Of(v1)).not.toBe(sha256Of(v2));
  });
});
