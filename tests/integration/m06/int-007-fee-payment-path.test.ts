import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS as FEE_ROUTES } from '../../../services/cmp-020-fee-calculation/src/api/handler.js';
import { ROUTE_DESCRIPTORS as PAY_ROUTES } from '../../../services/cmp-021-payment/src/api/handler.js';
import { ROUTE_DESCRIPTORS as NOTIFY_ROUTES } from '../../../services/cmp-025-notification/src/api/handler.js';

/**
 * INT-007 fee → payment → callback path surface (independent stitcher).
 * Verifies published route contracts exist for the fee→payment→callback chain
 * and notification fanout used after payment. Does not invent PSP policy.
 * SIMULATED connectors only — REAL deferred. Not CERTIFIED.
 */
describe('INT-007 M06 fee→payment→callback path contracts', () => {
  it('exposes fee quote create/get/list under /v1', () => {
    const paths = FEE_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /v1/fee-quotes');
    expect(paths).toContain('GET /v1/fee-quotes/:quote_id');
    expect(paths).toContain('GET /v1/applications/:application_id/fee-quotes');
  });

  it('exposes payment intent create/get and callback apply under /v1', () => {
    const paths = PAY_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /v1/payment-intents');
    expect(paths).toContain('GET /v1/payment-intents/:payment_intent_id');
    expect(paths).toContain('POST /v1/payment-callbacks');
  });

  it('exposes notification dispatch used after payment events', () => {
    const paths = NOTIFY_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /v1/notifications');
    expect(paths).toContain('GET /v1/notifications/:dispatch_id');
  });

  it('does not expose REAL PSP vendor SDK surfaces on published descriptors', () => {
    const blob = JSON.stringify([...FEE_ROUTES, ...PAY_ROUTES, ...NOTIFY_ROUTES]);
    expect(blob).not.toMatch(/stripe|razorpay|payu|cashfree/i);
  });
});
