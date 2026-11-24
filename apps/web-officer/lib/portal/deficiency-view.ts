/**
 * Client-safe deficiency loop helpers (CMP-019). No Node imports.
 * Decide stays blocked while any notice is OPEN. CERTIFIED=false. G6=false.
 */

export type DeficiencyLoopPhase =
  'OPEN_AWAITING_CITIZEN' | 'RESPONSE_AWAITING_CLOSE' | 'CLOSED' | 'UNKNOWN';

export interface DeficiencyLoopNotice {
  deficiency_id: string;
  status: string;
  opened_at?: string | null;
  responded_at?: string | null;
  closed_at?: string | null;
  response_due_at?: string | null;
}

export function deficiencyLoopPhase(notice: DeficiencyLoopNotice): DeficiencyLoopPhase {
  if (notice.status === 'OPEN') return 'OPEN_AWAITING_CITIZEN';
  if (notice.status === 'RESPONSE_RECEIVED') return 'RESPONSE_AWAITING_CLOSE';
  if (notice.status === 'CLOSED') return 'CLOSED';
  return 'UNKNOWN';
}

export function deficiencyLoopPhaseLabel(phase: DeficiencyLoopPhase): string {
  switch (phase) {
    case 'OPEN_AWAITING_CITIZEN':
      return 'Awaiting citizen response';
    case 'RESPONSE_AWAITING_CLOSE':
      return 'Citizen responded — close to resume';
    case 'CLOSED':
      return 'Closed';
    default:
      return 'Unknown';
  }
}

/** Officer decide (APPROVE/REJECT) must stay blocked while any deficiency is OPEN. */
export function decideBlockedByOpenDeficiency(notices: readonly DeficiencyLoopNotice[]): {
  blocked: boolean;
  open_count: number;
} {
  const open_count = notices.filter((n) => n.status === 'OPEN').length;
  return { blocked: open_count > 0, open_count };
}

export type DeficiencyTimelineStep = {
  key: 'opened' | 'responded' | 'closed';
  label: string;
  at: string | null;
  done: boolean;
};

export function deficiencyTimeline(notice: DeficiencyLoopNotice): DeficiencyTimelineStep[] {
  return [
    {
      key: 'opened',
      label: 'Raised',
      at: notice.opened_at ?? null,
      done: Boolean(notice.opened_at) || notice.status !== 'UNKNOWN',
    },
    {
      key: 'responded',
      label: 'Citizen responded',
      at: notice.responded_at ?? null,
      done: Boolean(notice.responded_at),
    },
    {
      key: 'closed',
      label: 'Closed',
      at: notice.closed_at ?? null,
      done: Boolean(notice.closed_at) || notice.status === 'CLOSED',
    },
  ];
}
