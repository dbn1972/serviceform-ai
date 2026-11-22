import { contentHash } from '../hash';
import { newId, moveById } from '../common';
import { compileSlaExecutable, slaPinHash, type SlaExecutable } from './compile';
import { slaDocumentKey } from './lint';
import type { SlaClock, SlaDesign } from './model';

export const SLA_DESIGNER_TOOL = 'SF_STUDIO_SLA_DESIGNER';

export function blankSla(packKey = 'lab.new-service.sla', title = 'New SLA clocks'): SlaDesign {
  return {
    packKey,
    title,
    version: '1.0.0',
    startEventLabel: 'APPLICATION_SUBMITTED',
    completionLabel: 'DECISION_RECORDED',
    clocks: [
      {
        id: newId('clock'),
        key: 'clock.processing',
        label: 'Processing clock',
        duration_iso: 'P7D',
        pause_reason_codes: ['DEFICIENCY_OPEN'],
      },
    ],
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

/** IND-SOC-002 SAMPLE_LAB public sample: 10 working-day style period as P10D ISO (lab overlay). */
export function residenceSampleSla(): SlaDesign {
  return {
    packKey: 'lab.ind-soc-002.sla',
    title: 'Residence Certificate SLA (SAMPLE_LAB)',
    version: '1.0.0',
    startEventLabel: 'APPLICATION_SUBMITTED',
    completionLabel: 'DECISION_RECORDED',
    clocks: [
      {
        id: 'clock_processing',
        key: 'clock.processing',
        label: 'Processing (public sample 10 working days → P10D lab ISO)',
        duration_iso: 'P10D',
        pause_reason_codes: ['DEFICIENCY_OPEN'],
      },
    ],
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

/** IND-SOC-031 SAMPLE_LAB DUMMY: 15 working-day style period as P15D ISO (M11 dry-run). */
export function incomeCertificateDummySla(): SlaDesign {
  return {
    packKey: 'lab.ind-soc-031.sla',
    title: 'Income Certificate SLA (SAMPLE_LAB DUMMY)',
    version: '1.0.0',
    startEventLabel: 'APPLICATION_SUBMITTED',
    completionLabel: 'DECISION_RECORDED',
    clocks: [
      {
        id: 'clock_processing',
        key: 'clock.processing',
        label: 'Processing (SAMPLE_LAB DUMMY 15 working days → P15D lab ISO)',
        duration_iso: 'P15D',
        pause_reason_codes: ['DEFICIENCY_OPEN'],
      },
    ],
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

export const SLA_TEMPLATES = [
  {
    id: 'ind-soc-002-sla',
    title: 'Residence Certificate SLA',
    description:
      'SAMPLE_LAB overlay from the public sample policy (10 working days as P10D). Not statute.',
    create: residenceSampleSla,
  },
  {
    id: 'ind-soc-031-sla',
    title: 'Income Certificate SLA (SAMPLE_LAB DUMMY)',
    description:
      'IND-SOC-031 M11 dry-run overlay (15 working days as P15D). Not statute; SF-33 gates PUBLISH.',
    create: incomeCertificateDummySla,
  },
] as const;

export function addSlaClock(design: SlaDesign): { design: SlaDesign; id: string } {
  const id = newId('clock');
  const clock: SlaClock = {
    id,
    key: `clock.line_${design.clocks.length + 1}`,
    label: 'New clock',
    duration_iso: 'P7D',
    pause_reason_codes: ['DEFICIENCY_OPEN'],
  };
  return { design: { ...design, clocks: [...design.clocks, clock] }, id };
}

export function updateSlaClock(
  design: SlaDesign,
  id: string,
  patch: Partial<Omit<SlaClock, 'id'>>,
): SlaDesign {
  return {
    ...design,
    clocks: design.clocks.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

export function removeSlaClock(design: SlaDesign, id: string): SlaDesign {
  return { ...design, clocks: design.clocks.filter((c) => c.id !== id) };
}

export function moveSlaClock(design: SlaDesign, id: string, delta: number): SlaDesign {
  return { ...design, clocks: moveById(design.clocks, id, delta) };
}

export function updateSla(design: SlaDesign, patch: Partial<SlaDesign>): SlaDesign {
  return { ...design, ...patch };
}

export interface SlaDocumentPayload {
  clocks: { id: string; duration_iso: string; pause_reason_codes?: string[] }[];
  start_event_label: string;
  completion_label: string;
  policy_kind: SlaDesign['policyKind'];
  not_statutory: boolean;
  content_hash: string;
  authoring: {
    tool: typeof SLA_DESIGNER_TOOL;
    model_version: 1;
    version: string;
    title: string;
    design: SlaDesign;
  };
}

export interface CompiledSla {
  documentKey: string;
  contentHash: string;
  designHash: string;
  payload: SlaDocumentPayload;
  executable: SlaExecutable;
}

export async function buildSlaDocument(design: SlaDesign): Promise<CompiledSla> {
  const executable = compileSlaExecutable(design);
  const hash = await slaPinHash(design);
  return {
    documentKey: slaDocumentKey(design),
    contentHash: hash,
    designHash: await contentHash(design),
    executable,
    payload: {
      clocks: executable.clocks,
      start_event_label: executable.start_event_label,
      completion_label: executable.completion_label,
      policy_kind: executable.policy_kind,
      not_statutory: executable.not_statutory,
      content_hash: hash,
      authoring: {
        tool: SLA_DESIGNER_TOOL,
        model_version: 1,
        version: design.version,
        title: design.title,
        design,
      },
    },
  };
}

export function slaDocumentOf(payload: unknown): { design: SlaDesign; contentHash: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<SlaDocumentPayload>;
  const design = p.authoring?.design;
  if (!design || typeof p.content_hash !== 'string' || !Array.isArray(design.clocks)) return null;
  if (p.authoring?.tool !== SLA_DESIGNER_TOOL) return null;
  return { design, contentHash: p.content_hash };
}
