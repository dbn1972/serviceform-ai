import type { CallbackRow } from '../repo/types.js';

export interface PaymentCallbackView {
  contract_id: 'SF-CON-PAYMENT-CALLBACK';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  callback_id: string;
  payment_intent_id: string;
  application_id: string;
  verification_result: 'VERIFIED' | 'REJECTED';
  signature_verified: boolean;
  financial_effect_applied: boolean;
  duplicate_financial_effect_forbidden: true;
  exactly_once_key: string;
  idempotency_key: string;
  correlation_id: string;
}

export function callbackView(row: CallbackRow): PaymentCallbackView {
  return {
    contract_id: 'SF-CON-PAYMENT-CALLBACK',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    callback_id: row.callback_id,
    payment_intent_id: row.payment_intent_id,
    application_id: row.application_id,
    verification_result: row.verification_result,
    signature_verified: row.signature_verified,
    financial_effect_applied: row.financial_effect_applied,
    duplicate_financial_effect_forbidden: true,
    exactly_once_key: row.exactly_once_key,
    idempotency_key: row.idempotency_key,
    correlation_id: row.correlation_id,
  };
}
