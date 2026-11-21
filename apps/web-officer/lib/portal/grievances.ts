import {
  SAMPLE_LAB_GRIEVANCE_ESCALATION,
  SAMPLE_LAB_GRIEVANCE_ROUTING,
  nextEscalationLevel,
} from '@serviceform/m10-sample-lab/grievance-catalogue';
import { randomUUID } from 'node:crypto';

export interface PlatformGrievance {
  grievance_id: string;
  kind: string;
  status: string;
  aggregate_version: number;
  reference_code: string;
  category_code: string | null;
  service_id: string | null;
  application_id: string | null;
  organisation_id: string | null;
  jurisdiction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalHelpdeskTicket {
  grievance_id: string;
  reference_code: string;
  status: string;
  status_label: string;
  category_code: string | null;
  application_id: string | null;
  aggregate_version: number;
  assignment_role_code: string | null;
  can_route: boolean;
  can_assign: boolean;
  can_respond: boolean;
  can_resolve: boolean;
  can_close: boolean;
  can_escalate: boolean;
  next_escalation_level: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  FILED: 'Filed',
  CATEGORISED: 'Needs routing',
  ROUTED: 'Needs assignment',
  OPEN: 'Open',
  PENDING_RESPONSE: 'Citizen reply pending',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
};

export function toHelpdeskTicket(
  g: PlatformGrievance,
  assignmentRoleCode: string | null = null,
): PortalHelpdeskTicket {
  const nextLevel = nextEscalationLevel(assignmentRoleCode);
  return {
    grievance_id: g.grievance_id,
    reference_code: g.reference_code,
    status: g.status,
    status_label: STATUS_LABELS[g.status] ?? g.status,
    category_code: g.category_code,
    application_id: g.application_id,
    aggregate_version: g.aggregate_version,
    assignment_role_code: assignmentRoleCode,
    can_route: g.status === 'CATEGORISED',
    can_assign: g.status === 'ROUTED',
    can_respond: g.status === 'OPEN' || g.status === 'PENDING_RESPONSE',
    can_resolve: g.status === 'OPEN' || g.status === 'PENDING_RESPONSE',
    can_close: g.status === 'RESOLVED',
    can_escalate: (g.status === 'OPEN' || g.status === 'PENDING_RESPONSE') && nextLevel !== null,
    next_escalation_level: nextLevel,
  };
}

export function labAssignment(level: number) {
  const step = SAMPLE_LAB_GRIEVANCE_ESCALATION.find((e) => e.level === level);
  if (!step) return null;
  return {
    role_code: step.role_code,
    organisation_id: SAMPLE_LAB_GRIEVANCE_ROUTING.organisation_id,
    office_id: SAMPLE_LAB_GRIEVANCE_ROUTING.office_id,
    jurisdiction_id: SAMPLE_LAB_GRIEVANCE_ROUTING.jurisdiction_id,
    service_scope_id: null as string | null,
  };
}

export function simulatedBodyRef(note: string): string {
  const slug = note
    .trim()
    .slice(0, 40)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `lab-body:${slug || 'officer'}:${randomUUID()}`;
}

export { SAMPLE_LAB_GRIEVANCE_ESCALATION };
