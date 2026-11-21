import {
  SAMPLE_LAB_GRIEVANCE_CATEGORIES,
  SAMPLE_LAB_GRIEVANCE_ROUTING,
  isSampleLabGrievanceCategory,
  type SampleLabGrievanceCategoryCode,
} from '@serviceform/m10-sample-lab';
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

export interface PortalGrievance {
  grievance_id: string;
  reference_code: string;
  status: string;
  status_label: string;
  category_code: string | null;
  category_label: string | null;
  application_id: string | null;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
  can_withdraw: boolean;
  can_respond: boolean;
  can_request_escalation: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  FILED: 'Filed',
  CATEGORISED: 'Categorised',
  ROUTED: 'Routed to desk',
  OPEN: 'Open with helpdesk',
  PENDING_RESPONSE: 'Awaiting your reply',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
};

export function categoryLabel(code: string | null): string | null {
  if (!code) return null;
  return SAMPLE_LAB_GRIEVANCE_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

export function toPortalGrievance(g: PlatformGrievance): PortalGrievance {
  const status = g.status;
  return {
    grievance_id: g.grievance_id,
    reference_code: g.reference_code,
    status,
    status_label: STATUS_LABELS[status] ?? status,
    category_code: g.category_code,
    category_label: categoryLabel(g.category_code),
    application_id: g.application_id,
    aggregate_version: g.aggregate_version,
    created_at: g.created_at,
    updated_at: g.updated_at,
    can_withdraw: ['FILED', 'CATEGORISED', 'ROUTED', 'OPEN', 'PENDING_RESPONSE'].includes(status),
    can_respond: status === 'OPEN' || status === 'PENDING_RESPONSE',
    can_request_escalation:
      SAMPLE_LAB_GRIEVANCE_ROUTING.citizen_may_request_escalation &&
      (status === 'OPEN' || status === 'PENDING_RESPONSE'),
  };
}

export function parseCategory(value: unknown): SampleLabGrievanceCategoryCode | null {
  return isSampleLabGrievanceCategory(value) ? value : null;
}

/** Opaque SIMULATED body ref — never store free-text PII in CMP-027 body_ref. */
export function simulatedBodyRef(note: string): string {
  const trimmed = note.trim().slice(0, 80);
  const slug = trimmed
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `lab-body:${slug || 'note'}:${randomUUID()}`;
}

export { SAMPLE_LAB_GRIEVANCE_CATEGORIES };
