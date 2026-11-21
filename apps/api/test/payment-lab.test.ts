import { describe, expect, it, vi } from 'vitest';
import type { AuthzDecisionInput } from '@serviceform/contracts';
import {
  LAB_FEE_DEFAULTS,
  LAB_FEE_IND_EDU_004,
  LabFeePolicyPort,
  LabPaymentConnectorBindingPort,
  parseFeeCatalogue,
  paymentOwnerEnrichingAuthorizer,
  requiresLabPayment,
} from '../src/platform/payment.js';

describe('SAMPLE_LAB DUMMY fee catalogue / SIM payment compose helpers (SF-56)', () => {
  it('parses fee-catalogue with IND-EDU-004 SAMPLE_LAB DUMMY ₹9.99 overlay', () => {
    const catalogue = parseFeeCatalogue({
      ...LAB_FEE_DEFAULTS,
      policies: LAB_FEE_DEFAULTS.policies,
    });
    expect(catalogue.policy_kind).toBe('SAMPLE_LAB_DUMMY');
    expect(catalogue.connector.mode).toBe('SIMULATED');
    expect(catalogue.test_run_id).toBe('sample-lab-payment');
    const edu = catalogue.policies.find((p) => p.catalogue_id === 'IND-EDU-004');
    expect(edu?.amount_minor).toBe(999);
    expect(edu?.amount_display).toMatch(/SAMPLE_LAB DUMMY/);
    expect(edu?.fee_policy_version_id).toBe('0d15bae4-0015-4000-8000-0d15bae40015');
  });

  it('requiresLabPayment is true for IND-EDU-004 and false for Residence', () => {
    expect(requiresLabPayment('IND-EDU-004')).toBe(true);
    expect(requiresLabPayment('IND-SOC-002')).toBe(false);
  });

  it('LabFeePolicyPort returns PUBLISHED FIXED_AMOUNT policy for pinned version', async () => {
    const port = new LabFeePolicyPort(LAB_FEE_DEFAULTS);
    const row = LAB_FEE_IND_EDU_004;
    const policy = await port.getPublishedVersion(
      { tenant_id: row.tenant_id },
      row.fee_policy_version_id,
    );
    expect(policy?.publication_status).toBe('PUBLISHED');
    expect(policy?.lines[0]?.basis).toBe('FIXED_AMOUNT');
    expect(policy?.lines[0]?.amount_minor).toBe(999);
    expect(
      await port.getPublishedVersion(
        { tenant_id: row.tenant_id },
        '00000000-0000-4000-8000-000000000000',
      ),
    ).toBeNull();
  });

  it('LabPaymentConnectorBindingPort is SIMULATED PAYMENT only', async () => {
    const port = new LabPaymentConnectorBindingPort(
      LAB_FEE_DEFAULTS,
      LAB_FEE_IND_EDU_004.tenant_id,
      'LOCAL',
    );
    const binding = await port.resolveDefault(LAB_FEE_IND_EDU_004.tenant_id, 'PAYMENT');
    expect(binding?.['mode']).toBe('SIMULATED');
    expect(binding?.['connector_type']).toBe('PAYMENT');
    expect(binding?.['secret_ref']).toBeNull();
  });

  it('fallbacks to LAB_FEE_DEFAULTS when catalogue JSON is invalid', () => {
    const catalogue = parseFeeCatalogue(null);
    expect(catalogue.policies[0]?.catalogue_id).toBe('IND-EDU-004');
    expect(catalogue.connector.mode).toBe('SIMULATED');
  });

  it('paymentOwnerEnrichingAuthorizer injects citizen self as FeeQuote/PaymentIntent owner_id', async () => {
    const decide = vi.fn(async () => ({ allow: true }));
    const pdp = paymentOwnerEnrichingAuthorizer({ decide });
    const citizen = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const base = {
      subject: {
        user_id: citizen,
        actor_type: 'CITIZEN' as const,
        tenant_id: LAB_FEE_IND_EDU_004.tenant_id,
        roles: [] as string[],
        jurisdiction_ids: [] as string[],
        assurance: 'OTP',
      },
      environment: { trace_id: 't' },
    };

    await pdp.decide({
      ...base,
      action: 'FEE_QUOTE_CREATE',
      resource: {
        resource_type: 'FeeQuote',
        tenant_id: LAB_FEE_IND_EDU_004.tenant_id,
        classification: 'TENANT_SCOPED',
      },
    } as AuthzDecisionInput);
    expect(decide.mock.calls[0]?.[0].resource.owner_id).toBe(citizen);

    await pdp.decide({
      ...base,
      action: 'PAYMENT_INTENT_CREATE',
      resource: {
        resource_type: 'PaymentIntent',
        tenant_id: LAB_FEE_IND_EDU_004.tenant_id,
        classification: 'TENANT_SCOPED',
      },
    } as AuthzDecisionInput);
    expect(decide.mock.calls[1]?.[0].resource.owner_id).toBe(citizen);

    // Officers / SYSTEM: no injection
    await pdp.decide({
      subject: {
        user_id: LAB_FEE_DEFAULTS.workload.payment_actor_id,
        actor_type: 'SYSTEM',
        tenant_id: LAB_FEE_IND_EDU_004.tenant_id,
        roles: ['SAMPLE_LAB_PAYMENT_WORKLOAD'],
        jurisdiction_ids: [],
        assurance: 'WORKLOAD_IDENTITY',
      },
      action: 'FEE_QUOTE_READ',
      resource: {
        resource_type: 'FeeQuote',
        tenant_id: LAB_FEE_IND_EDU_004.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      environment: { trace_id: 't' },
    } as AuthzDecisionInput);
    expect(decide.mock.calls[2]?.[0].resource.owner_id).toBeUndefined();
  });
});
