/**
 * Outbound port to CMP-025 Notification (M06). Channel, template, recipient and delivery
 * belong to CMP-025. Called only after the authoritative transaction commits.
 */
export interface DeficiencyNotificationRequest {
  notification_port: 'M06_CMP025';
  tenant_id: string;
  application_id: string;
  deficiency_id: string;
  kind: 'DEFICIENCY_OPENED' | 'DEFICIENCY_RESPONDED' | 'DEFICIENCY_CLOSED';
  source_event_id: string;
}

export interface NotificationPort {
  requestNotification(request: DeficiencyNotificationRequest): Promise<void>;
}

export class UnboundNotificationPort implements NotificationPort {
  requestNotification(_request: DeficiencyNotificationRequest): Promise<void> {
    return Promise.resolve();
  }
}
