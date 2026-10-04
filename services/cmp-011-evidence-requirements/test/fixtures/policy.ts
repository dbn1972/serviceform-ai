import type { EvidencePolicyDefinition } from '../../src/domain/policy.js';

/** Generic synthetic metadata; no statutory content. */
export function samplePolicy(): EvidencePolicyDefinition {
  return {
    schema_version: 1,
    evidence_types: [
      {
        code: 'ID_DOC_A',
        label_key: 'evidence.id_doc_a',
        sources: [{ source: 'DIGILOCKER', document_type_ref: 'DL-TYPE-A' }, { source: 'UPLOAD' }],
        min_assurance: 'SUBSTANTIAL',
        reusable: true,
      },
      {
        code: 'ID_DOC_B',
        label_key: 'evidence.id_doc_b',
        sources: [{ source: 'UPLOAD' }],
        reusable: false,
      },
      {
        code: 'PLACE_DOC_X',
        label_key: 'evidence.place_doc_x',
        sources: [{ source: 'DIGILOCKER', document_type_ref: 'DL-TYPE-X' }, { source: 'UPLOAD' }],
        max_age_days: 90,
        reusable: true,
      },
      {
        code: 'PLACE_DOC_Y',
        label_key: 'evidence.place_doc_y',
        sources: [{ source: 'UPLOAD' }],
        reusable: false,
      },
      {
        code: 'PLACE_DOC_Z',
        label_key: 'evidence.place_doc_z',
        sources: [{ source: 'UPLOAD' }],
        reusable: false,
      },
      {
        code: 'EXTRA_DOC',
        label_key: 'evidence.extra_doc',
        sources: [{ source: 'UPLOAD' }],
        reusable: false,
      },
    ],
    requirements: [
      {
        code: 'REQ_IDENTITY',
        reason_code: 'POLICY_IDENTITY',
        mandatory: true,
        exempt_when: [
          {
            reason_code: 'EXEMPT_CATEGORY_Q',
            when: { ref: { kind: 'fact', key: 'applicant.category' }, op: 'eq', value: 'Q' },
          },
        ],
        alternative_sets: [
          { code: 'SET_ID_A', evidence_type_codes: ['ID_DOC_A'] },
          { code: 'SET_ID_B', evidence_type_codes: ['ID_DOC_B'] },
        ],
        source_preference: ['DIGILOCKER', 'UPLOAD'],
      },
      {
        code: 'REQ_PLACE',
        reason_code: 'POLICY_PLACE',
        mandatory: true,
        exempt_when: [],
        alternative_sets: [
          { code: 'SET_PLACE_X', evidence_type_codes: ['PLACE_DOC_X'] },
          { code: 'SET_PLACE_YZ', evidence_type_codes: ['PLACE_DOC_Y', 'PLACE_DOC_Z'] },
        ],
        source_preference: ['DIGILOCKER'],
      },
      {
        code: 'REQ_EXTRA',
        reason_code: 'POLICY_EXTRA',
        mandatory: false,
        applies_when: {
          all: [
            { ref: { kind: 'rule_outcome', key: 'needs_extra' }, op: 'eq', value: true },
            { not: { ref: { kind: 'fact', key: 'applicant.age' }, op: 'lt', value: 18 } },
          ],
        },
        exempt_when: [],
        alternative_sets: [{ code: 'SET_EXTRA', evidence_type_codes: ['EXTRA_DOC'] }],
        source_preference: [],
      },
    ],
  };
}
