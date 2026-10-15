import type { ActorType } from '../types.js';

export type SlotStatus = 'OPEN' | 'CLOSED';

/**
 * A bookable slot is explicit tenant-published metadata (start, end, capacity). CMP-056 holds no
 * built-in business calendar, holiday list, working-hours rule or statutory hearing/inspection
 * calendar; any such policy is authored upstream and arrives here only as concrete slots.
 */
export interface SlotRow {
  tenant_id: string;
  slot_id: string;
  slot_ref: string;
  appointment_type_ref: string;
  resource_calendar_ref: string | null;
  jurisdiction_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  status: SlotStatus;
  actor_type: ActorType;
  created_by: string;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export const MAX_SLOT_CAPACITY = 10_000;

export interface SlotView {
  slot_id: string;
  slot_ref: string;
  appointment_type_ref: string;
  resource_calendar_ref: string | null;
  jurisdiction_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  remaining_capacity: number;
  status: SlotStatus;
  capacity_atomic: true;
}

export function slotView(row: SlotRow): SlotView {
  return {
    slot_id: row.slot_id,
    slot_ref: row.slot_ref,
    appointment_type_ref: row.appointment_type_ref,
    resource_calendar_ref: row.resource_calendar_ref,
    jurisdiction_id: row.jurisdiction_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    capacity: row.capacity,
    booked_count: row.booked_count,
    remaining_capacity: Math.max(0, row.capacity - row.booked_count),
    status: row.status,
    capacity_atomic: true,
  };
}

export type SlotUnavailableReason =
  'SLOT_CLOSED' | 'SLOT_ALREADY_STARTED' | 'SLOT_CAPACITY_EXHAUSTED';

/** Explains why a conditional reservation affected no row (read after the failed reserve). */
export function unavailableReason(row: SlotRow, now: Date): SlotUnavailableReason {
  if (row.status !== 'OPEN') return 'SLOT_CLOSED';
  if (Date.parse(row.starts_at) <= now.getTime()) return 'SLOT_ALREADY_STARTED';
  return 'SLOT_CAPACITY_EXHAUSTED';
}
