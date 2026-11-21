/**
 * Studio evidence designer model. Compiles to CMP-033 EVIDENCE payloads (`requirements`).
 * SAMPLE_LAB_DUMMY labels OK; never invent statutory evidence lists as real policy.
 */

export interface EvidenceRequirement {
  id: string;
  key: string;
  label: string;
  artifact_type: string;
  required: boolean;
  /** Optional guidance shown to applicants (lab copy). */
  guidance?: string;
}

export interface EvidenceDesign {
  packKey: string;
  title: string;
  version: string;
  requirements: EvidenceRequirement[];
  notStatutory: boolean;
  policyKind: 'SAMPLE_LAB_DUMMY' | 'CONFIGURED';
}
