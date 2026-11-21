import { pinHash } from '../common';
import type { EvidenceDesign, EvidenceRequirement } from './model';

export interface EvidenceExecutable {
  requirements: {
    id: string;
    artifact_type: string;
    required?: boolean;
    label?: string;
    guidance?: string;
  }[];
  policy_kind: EvidenceDesign['policyKind'];
  not_statutory: boolean;
}

export function compileEvidenceExecutable(design: EvidenceDesign): EvidenceExecutable {
  return {
    requirements: design.requirements.map((r: EvidenceRequirement) => ({
      id: r.key,
      artifact_type: r.artifact_type,
      required: r.required,
      label: r.label,
      ...(r.guidance ? { guidance: r.guidance } : {}),
    })),
    policy_kind: design.policyKind,
    not_statutory: design.notStatutory,
  };
}

/** Pin hash over CMP-033 structural requirements (id + artifact_type). */
export function evidencePinHash(design: EvidenceDesign): Promise<string> {
  return pinHash({
    requirements: design.requirements.map((r) => ({
      id: r.key,
      artifact_type: r.artifact_type,
    })),
  });
}
