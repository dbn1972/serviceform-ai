import type { AttemptRow, DispatchRow, TemplateRow } from '../repo/types.js';

/** The FROZEN SF-CON-NOTIFICATION-DISPATCH instance for a stored dispatch. */
export function contractInstance(row: DispatchRow): Record<string, unknown> {
  return {
    contract_id: 'SF-CON-NOTIFICATION-DISPATCH',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    dispatch_id: row.dispatch_id,
    ...(row.application_id === null ? {} : { application_id: row.application_id }),
    template_ref: row.template_ref,
    channel: row.channel,
    locale: row.locale,
    recipient_handle_class: row.recipient_handle_class,
    recipient_handle_ref: row.recipient_handle_ref,
    connector_binding_id: row.connector_binding_id,
    connector_mode: row.connector_mode,
    raw_pii_in_payload_forbidden: true,
    ...(row.connector_mode === 'SIMULATED'
      ? { simulation_marker_required_when_simulated: true }
      : {}),
    idempotency_key: row.idempotency_key,
    correlation_id: row.correlation_id,
  };
}

export function dispatchView(row: DispatchRow, attempts?: AttemptRow[]): Record<string, unknown> {
  return {
    dispatch: contractInstance(row),
    template_version: row.template_version,
    status: row.status,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    next_attempt_at: row.next_attempt_at,
    provider_message_ref: row.provider_message_ref,
    last_error_code: row.last_error_code,
    simulation_marker: row.simulation_marker,
    requested_at: row.requested_at,
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    aggregate_version: row.aggregate_version,
    ...(attempts === undefined
      ? {}
      : {
          attempt_history: attempts.map((a) => ({
            attempt_no: a.attempt_no,
            outcome: a.outcome,
            error_code: a.error_code,
            provider_message_ref: a.provider_message_ref,
            connector_mode: a.connector_mode,
            simulation_marker: a.simulation_marker,
            occurred_at: a.occurred_at,
          })),
        }),
  };
}

export function templateView(row: TemplateRow): Record<string, unknown> {
  return {
    template_ref: row.template_ref,
    template_version: row.template_version,
    channel: row.channel,
    locale: row.locale,
    subject_template: row.subject_template,
    body_template: row.body_template,
    allowed_params: row.allowed_params,
    published_at: row.published_at,
  };
}
