/**
 * Officer-facing status chrome helpers.
 * Prefer a single status tag; show platform_state only when it differs from workbench status.
 * Tag text keeps the platform enum (shared with e2e); tonal class maps severity.
 * CERTIFIED=false — presentation only; CMP-015 remains authoritative.
 */

const HUMAN_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
  SUBMITTED: 'Submitted',
  RECEIVED: 'Received',
  UNDER_SCRUTINY: 'Under scrutiny',
  DECISION_PENDING: 'Decision pending',
  DEFICIENCY_RAISED: 'Deficiency raised',
  CITIZEN_RESPONSE: 'Citizen response',
  APPROVED: 'Approved',
  SIGNING_PENDING: 'Signing pending',
  ISSUED: 'Issued',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
  OPEN: 'Open',
  RESPONSE_RECEIVED: 'Response received',
  CLAIMED: 'Claimed',
  UNCLAIMED: 'Unclaimed',
  COMPLETED: 'Completed',
  ACTION_REQUIRED: 'Action required',
};

export function humanStatusLabel(code: string): string {
  if (!code) return 'Unknown';
  return (
    HUMAN_STATUS[code] ??
    code
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function statusTagClass(status: string): string {
  switch (status) {
    case 'ISSUED':
    case 'APPROVED':
    case 'COMPLETED':
    case 'CLOSED':
      return 'ux4g-tag-tonal-success';
    case 'REJECTED':
    case 'CANCELLED':
      return 'ux4g-tag-tonal-error';
    case 'SUBMITTED':
    case 'RECEIVED':
    case 'UNDER_SCRUTINY':
    case 'DECISION_PENDING':
    case 'CLAIMED':
      return 'ux4g-tag-tonal-info';
    case 'DEFICIENCY_RAISED':
    case 'CITIZEN_RESPONSE':
    case 'SIGNING_PENDING':
    case 'ACTION_REQUIRED':
      return 'ux4g-tag-tonal-warning';
    default:
      return 'ux4g-tag-tonal-neutral';
  }
}

export type StatusChrome = {
  primary: { label: string; tagClass: string; code: string; title: string };
  /** Present only when platform_state differs from workbench status. */
  platformDiff?: { label: string; tagClass: string; code: string; title: string };
};

/** Single status tag (enum text + tonal class); add platformDiff only when strings differ. */
export function statusChrome(status: string, platformState: string): StatusChrome {
  const primary = {
    label: status,
    tagClass: statusTagClass(status),
    code: status,
    title: humanStatusLabel(status),
  };
  if (!platformState || platformState === status) {
    return { primary };
  }
  return {
    primary,
    platformDiff: {
      label: platformState,
      tagClass: 'ux4g-tag-tonal-neutral',
      code: platformState,
      title: humanStatusLabel(platformState),
    },
  };
}
