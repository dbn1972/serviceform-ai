import { validate, type AuditEvent } from '@serviceform/contracts';

export interface AuditSink {
  emit(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async emit(event: AuditEvent): Promise<void> {
    const check = validate('audit-event', event);
    if (!check.valid) throw new Error('audit event failed SF-CON-AUDIT-EVENT');
    this.events.push(event);
  }
}
