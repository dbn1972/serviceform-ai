import { contentHash } from '../hash';
import { newId, moveById } from '../common';
import { compileFeeExecutable, type FeeExecutable } from './compile';
import { feeDocumentKey } from './lint';
import type { FeeDesign, FeeItem } from './model';

export const FEE_DESIGNER_TOOL = 'SF_STUDIO_FEE_DESIGNER';

export function blankFee(packKey = 'lab.new-service.fee', title = 'New fee schedule'): FeeDesign {
  return {
    packKey,
    title,
    version: '1.0.0',
    currency: 'INR',
    policyKind: 'SAMPLE_LAB_DUMMY',
    amountDisplay: 'SAMPLE_LAB DUMMY · ₹0.00',
    feeScheduleRef: 'SAMPLE_LAB_DUMMY_FEE_SCHEDULE',
    items: [
      {
        id: newId('fee'),
        key: 'fee.base',
        label: 'Base fee',
        amount_minor: 0,
        description_code: 'SAMPLE_LAB_DUMMY_FEE',
      },
    ],
    notStatutory: true,
  };
}

/** IND-EDU-004 SAMPLE_LAB DUMMY fee>0 overlay (₹9.99) — not statute. */
export function transferCertificateDummyFee(): FeeDesign {
  return {
    packKey: 'lab.ind-edu-004.fee',
    title: 'SAMPLE_LAB DUMMY · Transfer Certificate fee',
    version: '1.0.0',
    currency: 'INR',
    policyKind: 'SAMPLE_LAB_DUMMY',
    amountDisplay: 'SAMPLE_LAB DUMMY · ₹9.99',
    feeScheduleRef: 'SAMPLE_LAB_DUMMY_FEE_SCHEDULE',
    items: [
      {
        id: 'fee_base',
        key: 'fee.base',
        label: 'SAMPLE_LAB DUMMY base fee',
        amount_minor: 999,
        description_code: 'SAMPLE_LAB_DUMMY_FEE',
      },
    ],
    notStatutory: true,
  };
}

/** Residence Certificate public sample is ₹0 (ZERO policy). */
export function residenceZeroFee(): FeeDesign {
  return {
    packKey: 'lab.ind-soc-002.fee',
    title: 'Residence Certificate fee (zero)',
    version: '1.0.0',
    currency: 'INR',
    policyKind: 'ZERO',
    amountDisplay: '₹0',
    feeScheduleRef: 'SAMPLE_LAB_ZERO_FEE',
    items: [
      {
        id: 'fee_base',
        key: 'fee.base',
        label: 'Application fee',
        amount_minor: 0,
      },
    ],
    notStatutory: false,
  };
}

export const FEE_TEMPLATES = [
  {
    id: 'ind-edu-004-dummy',
    title: 'Transfer Certificate SAMPLE_LAB DUMMY fee',
    description: 'IND-EDU-004 lab overlay ₹9.99 — labeled SAMPLE_LAB DUMMY, not statute.',
    create: transferCertificateDummyFee,
  },
  {
    id: 'ind-soc-002-zero',
    title: 'Residence Certificate zero fee',
    description: 'IND-SOC-002 public sample: amount_minor 0.',
    create: residenceZeroFee,
  },
] as const;

export function addFeeItem(design: FeeDesign): { design: FeeDesign; id: string } {
  const id = newId('fee');
  const item: FeeItem = {
    id,
    key: `fee.line_${design.items.length + 1}`,
    label: 'New fee line',
    amount_minor: 0,
    ...(design.policyKind === 'SAMPLE_LAB_DUMMY'
      ? { description_code: 'SAMPLE_LAB_DUMMY_FEE' }
      : {}),
  };
  return { design: { ...design, items: [...design.items, item] }, id };
}

export function updateFeeItem(
  design: FeeDesign,
  id: string,
  patch: Partial<Omit<FeeItem, 'id'>>,
): FeeDesign {
  return {
    ...design,
    items: design.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  };
}

export function removeFeeItem(design: FeeDesign, id: string): FeeDesign {
  return { ...design, items: design.items.filter((i) => i.id !== id) };
}

export function moveFeeItem(design: FeeDesign, id: string, delta: number): FeeDesign {
  return { ...design, items: moveById(design.items, id, delta) };
}

export function updateFee(design: FeeDesign, patch: Partial<FeeDesign>): FeeDesign {
  return { ...design, ...patch };
}

/** Pin hash is over structural `items` only (CMP-033 FEE kind). */
export async function feeItemsHash(design: FeeDesign): Promise<string> {
  return contentHash({
    items: design.items.map((i) => ({
      id: i.key,
      amount_minor: i.amount_minor,
      ...(i.description_code ? { description_code: i.description_code } : {}),
    })),
  });
}

export interface FeeDocumentPayload {
  items: FeeExecutable['items'];
  currency: string;
  fee_schedule_ref: string;
  amount_display: string;
  policy_kind: FeeDesign['policyKind'];
  not_statutory: boolean;
  content_hash: string;
  authoring: {
    tool: typeof FEE_DESIGNER_TOOL;
    model_version: 1;
    version: string;
    title: string;
    design: FeeDesign;
  };
}

export interface CompiledFee {
  documentKey: string;
  contentHash: string;
  designHash: string;
  payload: FeeDocumentPayload;
  executable: FeeExecutable;
}

export async function buildFeeDocument(design: FeeDesign): Promise<CompiledFee> {
  const executable = compileFeeExecutable(design);
  const hash = await feeItemsHash(design);
  return {
    documentKey: feeDocumentKey(design),
    contentHash: hash,
    designHash: await contentHash(design),
    executable,
    payload: {
      items: executable.items,
      currency: executable.currency,
      fee_schedule_ref: executable.fee_schedule_ref,
      amount_display: executable.amount_display,
      policy_kind: executable.policy_kind,
      not_statutory: executable.not_statutory,
      content_hash: hash,
      authoring: {
        tool: FEE_DESIGNER_TOOL,
        model_version: 1,
        version: design.version,
        title: design.title,
        design,
      },
    },
  };
}

export function feeDocumentOf(payload: unknown): { design: FeeDesign; contentHash: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<FeeDocumentPayload>;
  const design = p.authoring?.design;
  if (!design || typeof p.content_hash !== 'string' || !Array.isArray(design.items)) return null;
  if (p.authoring?.tool !== FEE_DESIGNER_TOOL) return null;
  return { design, contentHash: p.content_hash };
}
