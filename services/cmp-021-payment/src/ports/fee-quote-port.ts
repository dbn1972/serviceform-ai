import { Cmp021Error, detail } from '../errors.js';

/**
 * View shape locked from SF-CON-FEE-QUOTE. CMP-021 reads only the fields it needs; shape is
 * validated against the frozen schema in test/contract.
 */
export interface FeeQuoteView {
  quote_id: string;
  tenant_id: string;
  application_id: string;
  currency: string;
  total_amount_minor: number;
  client_authoritative_amount: false;
}

/**
 * Read port to CMP-020. CMP-021 never queries fee tables directly (no cross-component SQL).
 * The port returns the immutable fee quote with locked amount and currency.
 */
export interface FeeQuotePort {
  getById(tenantId: string, feeQuoteId: string): Promise<FeeQuoteView | null>;
}

export class UnboundFeeQuotePort implements FeeQuotePort {
  getById(): Promise<FeeQuoteView | null> {
    return Promise.reject(new Cmp021Error('SF-SYS-004', detail('FEE_QUOTE_PORT_UNBOUND')));
  }
}
