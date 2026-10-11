import type { LineRow, QuoteRow } from '../repo/types.js';
import type { AmountSource, CalculationBasis } from './calculate.js';
import { toContractInteger } from './money.js';

/** SF-CON-FEE-QUOTE v1 (contracts/m06/schemas/fee-quote.schema.json, FROZEN). */
export interface FeeQuote {
  contract_id: 'SF-CON-FEE-QUOTE';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  quote_id: string;
  application_id: string;
  currency: string;
  line_items: {
    code: string;
    amount_minor: number;
    calculation_basis: CalculationBasis;
    description_code?: string;
  }[];
  total_amount_minor: number;
  amount_source: AmountSource;
  client_authoritative_amount: false;
  fee_policy_version_id: string;
  rule_version_id: string;
  tenant_service_binding_id: string;
  waiver_policy_ref?: string;
  idempotency_key: string;
  correlation_id?: string;
}

export function feeQuoteView(row: QuoteRow, lines: LineRow[]): FeeQuote {
  const quote: FeeQuote = {
    contract_id: 'SF-CON-FEE-QUOTE',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    quote_id: row.quote_id,
    application_id: row.application_id,
    currency: row.currency,
    line_items: [...lines]
      .sort((a, b) => a.line_seq - b.line_seq)
      .map((l) => ({
        code: l.code,
        amount_minor: toContractInteger(l.amount_minor),
        calculation_basis: l.calculation_basis,
        ...(l.description_code === null ? {} : { description_code: l.description_code }),
      })),
    total_amount_minor: toContractInteger(row.total_amount_minor),
    amount_source: row.amount_source,
    client_authoritative_amount: false,
    fee_policy_version_id: row.fee_policy_version_id,
    rule_version_id: row.rule_version_id,
    tenant_service_binding_id: row.tenant_service_binding_id,
    idempotency_key: row.idempotency_key,
    correlation_id: row.correlation_id,
  };
  if (row.waiver_policy_ref !== null) quote.waiver_policy_ref = row.waiver_policy_ref;
  return quote;
}
