import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { assertSimulatorEnvironment } from './simulators.js';
import type { CaseServiceLike } from './issuance.js';

/**
 * SAMPLE_LAB CMP-020/021 host adapters (SF-56). Composition only:
 * SAMPLE_LAB DUMMY fee overlay (IND-EDU-004 ₹9.99) → fee quote → SIMULATED payment intent →
 * HMAC callback → WorkflowSignal MARK_RECEIVED. Residence ₹0 unchanged.
 * Payment REAL / HubPsp owner-held. CERTIFIED=false. G6=false.
 * Catalogue mirrors packages/m10-sample-lab + fixtures/lab/platform/fee-catalogue.json.
 */

export type SampleLabFeePolicyRow = {
  catalogue_id: string;
  label: string;
  fee_policy_version_id: string;
  tenant_id: string;
  tenant_service_binding_id: string;
  publication_status: 'PUBLISHED';
  content_hash: string;
  currency: string;
  rule_version_id: string | null;
  waiver_policy_ref: string | null;
  amount_minor: number;
  amount_display: string;
  fee_schedule_ref: string;
  lines: {
    code: string;
    basis: 'FIXED_AMOUNT';
    amount_minor: number;
    description_code?: string;
  }[];
};

export type LabFeeCatalogue = {
  source: string;
  policy_kind: string;
  test_run_id: string;
  connector: {
    connector_binding_id: string;
    connector_type: 'PAYMENT';
    mode: 'SIMULATED';
    simulator_version: string;
    critical: boolean;
  };
  workload: {
    payment_actor_id: string;
    payment_roles: readonly string[];
    integration_actor_id: string;
    integration_roles: readonly string[];
  };
  policies: SampleLabFeePolicyRow[];
};

/** Fail-closed defaults — must stay aligned with fixtures/lab/platform/fee-catalogue.json. */
export const LAB_FEE_CONTENT_HASH =
  'sha256:9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f';

export const LAB_FEE_IND_EDU_004: SampleLabFeePolicyRow = {
  catalogue_id: 'IND-EDU-004',
  label: 'SAMPLE_LAB DUMMY · Transfer Certificate fee overlay (₹9.99)',
  fee_policy_version_id: '0d15bae4-0015-4000-8000-0d15bae40015',
  tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
  tenant_service_binding_id: '0d15bae4-0002-4000-8000-0d15bae40002',
  publication_status: 'PUBLISHED',
  content_hash: LAB_FEE_CONTENT_HASH,
  currency: 'INR',
  rule_version_id: null,
  waiver_policy_ref: null,
  amount_minor: 999,
  amount_display: 'SAMPLE_LAB DUMMY · ₹9.99',
  fee_schedule_ref: 'SAMPLE_LAB_DUMMY_FEE_SCHEDULE',
  lines: [
    {
      code: 'SAMPLE_LAB_DUMMY_BASE',
      basis: 'FIXED_AMOUNT',
      amount_minor: 999,
      description_code: 'SAMPLE_LAB_DUMMY_FEE',
    },
  ],
};

export const LAB_FEE_DEFAULTS: LabFeeCatalogue = {
  source: 'SAMPLE_LAB',
  policy_kind: 'SAMPLE_LAB_DUMMY',
  test_run_id: 'sample-lab-payment',
  connector: {
    connector_binding_id: '0d15ba00-0021-4000-8000-0d15ba000021',
    connector_type: 'PAYMENT',
    mode: 'SIMULATED',
    simulator_version: 'sample-lab-psp-1',
    critical: false,
  },
  workload: {
    payment_actor_id: '0d15ba00-0021-4000-8000-0d15ba00021a',
    payment_roles: ['SAMPLE_LAB_PAYMENT_WORKLOAD'],
    integration_actor_id: '0d15ba00-0021-4000-8000-0d15ba00021b',
    integration_roles: ['SAMPLE_LAB_PAYMENT_INTEGRATION'],
  },
  policies: [LAB_FEE_IND_EDU_004],
};

export type FeeServiceLike = {
  quote(
    ctx: unknown,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  get(ctx: unknown, quoteId: string): Promise<{ status: number; body: unknown }>;
  listForApplication(
    ctx: unknown,
    applicationId: string,
  ): Promise<{ status: number; body: unknown }>;
};

export type PaymentServiceLike = {
  createIntent(
    ctx: unknown,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  getIntent(ctx: unknown, paymentIntentId: string): Promise<{ status: number; body: unknown }>;
  applyCallback(ctx: unknown, input: unknown): Promise<{ status: number; body: unknown }>;
};

type Cmp020Module = {
  buildFeeService: (opts: Record<string, unknown>) => FeeServiceLike;
};

type Cmp021Module = {
  buildPaymentService: (opts: Record<string, unknown>) => PaymentServiceLike;
  SimulatedPspConnector: new (marker: {
    simulation: true;
    scenario: string;
    test_run_id: string;
    connector_binding_id: string;
    environment: string;
  }) => unknown;
  simulatorSecret: (testRunId: string) => string;
  signPayload: (secret: string, payload: Record<string, unknown>) => string;
};

type ApplicationPinsLike = {
  getFeePins(
    ctx: { tenant_id: string },
    applicationId: string,
  ): Promise<{
    application_id: string;
    tenant_service_binding_id: string;
    rule_version_id: string;
    fee_policy_version_id: string | null;
  } | null>;
};

type FeePolicyLike = {
  getPublishedVersion(
    ctx: { tenant_id: string },
    feePolicyVersionId: string,
  ): Promise<{
    fee_policy_version_id: string;
    tenant_id: string;
    tenant_service_binding_id: string;
    publication_status: string;
    content_hash: string;
    currency: string;
    rule_version_id: string | null;
    waiver_policy_ref: string | null;
    lines: {
      code: string;
      basis: 'FIXED_AMOUNT';
      amount_minor: number;
      description_code?: string;
    }[];
  } | null>;
};

type FeeQuotePortLike = {
  getById(
    tenantId: string,
    feeQuoteId: string,
  ): Promise<{
    quote_id: string;
    tenant_id: string;
    application_id: string;
    currency: string;
    total_amount_minor: number;
    client_authoritative_amount: false;
  } | null>;
};

type ConnectorBindingPortLike = {
  resolve(tenantId: string, connectorBindingId: string): Promise<Record<string, unknown> | null>;
  resolveDefault(
    tenantId: string,
    connectorType: 'PAYMENT',
  ): Promise<Record<string, unknown> | null>;
};

function sha256Fingerprint(material: string): string {
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}

function idem(endpoint: string, key: string, fingerprintMaterial: string) {
  return { key, fingerprint: sha256Fingerprint(fingerprintMaterial), endpoint };
}

export function parseFeeCatalogue(raw: unknown): LabFeeCatalogue {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...LAB_FEE_DEFAULTS, policies: [...LAB_FEE_DEFAULTS.policies] };
  }
  const obj = raw as Record<string, unknown>;
  const connector = (obj['connector'] ?? {}) as Record<string, unknown>;
  const workload = (obj['workload'] ?? {}) as Record<string, unknown>;
  const policiesRaw = Array.isArray(obj['policies']) ? obj['policies'] : [];
  const policies: SampleLabFeePolicyRow[] = [];
  for (const row of policiesRaw) {
    if (row === null || typeof row !== 'object') continue;
    const p = row as Record<string, unknown>;
    const linesRaw = Array.isArray(p['lines']) ? p['lines'] : [];
    const lines = linesRaw
      .filter((l): l is Record<string, unknown> => l !== null && typeof l === 'object')
      .map((l) => ({
        code: String(l['code'] ?? 'SAMPLE_LAB_DUMMY_BASE'),
        basis: 'FIXED_AMOUNT' as const,
        amount_minor: Number(l['amount_minor'] ?? 0),
        ...(typeof l['description_code'] === 'string'
          ? { description_code: l['description_code'] }
          : {}),
      }));
    if (typeof p['fee_policy_version_id'] !== 'string') continue;
    policies.push({
      catalogue_id: String(p['catalogue_id'] ?? ''),
      label: String(p['label'] ?? 'SAMPLE_LAB DUMMY'),
      fee_policy_version_id: p['fee_policy_version_id'],
      tenant_id: String(p['tenant_id'] ?? ''),
      tenant_service_binding_id: String(p['tenant_service_binding_id'] ?? ''),
      publication_status: 'PUBLISHED',
      content_hash: String(p['content_hash'] ?? LAB_FEE_CONTENT_HASH),
      currency: String(p['currency'] ?? 'INR'),
      rule_version_id: typeof p['rule_version_id'] === 'string' ? p['rule_version_id'] : null,
      waiver_policy_ref: typeof p['waiver_policy_ref'] === 'string' ? p['waiver_policy_ref'] : null,
      amount_minor: Number(p['amount_minor'] ?? 0),
      amount_display: String(p['amount_display'] ?? 'SAMPLE_LAB DUMMY'),
      fee_schedule_ref: String(p['fee_schedule_ref'] ?? 'SAMPLE_LAB_DUMMY_FEE_SCHEDULE'),
      lines:
        lines.length > 0
          ? lines
          : [
              {
                code: 'SAMPLE_LAB_DUMMY_BASE',
                basis: 'FIXED_AMOUNT',
                amount_minor: Number(p['amount_minor'] ?? 999),
                description_code: 'SAMPLE_LAB_DUMMY_FEE',
              },
            ],
    });
  }
  return {
    source: String(obj['source'] ?? 'SAMPLE_LAB'),
    policy_kind: String(obj['policy_kind'] ?? 'SAMPLE_LAB_DUMMY'),
    test_run_id: String(obj['test_run_id'] ?? LAB_FEE_DEFAULTS.test_run_id),
    connector: {
      connector_binding_id: String(
        connector['connector_binding_id'] ?? LAB_FEE_DEFAULTS.connector.connector_binding_id,
      ),
      connector_type: 'PAYMENT',
      mode: 'SIMULATED',
      simulator_version: String(
        connector['simulator_version'] ?? LAB_FEE_DEFAULTS.connector.simulator_version,
      ),
      critical: false,
    },
    workload: {
      payment_actor_id: String(
        workload['payment_actor_id'] ?? LAB_FEE_DEFAULTS.workload.payment_actor_id,
      ),
      payment_roles: Array.isArray(workload['payment_roles'])
        ? (workload['payment_roles'] as string[])
        : [...LAB_FEE_DEFAULTS.workload.payment_roles],
      integration_actor_id: String(
        workload['integration_actor_id'] ?? LAB_FEE_DEFAULTS.workload.integration_actor_id,
      ),
      integration_roles: Array.isArray(workload['integration_roles'])
        ? (workload['integration_roles'] as string[])
        : [...LAB_FEE_DEFAULTS.workload.integration_roles],
    },
    policies: policies.length > 0 ? policies : [...LAB_FEE_DEFAULTS.policies],
  };
}

export function loadFeeCatalogue(dir: string): LabFeeCatalogue {
  try {
    return parseFeeCatalogue(
      JSON.parse(readFileSync(join(dir, 'fee-catalogue.json'), 'utf8')) as unknown,
    );
  } catch {
    return { ...LAB_FEE_DEFAULTS, policies: [...LAB_FEE_DEFAULTS.policies] };
  }
}

/** True when SAMPLE_LAB DUMMY overlay pins a fee amount > 0 (not Residence ₹0). */
export function requiresLabPayment(
  catalogueId: string,
  catalogue: LabFeeCatalogue = LAB_FEE_DEFAULTS,
): boolean {
  const row = catalogue.policies.find((p) => p.catalogue_id === catalogueId);
  return row !== null && row !== undefined && row.amount_minor > 0;
}

export function paymentWorkloadContext(
  catalogue: LabFeeCatalogue,
  cellId: string,
  tenantId: string,
): RequestContext {
  const correlation_id = randomUUID();
  return {
    tenant_id: tenantId,
    cell_id: cellId,
    actor: { type: 'SYSTEM', id: catalogue.workload.payment_actor_id },
    roles: [...catalogue.workload.payment_roles],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id,
    trace_id: correlation_id.replace(/-/g, ''),
  };
}

export function paymentIntegrationContext(
  catalogue: LabFeeCatalogue,
  cellId: string,
  tenantId: string,
): RequestContext {
  const correlation_id = randomUUID();
  return {
    tenant_id: tenantId,
    cell_id: cellId,
    actor: { type: 'INTEGRATION', id: catalogue.workload.integration_actor_id },
    roles: [...catalogue.workload.integration_roles],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id,
    trace_id: correlation_id.replace(/-/g, ''),
  };
}

/** CMP-015 → CMP-020 ApplicationPinsPort (no cross-component SQL). */
export class LabApplicationFeePinsPort implements ApplicationPinsLike {
  constructor(private readonly cases: CaseServiceLike) {}

  async getFeePins(ctx: { tenant_id: string }, applicationId: string) {
    let res: { status: number; body: unknown };
    try {
      res = await this.cases.getApplication(ctx, applicationId);
    } catch {
      return null;
    }
    if (res.status !== 200) return null;
    const app = (res.body as { application?: Record<string, unknown> })?.application;
    if (!app || typeof app !== 'object') return null;
    const pins = (app['pins'] ?? {}) as Record<string, unknown>;
    const tsb = pins['tenant_service_binding_id'];
    const rule = pins['rule_version_id'];
    if (typeof tsb !== 'string' || typeof rule !== 'string') return null;
    const fee = pins['fee_policy_version_id'];
    return {
      application_id: String(app['application_id'] ?? applicationId),
      tenant_service_binding_id: tsb,
      rule_version_id: rule,
      fee_policy_version_id: typeof fee === 'string' ? fee : null,
    };
  }
}

/** SAMPLE_LAB DUMMY published fee policy from catalogue (FIXED_AMOUNT only). */
export class LabFeePolicyPort implements FeePolicyLike {
  private readonly byId = new Map<string, SampleLabFeePolicyRow>();

  constructor(catalogue: LabFeeCatalogue) {
    for (const row of catalogue.policies) {
      this.byId.set(row.fee_policy_version_id, row);
    }
  }

  getPublishedVersion(ctx: { tenant_id: string }, feePolicyVersionId: string) {
    const row = this.byId.get(feePolicyVersionId);
    if (!row || row.tenant_id !== ctx.tenant_id) return Promise.resolve(null);
    return Promise.resolve({
      fee_policy_version_id: row.fee_policy_version_id,
      tenant_id: row.tenant_id,
      tenant_service_binding_id: row.tenant_service_binding_id,
      publication_status: row.publication_status,
      content_hash: row.content_hash,
      currency: row.currency,
      rule_version_id: row.rule_version_id,
      waiver_policy_ref: row.waiver_policy_ref,
      lines: row.lines.map((l) => ({ ...l })),
    });
  }
}

/** CMP-020 → CMP-021 FeeQuotePort via service API (no cross-component SQL). */
export class LabFeeQuotePort implements FeeQuotePortLike {
  constructor(
    private readonly fee: FeeServiceLike,
    private readonly systemCtx: () => RequestContext,
  ) {}

  async getById(tenantId: string, feeQuoteId: string) {
    const ctx = this.systemCtx();
    if (ctx.tenant_id !== tenantId) return null;
    try {
      const res = await this.fee.get(ctx, feeQuoteId);
      if (res.status !== 200) return null;
      const body = res.body as Record<string, unknown>;
      if (body['client_authoritative_amount'] !== false) return null;
      return {
        quote_id: String(body['quote_id']),
        tenant_id: String(body['tenant_id']),
        application_id: String(body['application_id']),
        currency: String(body['currency']),
        total_amount_minor: Number(body['total_amount_minor']),
        client_authoritative_amount: false as const,
      };
    } catch {
      return null;
    }
  }
}

/** SIMULATED PAYMENT connector binding (LOCAL/CI only). */
export class LabPaymentConnectorBindingPort implements ConnectorBindingPortLike {
  constructor(
    private readonly catalogue: LabFeeCatalogue,
    private readonly tenantId: string,
    private readonly environment: string,
  ) {}

  private binding(): Record<string, unknown> {
    return {
      connector_binding_id: this.catalogue.connector.connector_binding_id,
      tenant_id: this.tenantId,
      connector_type: 'PAYMENT',
      mode: 'SIMULATED',
      environment: this.environment,
      critical: false,
      secret_ref: null,
      simulator_version: this.catalogue.connector.simulator_version,
    };
  }

  resolve(tenantId: string, connectorBindingId: string) {
    if (tenantId !== this.tenantId) return Promise.resolve(null);
    if (connectorBindingId !== this.catalogue.connector.connector_binding_id) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.binding());
  }

  resolveDefault(tenantId: string, connectorType: 'PAYMENT') {
    if (tenantId !== this.tenantId || connectorType !== 'PAYMENT') return Promise.resolve(null);
    return Promise.resolve(this.binding());
  }
}

/** Post-commit INT-007: CAPTURED payment → CMP-015 MARK_RECEIVED (SYSTEM workload). */
export class LabPaymentWorkflowSignalPort {
  constructor(
    private readonly cases: CaseServiceLike,
    private readonly systemCtx: () => RequestContext,
  ) {}

  async signalPaymentVerified(params: {
    tenantId: string;
    paymentIntentId: string;
    applicationId: string;
    correlationId: string;
  }): Promise<void> {
    if (!params.applicationId) return;
    const ctx = this.systemCtx();
    if (ctx.tenant_id !== params.tenantId) return;
    const appRes = await this.cases.getApplication(ctx, params.applicationId);
    if (appRes.status !== 200) return;
    const app = (appRes.body as { application?: Record<string, unknown> })?.application;
    if (!app) return;
    const state = String(app['state'] ?? '');
    if (state !== 'PAYMENT_PENDING') return;
    await this.cases.executeCommand(
      ctx,
      params.applicationId,
      {
        command: 'MARK_RECEIVED',
        expected_state: 'PAYMENT_PENDING',
        expected_version: Number(app['aggregate_version'] ?? 0),
      },
      `lab-pay-received:${params.paymentIntentId}`,
    );
  }
}

export type ComposeLabPaymentResult = {
  feeService: FeeServiceLike;
  paymentService: PaymentServiceLike;
  catalogue: LabFeeCatalogue;
  m06FeePayment: {
    fee: { service: unknown; resolveContext: (request: unknown) => Promise<unknown> };
    payment: { service: unknown; resolveContext: (request: unknown) => Promise<unknown> };
  };
  signSimCallback: (body: Record<string, unknown>) => string;
  integrationCtx: () => RequestContext;
  applySimulatedCapture: (paymentIntentId: string) => Promise<{ status: number; body: unknown }>;
};

export function composeLabPayment(params: {
  feePool: pg.Pool;
  paymentPool: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  resolveContext: (request: unknown) => Promise<unknown>;
  environment: string;
  catalogue: LabFeeCatalogue;
  cellId: string;
  tenantId: string;
  cases: CaseServiceLike;
  cmp020: Cmp020Module;
  cmp021: Cmp021Module;
}): ComposeLabPaymentResult {
  assertSimulatorEnvironment(params.environment);

  const systemCtx = () => paymentWorkloadContext(params.catalogue, params.cellId, params.tenantId);
  const integrationCtx = () =>
    paymentIntegrationContext(params.catalogue, params.cellId, params.tenantId);

  const feeService = params.cmp020.buildFeeService({
    pool: params.feePool,
    authorizer: params.authorizer,
    applicationPins: new LabApplicationFeePinsPort(params.cases),
    feePolicy: new LabFeePolicyPort(params.catalogue),
    // FIXED_AMOUNT SAMPLE_LAB DUMMY lines never invoke rules.
  });

  const marker = {
    simulation: true as const,
    scenario: 'payment_gateway',
    test_run_id: params.catalogue.test_run_id,
    connector_binding_id: params.catalogue.connector.connector_binding_id,
    environment: params.environment,
  };
  const gateway = new params.cmp021.SimulatedPspConnector(marker);

  const paymentService = params.cmp021.buildPaymentService({
    pool: params.paymentPool,
    authorizer: params.authorizer,
    feeQuote: new LabFeeQuotePort(feeService, systemCtx),
    connectorBinding: new LabPaymentConnectorBindingPort(
      params.catalogue,
      params.tenantId,
      params.environment,
    ),
    gateway,
    workflowSignal: new LabPaymentWorkflowSignalPort(params.cases, systemCtx),
    runtimeEnvironment: params.environment,
  });

  const signSimCallback = (body: Record<string, unknown>) =>
    params.cmp021.signPayload(params.cmp021.simulatorSecret(params.catalogue.test_run_id), body);

  const applySimulatedCapture = async (paymentIntentId: string) => {
    const body = {
      payment_intent_id: paymentIntentId,
      outcome: 'CAPTURED',
      exactly_once_key: `lab-sim-once:${paymentIntentId}`,
      idempotency_key: `lab-sim-idem:${paymentIntentId}`,
    };
    const signature = signSimCallback(body);
    return paymentService.applyCallback(integrationCtx(), {
      raw: body,
      headers: { 'x-sim-signature': signature },
      exactly_once_key: body.exactly_once_key,
      idempotency_key: body.idempotency_key,
    });
  };

  return {
    feeService,
    paymentService,
    catalogue: params.catalogue,
    m06FeePayment: {
      fee: { service: feeService, resolveContext: params.resolveContext },
      payment: { service: paymentService, resolveContext: params.resolveContext },
    },
    signSimCallback,
    integrationCtx,
    applySimulatedCapture,
  };
}

/**
 * Lab-only SIM payment callback helper (INTEGRATION actor + HMAC).
 * POST /v1/lab/simulated/payment-callback  { payment_intent_id }
 */
export function registerLabPaymentRoutes(
  app: FastifyInstance,
  opts: {
    environment: string;
    applySimulatedCapture: (paymentIntentId: string) => Promise<{ status: number; body: unknown }>;
  },
): void {
  assertSimulatorEnvironment(opts.environment);

  app.post<{ Body: unknown }>('/v1/lab/simulated/payment-callback', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const paymentIntentId =
      typeof body['payment_intent_id'] === 'string' ? body['payment_intent_id'] : '';
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        paymentIntentId,
      )
    ) {
      return reply.code(400).send({
        error_code: 'SF-SYS-003',
        message: 'payment_intent_id UUID required',
        simulation: true,
        certified: false,
        g6_issued: false,
      });
    }
    try {
      const result = await opts.applySimulatedCapture(paymentIntentId);
      return reply
        .code(result.status)
        .header('cache-control', 'no-store')
        .send({
          ...(typeof result.body === 'object' && result.body !== null
            ? (result.body as object)
            : { body: result.body }),
          simulation: true,
          connector_mode: 'SIMULATED',
          certified: false,
          g6_issued: false,
        });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? 'SF-SYS-004';
      return reply.code(400).send({
        error_code: code,
        message: 'SIMULATED payment callback refused',
        simulation: true,
        certified: false,
        g6_issued: false,
      });
    }
  });
}

/** Re-export idem helper for tests. */
export { idem as labPaymentIdem };
