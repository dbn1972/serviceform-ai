import { contentHash } from '../hash';
import { newId, moveById } from '../common';
import { compileEvidenceExecutable, evidencePinHash, type EvidenceExecutable } from './compile';
import { evidenceDocumentKey } from './lint';
import type { EvidenceDesign, EvidenceRequirement } from './model';

export const EVIDENCE_DESIGNER_TOOL = 'SF_STUDIO_EVIDENCE_DESIGNER';

export function blankEvidence(
  packKey = 'lab.new-service.evidence',
  title = 'New evidence requirements',
): EvidenceDesign {
  return {
    packKey,
    title,
    version: '1.0.0',
    requirements: [
      {
        id: newId('req'),
        key: 'req.proof-of-address',
        label: 'Proof of address',
        artifact_type: 'proof_of_address',
        required: true,
      },
    ],
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

/** SAMPLE_LAB residence-style evidence list (DUMMY overlay labels). */
export function residenceSampleEvidence(): EvidenceDesign {
  return {
    packKey: 'lab.ind-soc-002.evidence',
    title: 'Residence Certificate evidence (SAMPLE_LAB)',
    version: '1.0.0',
    requirements: [
      {
        id: 'req_address',
        key: 'req.proof-of-address',
        label: 'SAMPLE_LAB DUMMY · Proof of address',
        artifact_type: 'proof_of_address',
        required: true,
        guidance: 'Upload a document that shows your current address (lab overlay).',
      },
      {
        id: 'req_identity',
        key: 'req.proof-of-identity',
        label: 'SAMPLE_LAB DUMMY · Proof of identity',
        artifact_type: 'proof_of_identity',
        required: true,
      },
    ],
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

/** IND-SOC-031 SAMPLE_LAB DUMMY evidence list (M11 dry-run; not statute). */
export function incomeCertificateDummyEvidence(): EvidenceDesign {
  return {
    packKey: 'lab.ind-soc-031.evidence',
    title: 'Income Certificate evidence (SAMPLE_LAB DUMMY)',
    version: '1.0.0',
    requirements: [
      {
        id: 'req_any',
        key: 'req.sample-lab-dummy-evidence-any',
        label: 'SAMPLE_LAB DUMMY · Evidence (synthetic placeholder)',
        artifact_type: 'document',
        required: true,
        guidance: 'SAMPLE_LAB_DUMMY_EVIDENCE_ANY — not a government accepted-proof catalogue.',
      },
    ],
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

export const EVIDENCE_TEMPLATES = [
  {
    id: 'ind-soc-002-evidence',
    title: 'Residence Certificate evidence',
    description: 'SAMPLE_LAB DUMMY address + identity requirements. Not statute.',
    create: residenceSampleEvidence,
  },
  {
    id: 'ind-soc-031-evidence',
    title: 'Income Certificate evidence (SAMPLE_LAB DUMMY)',
    description:
      'IND-SOC-031 M11 dry-run SAMPLE_LAB_DUMMY_EVIDENCE_ANY. Not statute; SF-33 gates PUBLISH.',
    create: incomeCertificateDummyEvidence,
  },
] as const;

export function addEvidenceRequirement(
  design: EvidenceDesign,
): { design: EvidenceDesign; id: string } {
  const id = newId('req');
  const req: EvidenceRequirement = {
    id,
    key: `req.line_${design.requirements.length + 1}`,
    label: 'New requirement',
    artifact_type: 'document',
    required: true,
  };
  return { design: { ...design, requirements: [...design.requirements, req] }, id };
}

export function updateEvidenceRequirement(
  design: EvidenceDesign,
  id: string,
  patch: Partial<Omit<EvidenceRequirement, 'id'>>,
): EvidenceDesign {
  return {
    ...design,
    requirements: design.requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
}

export function removeEvidenceRequirement(design: EvidenceDesign, id: string): EvidenceDesign {
  return { ...design, requirements: design.requirements.filter((r) => r.id !== id) };
}

export function moveEvidenceRequirement(
  design: EvidenceDesign,
  id: string,
  delta: number,
): EvidenceDesign {
  return { ...design, requirements: moveById(design.requirements, id, delta) };
}

export function updateEvidence(design: EvidenceDesign, patch: Partial<EvidenceDesign>): EvidenceDesign {
  return { ...design, ...patch };
}

export interface EvidenceDocumentPayload {
  requirements: EvidenceExecutable['requirements'];
  policy_kind: EvidenceDesign['policyKind'];
  not_statutory: boolean;
  content_hash: string;
  authoring: {
    tool: typeof EVIDENCE_DESIGNER_TOOL;
    model_version: 1;
    version: string;
    title: string;
    design: EvidenceDesign;
  };
}

export interface CompiledEvidence {
  documentKey: string;
  contentHash: string;
  designHash: string;
  payload: EvidenceDocumentPayload;
  executable: EvidenceExecutable;
}

export async function buildEvidenceDocument(design: EvidenceDesign): Promise<CompiledEvidence> {
  const executable = compileEvidenceExecutable(design);
  const hash = await evidencePinHash(design);
  return {
    documentKey: evidenceDocumentKey(design),
    contentHash: hash,
    designHash: await contentHash(design),
    executable,
    payload: {
      requirements: executable.requirements,
      policy_kind: executable.policy_kind,
      not_statutory: executable.not_statutory,
      content_hash: hash,
      authoring: {
        tool: EVIDENCE_DESIGNER_TOOL,
        model_version: 1,
        version: design.version,
        title: design.title,
        design,
      },
    },
  };
}

export function evidenceDocumentOf(
  payload: unknown,
): { design: EvidenceDesign; contentHash: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<EvidenceDocumentPayload>;
  const design = p.authoring?.design;
  if (!design || typeof p.content_hash !== 'string' || !Array.isArray(design.requirements))
    return null;
  if (p.authoring?.tool !== EVIDENCE_DESIGNER_TOOL) return null;
  return { design, contentHash: p.content_hash };
}
