export const INSPECTION_STATES = [
  'REQUESTED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type InspectionState = (typeof INSPECTION_STATES)[number];

export const OPERATIONS = [
  'CREATE',
  'SCHEDULE',
  'REASSIGN',
  'START',
  'RECORD_CHECKLIST',
  'RECORD_OBSERVATION',
  'ATTACH_EVIDENCE',
  'RECORD_FINDING',
  'RECORD_RESULT',
  'COMPLETE',
  'CANCEL',
  'REINSPECT',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const TERMINAL_STATES: readonly InspectionState[] = ['COMPLETED', 'CANCELLED'];

export function isTerminal(state: InspectionState): boolean {
  return TERMINAL_STATES.includes(state);
}

const SOURCES: Record<Exclude<Operation, 'CREATE' | 'REINSPECT'>, readonly InspectionState[]> = {
  SCHEDULE: ['REQUESTED'],
  REASSIGN: ['REQUESTED', 'SCHEDULED'],
  START: ['REQUESTED', 'SCHEDULED'],
  RECORD_CHECKLIST: ['IN_PROGRESS'],
  RECORD_OBSERVATION: ['IN_PROGRESS'],
  ATTACH_EVIDENCE: ['IN_PROGRESS'],
  RECORD_FINDING: ['IN_PROGRESS'],
  RECORD_RESULT: ['IN_PROGRESS'],
  COMPLETE: ['IN_PROGRESS'],
  CANCEL: ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS'],
};

export function canApply(
  operation: Exclude<Operation, 'CREATE' | 'REINSPECT'>,
  from: InspectionState,
): boolean {
  return SOURCES[operation].includes(from);
}

export function targetState(
  operation: Exclude<Operation, 'CREATE' | 'REINSPECT'>,
  from: InspectionState,
): InspectionState {
  switch (operation) {
    case 'SCHEDULE':
      return 'SCHEDULED';
    case 'REASSIGN':
      return from;
    case 'START':
      return 'IN_PROGRESS';
    case 'COMPLETE':
      return 'COMPLETED';
    case 'CANCEL':
      return 'CANCELLED';
    default:
      return 'IN_PROGRESS';
  }
}

export const EVENT_TYPE: Record<Operation, string> = {
  CREATE: 'InspectionRequested',
  SCHEDULE: 'InspectionScheduled',
  REASSIGN: 'InspectionReassigned',
  START: 'InspectionStarted',
  RECORD_CHECKLIST: 'InspectionChecklistRecorded',
  RECORD_OBSERVATION: 'InspectionObservationRecorded',
  ATTACH_EVIDENCE: 'InspectionEvidenceAttached',
  RECORD_FINDING: 'InspectionFindingRecorded',
  RECORD_RESULT: 'InspectionResultRecorded',
  COMPLETE: 'InspectionCompleted',
  CANCEL: 'InspectionCancelled',
  REINSPECT: 'InspectionReinspectionRequested',
};

export const AUTHZ_ACTION: Record<Operation, string> = {
  CREATE: 'INSPECTION_CREATE',
  SCHEDULE: 'INSPECTION_SCHEDULE',
  REASSIGN: 'INSPECTION_REASSIGN',
  START: 'INSPECTION_START',
  RECORD_CHECKLIST: 'INSPECTION_RECORD_CHECKLIST',
  RECORD_OBSERVATION: 'INSPECTION_RECORD_OBSERVATION',
  ATTACH_EVIDENCE: 'INSPECTION_ATTACH_EVIDENCE',
  RECORD_FINDING: 'INSPECTION_RECORD_FINDING',
  RECORD_RESULT: 'INSPECTION_RECORD_RESULT',
  COMPLETE: 'INSPECTION_COMPLETE',
  CANCEL: 'INSPECTION_CANCEL',
  REINSPECT: 'INSPECTION_REINSPECT',
};
