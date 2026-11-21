/**
 * Studio fee designer model. Compiles to CMP-033 FEE payloads (`items` with amount_minor).
 * SAMPLE_LAB_DUMMY overlays are labeled non-statutory; never invent real fee schedules.
 */

export type FeePolicyKind = 'SAMPLE_LAB_DUMMY' | 'ZERO' | 'CONFIGURED';

export interface FeeItem {
  id: string;
  /** Document-key style id stored in CMP-033 (`fee.base`). */
  key: string;
  label: string;
  amount_minor: number;
  /** Optional line description code (SAMPLE_LAB_DUMMY_FEE). */
  description_code?: string;
}

export interface FeeDesign {
  packKey: string;
  title: string;
  version: string;
  currency: string;
  policyKind: FeePolicyKind;
  /** Citizen-facing amount banner (may include SAMPLE_LAB DUMMY). */
  amountDisplay: string;
  feeScheduleRef: string;
  items: FeeItem[];
  /** Lab-only disclaimer; never presented as statute. */
  notStatutory: boolean;
}

export const FEE_CURRENCIES = ['INR'] as const;
