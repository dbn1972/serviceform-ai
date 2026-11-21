/**
 * Studio SLA designer model. Compiles to CMP-033 SLA payloads (`clocks` with duration_iso).
 * SAMPLE_LAB overlays may use public sample anchors; never invent statutory deadlines.
 */

export interface SlaClock {
  id: string;
  key: string;
  label: string;
  /** ISO-8601 duration accepted by CMP-033 (`P10D`, `PT8H`). */
  duration_iso: string;
  /** Pause reason codes (e.g. DEFICIENCY_OPEN). */
  pause_reason_codes: string[];
}

export interface SlaDesign {
  packKey: string;
  title: string;
  version: string;
  /** Lab label for the start event (informational; CMP-029 owns runtime anchors). */
  startEventLabel: string;
  completionLabel: string;
  clocks: SlaClock[];
  notStatutory: boolean;
  policyKind: 'SAMPLE_LAB_DUMMY' | 'CONFIGURED';
}
