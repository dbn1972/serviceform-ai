import { pinHash } from '../common';
import type { SlaClock, SlaDesign } from './model';

export interface SlaExecutable {
  clocks: {
    id: string;
    duration_iso: string;
    pause_reason_codes?: string[];
  }[];
  start_event_label: string;
  completion_label: string;
  policy_kind: SlaDesign['policyKind'];
  not_statutory: boolean;
}

export function compileSlaExecutable(design: SlaDesign): SlaExecutable {
  return {
    clocks: design.clocks.map((c: SlaClock) => ({
      id: c.key,
      duration_iso: c.duration_iso,
      ...(c.pause_reason_codes.length > 0 ? { pause_reason_codes: [...c.pause_reason_codes] } : {}),
    })),
    start_event_label: design.startEventLabel,
    completion_label: design.completionLabel,
    policy_kind: design.policyKind,
    not_statutory: design.notStatutory,
  };
}

export function slaPinHash(design: SlaDesign): Promise<string> {
  return pinHash({
    clocks: design.clocks.map((c) => ({
      id: c.key,
      duration_iso: c.duration_iso,
    })),
  });
}
