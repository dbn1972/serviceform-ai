import type { IntentRow } from '../repo/types.js';
import type { ConnectorMode, PaymentStatus } from '../types.js';

export interface PaymentIntentView {
  contract_id: 'SF-CON-PAYMENT-INTENT';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  payment_intent_id: string;
  fee_quote_id: string;
  application_id: string;
  currency: string;
  amount_minor: number;
  amount_locked_from_fee_quote: true;
  client_supplied_amount_forbidden: true;
  status: PaymentStatus;
  connector_binding_id: string;
  connector_mode: ConnectorMode;
  simulation_marker_required_when_simulated?: true | undefined;
  idempotency_key: string;
  correlation_id: string;
}

export function intentView(row: IntentRow): PaymentIntentView {
  const view: PaymentIntentView = {
    contract_id: 'SF-CON-PAYMENT-INTENT',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    payment_intent_id: row.payment_intent_id,
    fee_quote_id: row.fee_quote_id,
    application_id: row.application_id,
    currency: row.currency,
    amount_minor: Number(row.amount_minor),
    amount_locked_from_fee_quote: true,
    client_supplied_amount_forbidden: true,
    status: row.status,
    connector_binding_id: row.connector_binding_id,
    connector_mode: row.connector_mode,
    idempotency_key: row.idempotency_key,
    correlation_id: row.correlation_id,
  };
  if (row.connector_mode === 'SIMULATED') {
    view.simulation_marker_required_when_simulated = true;
  }
  return view;
}
