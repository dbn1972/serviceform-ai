import type { ActorType, Uuid } from '@serviceform/contracts';

export type PrivilegedStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';

export interface PrivilegedAccessRecord {
  id: Uuid;
  tenant_id: Uuid;
  grantee_user_id: Uuid;
  grantee_actor_type: ActorType;
  access_kind: 'SUPPORT_CASE' | 'BREAK_GLASS';
  purpose_code: string;
  justification: string;
  support_ticket_ref?: string;
  scope_actions: string[];
  scope_resource_types: string[];
  requested_by: Uuid;
  requested_at: string;
  approved_by?: Uuid;
  approved_at?: string;
  status: PrivilegedStatus;
  starts_at: string;
  expires_at: string;
  version: number;
}
