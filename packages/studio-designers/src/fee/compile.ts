import { pinHash } from '../common';
import type { FeeDesign, FeeItem } from './model';

/** Executable CMP-033 FEE payload (structural). */
export interface FeeExecutable {
  items: { id: string; amount_minor: number; description_code?: string }[];
  currency: string;
  fee_schedule_ref: string;
  amount_display: string;
  policy_kind: FeeDesign['policyKind'];
  not_statutory: boolean;
}

export function compileFeeExecutable(design: FeeDesign): FeeExecutable {
  return {
    items: design.items.map((item: FeeItem) => ({
      id: item.key,
      amount_minor: item.amount_minor,
      ...(item.description_code ? { description_code: item.description_code } : {}),
    })),
    currency: design.currency,
    fee_schedule_ref: design.feeScheduleRef,
    amount_display: design.amountDisplay,
    policy_kind: design.policyKind,
    not_statutory: design.notStatutory,
  };
}

export function feePinHash(design: FeeDesign): Promise<string> {
  return pinHash(compileFeeExecutable(design));
}
