import { beforeEach, describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { synthetic } from '../doubles/synthetic.js';
import {
  buildHarness,
  INVOKE_BODY,
  MODEL_BODY,
  seedModel,
  seedPolicy,
  T1,
  T2,
  type Harness,
} from './harness.js';

async function seeded(h: Harness, tenant = T1, policyOverrides: Record<string, unknown> = {}) {
  const model = await seedModel(h, tenant);
  await seedPolicy(h, tenant, [model], policyOverrides);
  return model;
}

describe('governed invocation (all model calls through the gateway)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it('returns advisory-only output with simulation marker and writes audit metadata + events', async () => {
    await seeded(h);
    const res = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(res.status).toBe(200);
    expect(res.body['advisory_only']).toBe(true);
    expect(res.body['statutory_decision']).toBe(false);
    expect(validate('simulation-marker', res.body['simulation']).valid).toBe(true);
    expect(res.body['model']).toEqual({
      provider_id: 'sim-primary',
      model_id: 'sim-model',
      model_version: '2026-10-01',
    });
    const row = h.store.metadata[0];
    expect(row?.outcome).toBe('COMPLETED');
    expect(row?.policy_hash).toMatch(/^sha256:/);
    expect(row?.prompt_hash).toMatch(/^sha256:/);
    expect(row?.simulated).toBe(true);
    const types = h.store.outbox.map((o) => o.eventType);
    expect(types).toContain('AIRequestCompleted');
    expect(types).toContain('AuditEventSubmitted');
    for (const ob of h.store.outbox)
      expect(validate('event-envelope', ob.envelope).valid).toBe(true);
  });

  it('replays identical idempotent requests without a second provider call', async () => {
    await seeded(h);
    const first = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY, 'same-key');
    const calls = h.providers.get('sim-primary')?.calls;
    const again = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY, 'same-key');
    expect(again.status).toBe(200);
    expect(again.body['request_id']).toBe(first.body['request_id']);
    expect(h.providers.get('sim-primary')?.calls).toBe(calls);
    const conflict = await h.call(
      T1,
      'POST',
      '/v1/ai/invoke',
      { ...INVOKE_BODY, purpose: 'other' },
      'same-key',
    );
    expect(conflict.status).toBe(409);
  });

  it('denies unapproved model pins and floating versions', async () => {
    await seeded(h);
    const pin = (model_version: string) => ({
      ...INVOKE_BODY,
      model: { provider_id: 'sim-primary', model_id: 'sim-model', model_version },
    });
    const unapproved = await h.call(T1, 'POST', '/v1/ai/invoke', pin('2026-09-01'));
    expect(unapproved.status).toBe(403);
    expect(JSON.stringify(unapproved.body)).toContain('MODEL_NOT_APPROVED');
    const otherProvider = await h.call(T1, 'POST', '/v1/ai/invoke', {
      ...INVOKE_BODY,
      model: { provider_id: 'rogue-provider', model_id: 'sim-model', model_version: '2026-10-01' },
    });
    expect(otherProvider.status).toBe(403);
    const floating = await h.call(T1, 'POST', '/v1/ai/invoke', pin('latest'));
    expect(floating.status).toBe(400);
    const approved = await h.call(T1, 'POST', '/v1/ai/invoke', pin('2026-10-01'));
    expect(approved.status).toBe(200);
    expect(h.store.metadata.filter((m) => m.outcome === 'BLOCKED')).toHaveLength(2);
    expect(h.providers.get('sim-primary')?.calls).toBe(1);
  });

  it('denies a revoked model and an approved model with no adapter', async () => {
    const model = await seeded(h);
    const revoke = await h.call(T1, 'POST', `/v1/ai/admin/models/${model}/revoke`, {
      reason: 'retired',
    });
    expect(revoke.status).toBe(200);
    const res = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('MODEL_NOT_APPROVED');

    const h2 = await buildHarness();
    const unknownProviderModel = await seedModel(h2, T1, { provider_id: 'unlisted-vendor' });
    await seedPolicy(h2, T1, [unknownProviderModel]);
    const noAdapter = await h2.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(noAdapter.status).toBe(503);
    expect(JSON.stringify(noAdapter.body)).toContain('PROVIDER_UNAVAILABLE');
  });

  it('redacts PII and secrets before the provider sees them and never persists raw values', async () => {
    await seeded(h);
    const provider = h.providers.get('sim-primary') as unknown as {
      invoke: (i: { prompt: string }) => Promise<unknown>;
    };
    const original = provider.invoke.bind(provider);
    const seen: string[] = [];
    provider.invoke = async (input) => {
      seen.push(input.prompt);
      return original(input);
    };
    const values = [
      synthetic.email(),
      synthetic.nationalId(),
      synthetic.credential(),
      synthetic.jwt(),
    ];
    h.consent.denied.clear();
    const res = await h.call(T1, 'POST', '/v1/ai/invoke', {
      ...INVOKE_BODY,
      data_classification: 'PERSONAL',
      variables: { subject: values.join(' | ') },
    });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    for (const v of values) expect(seen[0]).not.toContain(v);
    expect(seen[0]).toContain('[REDACTED:EMAIL]');
    const persisted = JSON.stringify([h.store.metadata, h.store.outbox, h.store.idem]);
    for (const v of values) expect(persisted).not.toContain(v);
    expect(h.store.metadata[0]?.redaction_summary['EMAIL']).toBe(1);
  });

  it('redacts PII in model output', async () => {
    h = await buildHarness({ 'sim-primary': 'pii_output' });
    await seeded(h);
    const res = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(res.status).toBe(200);
    expect(String(res.body['output_text'])).toContain('[REDACTED:EMAIL]');
    expect(String(res.body['output_text'])).not.toContain(synthetic.email());
  });

  it('enforces data classification ceilings and purpose/consent for personal data', async () => {
    await seeded(h, T1, { max_data_classification: 'INTERNAL' });
    const tooHigh = await h.call(T1, 'POST', '/v1/ai/invoke', {
      ...INVOKE_BODY,
      data_classification: 'PERSONAL',
    });
    expect(tooHigh.status).toBe(403);
    expect(JSON.stringify(tooHigh.body)).toContain('DATA_CLASSIFICATION_EXCEEDED');

    const h2 = await buildHarness();
    await seeded(h2);
    h2.consent.denied.add('officer drafting assistance');
    const noPurpose = await h2.call(T1, 'POST', '/v1/ai/invoke', {
      ...INVOKE_BODY,
      data_classification: 'PERSONAL',
    });
    expect(noPurpose.status).toBe(403);
    expect(JSON.stringify(noPurpose.body)).toContain('PURPOSE_NOT_PERMITTED');
    expect(h2.providers.get('sim-primary')?.calls).toBe(0);
  });

  it('enforces tool allowlist and scopes, and blocks disallowed model tool calls', async () => {
    await seeded(h);
    const tool = (scopes: string[], tool_id = 'lookup_faq') => ({
      ...INVOKE_BODY,
      tools: [{ tool_id, version: '1', scopes }],
    });
    expect((await h.call(T1, 'POST', '/v1/ai/invoke', tool(['faq:read']))).status).toBe(200);
    expect((await h.call(T1, 'POST', '/v1/ai/invoke', tool(['faq:write']))).status).toBe(403);
    expect(
      (await h.call(T1, 'POST', '/v1/ai/invoke', tool(['faq:read'], 'other_tool'))).status,
    ).toBe(403);
    const meta = h.store.metadata.find((m) => m.outcome === 'COMPLETED');
    expect(meta?.tool_calls).toEqual([]);

    const h2 = await buildHarness({ 'sim-primary': 'disallowed_tool_call' });
    await seeded(h2);
    const blocked = await h2.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain('"code":"TOOL_CALL_NOT_ALLOWED"');
  });

  it('enforces tenant/source ACL for retrieval context', async () => {
    await seeded(h);
    const body = (tenant_id: string) => ({
      ...INVOKE_BODY,
      sources: [{ source_id: 'doc-1', tenant_id }],
    });
    const denied = await h.call(T1, 'POST', '/v1/ai/invoke', body(T1));
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain('SOURCE_ACL_DENIED');
    const cross = await h.call(T1, 'POST', '/v1/ai/invoke', body(T2));
    expect(cross.status).toBe(403);
    expect(cross.body['error_code']).toBe('SF-TEN-002');
    h.sources.allow(T1, 'doc-1');
    const allowed = await h.call(T1, 'POST', '/v1/ai/invoke', body(T1));
    expect(allowed.status).toBe(200);
    expect(h.providers.get('sim-primary')?.calls).toBe(1);

    const h2 = await buildHarness({ 'sim-primary': 'foreign_citation' });
    await seeded(h2);
    h2.sources.allow(T1, 'doc-1');
    const badCite = await h2.call(T1, 'POST', '/v1/ai/invoke', body(T1));
    expect(badCite.status).toBe(422);
    expect(JSON.stringify(badCite.body)).toContain('CITATION_NOT_IN_SOURCES');
  });

  it('is tenant isolated: another tenant cannot see or use a policy', async () => {
    await seeded(h, T1);
    const res = await h.call(T2, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain('POLICY_NOT_FOUND');
    expect(h.providers.get('sim-primary')?.calls).toBe(0);
    const caps = await h.call(T2, 'GET', '/v1/ai/models/capabilities');
    expect(caps.body['models']).toEqual([]);
    const own = await h.call(T1, 'GET', '/v1/ai/models/capabilities');
    expect((own.body['models'] as unknown[]).length).toBe(1);
    expect(JSON.stringify(own.body)).not.toContain('tenant_id');
  });

  it('applies authorization via the PDP and audits denials', async () => {
    await seeded(h);
    h.authorizer.denies.add('AI_INVOKE');
    const denied = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(denied.status).toBe(403);
    expect(h.providers.get('sim-primary')?.calls).toBe(0);
    expect(h.store.metadata.at(-1)?.reason_code).toBe('AUTHZ_DENIED');
    h.authorizer.denies.clear();
    h.authorizer.throws = true;
    const down = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(down.status).toBe(503);
    h.authorizer.throws = false;
  });

  it('enforces rate / token / cost controls', async () => {
    await seeded(h, T1);
    const small = await seedModel(h, T1, { model_id: 'small', daily_token_budget: 40 });
    const hb = await buildHarness();
    const m = await seedModel(hb, T1, { daily_token_budget: 40 });
    await seedPolicy(hb, T1, [m]);
    const over = await hb.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(over.status).toBe(429);
    expect(over.body['error_code']).toBe('SF-RATE-001');
    expect(JSON.stringify(over.body)).toContain('BUDGET_EXCEEDED');
    expect(hb.providers.get('sim-primary')?.calls).toBe(0);
    expect(small).toBeTruthy();

    const big = await buildHarness();
    const bm = await seedModel(big, T1, { max_input_chars: 10 });
    await seedPolicy(big, T1, [bm]);
    const tooLarge = await big.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(tooLarge.status).toBe(400);
    expect(JSON.stringify(tooLarge.body)).toContain('INPUT_TOO_LARGE');

    const limited = await buildHarness({}, { rateLimitMax: 2 });
    await seeded(limited);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await limited.call(T1, 'GET', '/v1/ai/models/capabilities')).status);
    }
    expect(statuses).toContain(429);
  });

  it('accumulates token usage toward the daily budget', async () => {
    const hb = await buildHarness();
    const m = await seedModel(hb, T1, { daily_token_budget: 150 });
    await seedPolicy(hb, T1, [m], { max_output_tokens: 128 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await hb.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY)).status);
    }
    expect(statuses[0]).toBe(200);
    expect(statuses.at(-1)).toBe(429);
  });

  it('falls back to a secondary provider and emits a fallback event', async () => {
    h = await buildHarness({ 'sim-primary': 'provider_outage' });
    const a = await seedModel(h, T1);
    const b = await seedModel(h, T1, { provider_id: 'sim-secondary' });
    await seedPolicy(h, T1, [a, b]);
    const res = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(res.status).toBe(200);
    expect(res.body['fallback_used']).toBe(true);
    expect((res.body['model'] as { provider_id: string }).provider_id).toBe('sim-secondary');
    expect(h.store.outbox.map((o) => o.eventType)).toContain('AIProviderFallbackUsed');
    expect(h.store.metadata[0]?.attempts).toBe(2);
  });

  it('fails safely on outage and timeout, signalling the non-AI path', async () => {
    h = await buildHarness({ 'sim-primary': 'provider_outage' });
    await seeded(h);
    const outage = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(outage.status).toBe(503);
    expect(outage.body['error_code']).toBe('SF-AI-001');
    expect(JSON.stringify(outage.body)).toContain('FALLBACK_NON_AI_PATH');
    expect(h.store.metadata[0]?.outcome).toBe('FAILED');

    const t = await buildHarness({ 'sim-primary': 'provider_timeout' });
    await seeded(t, T1, { latency_budget_ms: 100, fallback_behavior: 'DENY' });
    const timeout = await t.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(timeout.status).toBe(503);
    expect(JSON.stringify(timeout.body)).not.toContain('FALLBACK_NON_AI_PATH');
  });

  it('blocks output asserting a binding statutory decision and oversized output', async () => {
    for (const scenario of ['unsafe_output', 'binding_decision_output'] as const) {
      const hs = await buildHarness({ 'sim-primary': scenario });
      await seeded(hs);
      const res = await hs.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('STATUTORY_DECISION_OUTPUT');
      expect(JSON.stringify(res.body)).not.toContain('approved');
      expect(res.body['statutory_decision']).toBeUndefined();
    }
    const big = await buildHarness({ 'sim-primary': 'oversized_output' });
    await seeded(big);
    const res = await big.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('OUTPUT_TOO_LARGE');
  });

  it('rejects wrong variables and mismatched operations', async () => {
    await seeded(h);
    const missing = await h.call(T1, 'POST', '/v1/ai/invoke', { ...INVOKE_BODY, variables: {} });
    expect(missing.status).toBe(400);
    const extra = await h.call(T1, 'POST', '/v1/ai/invoke', {
      ...INVOKE_BODY,
      variables: { subject: 'x', other: 'y' },
    });
    expect(extra.status).toBe(400);
    const { variables: _v, ...rest } = INVOKE_BODY;
    void _v;
    const embedOnInvoke = await h.call(T1, 'POST', '/v1/ai/embed', { ...rest, inputs: ['a'] });
    expect(embedOnInvoke.status).toBe(400);
    expect(JSON.stringify(embedOnInvoke.body)).toContain('OPERATION_MISMATCH');
    const none = await h.call(T1, 'POST', '/v1/ai/invoke', { ...INVOKE_BODY, policy_version: 9 });
    expect(none.status).toBe(404);
  });

  it('supports embeddings through the same governed path', async () => {
    const model = await seedModel(h, T1);
    await seedPolicy(h, T1, [model], {
      policy_id: 'embed-docs',
      task_kind: 'EMBED',
      template_body: undefined,
      allowed_tools: undefined,
    });
    const { variables: _v, ...rest } = INVOKE_BODY;
    void _v;
    const res = await h.call(T1, 'POST', '/v1/ai/embed', {
      ...rest,
      policy_id: 'embed-docs',
      inputs: [`mail ${synthetic.email()}`, 'plain text'],
    });
    expect(res.status).toBe(200);
    expect((res.body['vectors'] as number[][]).length).toBe(2);
    expect(JSON.stringify(h.store.metadata)).not.toContain(synthetic.email());
    expect(h.store.metadata[0]?.operation).toBe('EMBED');
    const embedFail = await buildHarness({ 'sim-primary': 'provider_outage' });
    const m2 = await seedModel(embedFail, T1);
    await seedPolicy(embedFail, T1, [m2], {
      policy_id: 'embed-docs',
      task_kind: 'EMBED',
      template_body: undefined,
      allowed_tools: undefined,
    });
    const failed = await embedFail.call(T1, 'POST', '/v1/ai/embed', {
      ...rest,
      policy_id: 'embed-docs',
      inputs: ['x'],
    });
    expect(failed.status).toBe(503);
  });

  it('rejects tenant headers and unauthenticated requests', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/ai/models/capabilities',
      headers: { 'x-tenant-id': T1 },
    });
    expect(res.statusCode).toBe(403);
    const anon = await h.app.inject({ method: 'GET', url: '/v1/ai/models/capabilities' });
    expect(anon.statusCode).toBe(401);
    const noKey = await h.app.inject({
      method: 'POST',
      url: '/v1/ai/invoke',
      headers: { authorization: 'Bearer tok-x' },
      payload: INVOKE_BODY,
    });
    expect(noKey.statusCode).toBe(401);
  });
});

describe('registry governance', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it('refuses statutory-decision task kinds and unknown kinds', async () => {
    const model = await seedModel(h, T1);
    for (const task_kind of [
      'ELIGIBILITY_DECISION',
      'APPROVE_APPLICATION',
      'REJECT_APPLICATION',
      'ENTITLEMENT_DETERMINATION',
      'PENALTY_ASSESSMENT',
    ]) {
      const res = await h.call(T1, 'POST', '/v1/ai/admin/policies', {
        policy_id: 'bad-policy',
        policy_version: 1,
        task_kind,
        template_body: 'Decide: {{subject}}',
        model_entry_ids: [model],
        max_data_classification: 'INTERNAL',
        max_output_tokens: 10,
        latency_budget_ms: 500,
        fallback_behavior: 'DENY',
        evaluation_ref: { dataset_id: 'd', dataset_version: '1', threshold: 0.9, result: 'PASSED' },
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('STATUTORY_DECISION_FORBIDDEN');
    }
    const unknown = await h.call(T1, 'POST', '/v1/ai/admin/policies', {
      policy_id: 'bad-policy',
      policy_version: 1,
      task_kind: 'TRANSLATE',
      template_body: 'x {{subject}}',
      model_entry_ids: [model],
      max_data_classification: 'INTERNAL',
      max_output_tokens: 10,
      latency_budget_ms: 500,
      fallback_behavior: 'DENY',
      evaluation_ref: { dataset_id: 'd', dataset_version: '1', threshold: 0.9, result: 'PASSED' },
    });
    expect(JSON.stringify(unknown.body)).toContain('TASK_KIND_INVALID');
    expect(h.store.policies).toHaveLength(0);
  });

  it('refuses decision-capable tools, sensitive templates, bad evaluation and floating model versions', async () => {
    const model = await seedModel(h, T1);
    const attempt = async (overrides: Record<string, unknown>) => {
      const { policyBody } = await import('./harness.js');
      return h.call(T1, 'POST', '/v1/ai/admin/policies', policyBody([model], overrides));
    };
    const toolEffect = await attempt({
      allowed_tools: [
        { tool_id: 'approve_case', version: '1', scopes: ['case:write'], effect: 'DECISION' },
      ],
    });
    expect(JSON.stringify(toolEffect.body)).toContain('TOOL_EFFECT_FORBIDDEN');
    const sensitive = await attempt({
      template_body: `Write to ${synthetic.email()} about {{subject}}`,
    });
    expect(JSON.stringify(sensitive.body)).toContain('TEMPLATE_CONTAINS_SENSITIVE_DATA');
    const noEval = await attempt({ evaluation_ref: undefined });
    expect(noEval.status).toBe(400);
    const failedEval = await attempt({
      evaluation_ref: { dataset_id: 'd', dataset_version: '1', threshold: 0.9, result: 'FAILED' },
    });
    expect(JSON.stringify(failedEval.body)).toContain('EVALUATION_NOT_PASSED');
    const stray = await attempt({ template_body: 'Hello {{Subject}}' });
    expect(JSON.stringify(stray.body)).toContain('TEMPLATE_PLACEHOLDER_INVALID');
    const limits = await attempt({ max_output_tokens: 99999 });
    expect(limits.status).toBe(400);
    const exceedsModel = await attempt({ max_output_tokens: 300 });
    expect(JSON.stringify(exceedsModel.body)).toContain('POLICY_EXCEEDS_MODEL_LIMITS');
    const unknownModel = await attempt({
      model_entry_ids: ['99999999-9999-4999-8999-999999999999'],
    });
    expect(unknownModel.status).toBe(403);
    const floating = await h.call(T1, 'POST', '/v1/ai/admin/models', {
      ...MODEL_BODY,
      model_version: 'latest',
    });
    expect(JSON.stringify(floating.body)).toContain('MODEL_VERSION_NOT_PINNED');
    expect(
      (await h.call(T1, 'POST', '/v1/ai/admin/models', { ...MODEL_BODY, extra: 1 })).status,
    ).toBe(400);
    expect(
      (await h.call(T1, 'POST', '/v1/ai/admin/models', { ...MODEL_BODY, operations: ['TRAIN'] }))
        .status,
    ).toBe(400);
  });

  it('prevents duplicate pins, retires policy versions and blocks use afterwards', async () => {
    const model = await seedModel(h, T1);
    const dup = await h.call(T1, 'POST', '/v1/ai/admin/models', MODEL_BODY);
    expect(dup.status).toBe(409);
    await seedPolicy(h, T1, [model]);
    const retire = await h.call(
      T1,
      'POST',
      '/v1/ai/admin/policies/draft-reply/versions/1/retire',
      {},
    );
    expect(retire.status).toBe(200);
    const again = await h.call(
      T1,
      'POST',
      '/v1/ai/admin/policies/draft-reply/versions/1/retire',
      {},
    );
    expect(again.status).toBe(400);
    const missing = await h.call(
      T1,
      'POST',
      '/v1/ai/admin/policies/draft-reply/versions/7/retire',
      {},
    );
    expect(missing.status).toBe(404);
    const use = await h.call(T1, 'POST', '/v1/ai/invoke', INVOKE_BODY);
    expect(use.status).toBe(404);
    expect(JSON.stringify(use.body)).toContain('POLICY_NOT_ACTIVE');
    const noReason = await h.call(T1, 'POST', `/v1/ai/admin/models/${model}/revoke`, {});
    expect(noReason.status).toBe(400);
    const badId = await h.call(T1, 'POST', '/v1/ai/admin/models/not-a-uuid/revoke', {
      reason: 'x',
    });
    expect(badId.status).toBe(400);
    const gone = await h.call(
      T1,
      'POST',
      '/v1/ai/admin/models/99999999-9999-4999-8999-999999999999/revoke',
      {
        reason: 'x',
      },
    );
    expect(gone.status).toBe(404);
    const badVersion = await h.call(
      T1,
      'POST',
      '/v1/ai/admin/policies/draft-reply/versions/zero/retire',
      {},
    );
    expect(badVersion.status).toBe(400);
  });

  it('requires authorization for registry changes', async () => {
    h.authorizer.denies.add('AI_MODEL_REGISTER');
    const res = await h.call(T1, 'POST', '/v1/ai/admin/models', MODEL_BODY);
    expect(res.status).toBe(403);
    expect(h.store.models).toHaveLength(0);
  });
});
