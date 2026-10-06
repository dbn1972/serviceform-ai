/**
 * Outbound port to CMP-025 Notification (M06). CMP-029 only states that a breach or escalation
 * occurred, with identifiers and codes. Channel selection, templates, recipients and delivery
 * providers belong to CMP-025 and are intentionally absent here.
 */
export interface SlaNotificationRequest {
  notification_port: 'M06_CMP025';
  tenant_id: string;
  application_id: string;
  clock_id: string;
  kind: 'SLA_BREACH_APPROACHING' | 'SLA_BREACHED' | 'SLA_ESCALATED';
  escalation_level: number;
  escalation_action_code: string | null;
  source_event_id: string;
}

export interface SlaNotificationPort {
  /** Called only after the authoritative transaction commits. Failures never undo SLA state. */
  requestNotification(request: SlaNotificationRequest): Promise<void>;
}

/** Default binding until CMP-025 exists: the domain event in the outbox is the only record. */
export class UnboundNotificationPort implements SlaNotificationPort {
  requestNotification(_request: SlaNotificationRequest): Promise<void> {
    return Promise.resolve();
  }
}
