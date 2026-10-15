import type {
  AppointmentEventLogRow,
  AppointmentRecord,
  AppointmentTypeRecord,
  SlotRecord,
} from '../domain/appointment.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface SchedulerTx {
  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'>;
  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;
  insertType(row: AppointmentTypeRecord): Promise<void>;
  getType(typeId: string): Promise<AppointmentTypeRecord | undefined>;
  getTypeByRef(typeRef: string): Promise<AppointmentTypeRecord | undefined>;
  insertSlot(row: SlotRecord): Promise<void>;
  getSlot(slotId: string, forUpdate?: boolean): Promise<SlotRecord | undefined>;
  getSlotByRef(slotRef: string, forUpdate?: boolean): Promise<SlotRecord | undefined>;
  listAvailableSlots(appointmentTypeId: string | undefined): Promise<SlotRecord[]>;
  updateSlotBooked(row: SlotRecord): Promise<void>;
  insertAppointment(row: AppointmentRecord): Promise<void>;
  getAppointment(
    appointmentId: string,
    forUpdate?: boolean,
  ): Promise<AppointmentRecord | undefined>;
  updateAppointment(row: AppointmentRecord): Promise<void>;
  insertEventLog(row: AppointmentEventLogRow): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface SchedulerRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: SchedulerTx) => Promise<T>): Promise<T>;
}
