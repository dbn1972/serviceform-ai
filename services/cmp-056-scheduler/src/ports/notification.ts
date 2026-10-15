/**
 * INT-014 / CMP-025 notification port. Booking commits before notify is attempted.
 * A failure here MUST NOT invalidate a committed booking
 * (SF-CON-APPOINTMENT.notification_failure_invalidates_booking = false).
 */
export interface AppointmentNotifyRequest {
  tenant_id: string;
  appointment_id: string;
  appointment_type_ref: string;
  slot_ref: string;
  lifecycle_status: string;
  correlation_id: string;
}

export interface NotificationPort {
  notifyAppointment(req: AppointmentNotifyRequest): Promise<void>;
}
