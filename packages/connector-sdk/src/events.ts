import type { EventEnvelope, SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';

export const INTEGRATION_HUB_TOPIC = 'sf.integration-hub.events.v1';
export const AUDIT_INGEST_TOPIC = 'sf.audit.ingest.v1';

export type ConnectorEventType =
  'ConnectorInvocationStarted' | 'ConnectorInvocationSucceeded' | 'ConnectorInvocationFailed';

export interface ConnectorEventData {
  connector_binding_id: string;
  connector_type: string;
  direction: 'INVOKE' | 'WEBHOOK';
  mode: string;
  attempts: number;
  outcome?: string;
  error_code?: string;
  provider_reference?: string;
  simulation?: SimulationMarker;
}

export function buildConnectorEnvelope(input: {
  event_id: string;
  event_type: ConnectorEventType;
  tenant_id: string;
  cell_id: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  correlation_id: string;
  actor: EventEnvelope['actor'];
  data: ConnectorEventData;
}): EventEnvelope<ConnectorEventData> {
  const envelope: EventEnvelope<ConnectorEventData> = {
    event_id: input.event_id,
    event_type: input.event_type,
    schema_version: 1,
    tenant_id: input.tenant_id,
    cell_id: input.cell_id,
    aggregate_type: 'ConnectorTransaction',
    aggregate_id: input.aggregate_id,
    aggregate_version: input.aggregate_version,
    occurred_at: input.occurred_at,
    correlation_id: input.correlation_id,
    actor: input.actor,
    data: input.data,
  };
  const result = validate('event-envelope', envelope);
  if (!result.valid) {
    throw new Error('Connector event envelope failed SF-CON-EVENT-ENVELOPE');
  }
  return envelope;
}
