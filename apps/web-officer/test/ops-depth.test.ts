import { describe, expect, it } from 'vitest';
import {
  transitionCommandLabel,
  transitionSummary,
  type CaseTransitionView,
} from '../lib/portal/audit-view';
import { orderedCasePins, PIN_LABELS, type CasePinGraph } from '../lib/portal/pin-view';
import { toWorkbenchApplication, type PlatformApplication } from '../lib/portal/cases';
import { tenantIdentifyingRefusal, crossSiteRefusal } from '../lib/portal/platform';

const SAMPLE_PINS: CasePinGraph = {
  tenant_service_binding_id: '0d15ba00-0002-4000-8000-0d15ba0000d2',
  form_version_id: '0d15ba00-0010-4000-8000-0d15ba000010',
  rule_version_id: '0d15ba00-0011-4000-8000-0d15ba000011',
  workflow_version_id: '0d15ba00-0012-4000-8000-0d15ba000012',
  evidence_policy_version_id: '0d15ba00-0013-4000-8000-0d15ba000013',
  sla_policy_version_id: '0d15ba00-0014-4000-8000-0d15ba000014',
  fee_policy_version_id: '0d15ba00-0015-4000-8000-0d15ba000015',
};

describe('ops depth — TSB version pin clarity (WS6)', () => {
  it('orders required pins with TenantServiceBinding first', () => {
    const rows = orderedCasePins(SAMPLE_PINS);
    expect(rows[0]?.key).toBe('tenant_service_binding_id');
    expect(rows[0]?.label).toBe(PIN_LABELS.tenant_service_binding_id);
    expect(rows.map((r) => r.key)).toContain('sla_policy_version_id');
    expect(rows.find((r) => r.key === 'fee_policy_version_id')?.version_id).toBe(
      SAMPLE_PINS.fee_policy_version_id,
    );
  });

  it('omits empty optional pins and returns [] when undefined', () => {
    const { fee_policy_version_id: _f, ...required } = SAMPLE_PINS;
    expect(orderedCasePins(required).some((r) => r.key === 'fee_policy_version_id')).toBe(false);
    expect(orderedCasePins(undefined)).toEqual([]);
  });

  it('passes full pin graph through toWorkbenchApplication with silent_repoint_forbidden', () => {
    const app: PlatformApplication = {
      application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'UNDER_SCRUTINY',
      aggregate_version: 3,
      created_at: '2026-11-24T00:00:00.000Z',
      updated_at: '2026-11-24T00:00:00.000Z',
      submitted_at: '2026-11-24T00:00:00.000Z',
      pins: SAMPLE_PINS,
      pin_graph_hash: 'deadbeef',
    };
    const view = toWorkbenchApplication(app, { applicant_name: 'SAMPLE Citizen' });
    expect(view.pins).toEqual(SAMPLE_PINS);
    expect(view.pin_graph_hash).toBe('deadbeef');
    expect(view.silent_repoint_forbidden).toBe(true);
    expect(view.catalogue_id).toBe('IND-SOC-002');
  });
});

describe('ops depth — case audit trail labels (WS6)', () => {
  it('summarises state transitions and labels deficiency / decision commands', () => {
    const t: CaseTransitionView = {
      transition_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      command: 'RAISE_DEFICIENCY',
      from_state: 'UNDER_SCRUTINY',
      to_state: 'DEFICIENCY_RAISED',
      transition_key: null,
      transition_class: null,
      aggregate_version: 4,
      authz_policy_revision: 'authz-bundle-1',
      correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      actor_type: 'OFFICER',
      reason_code: 'MISSING_PROOF',
      occurred_at: '2026-11-24T12:00:00.000Z',
    };
    expect(transitionSummary(t)).toBe('UNDER_SCRUTINY → DEFICIENCY_RAISED');
    expect(transitionCommandLabel('RAISE_DEFICIENCY')).toBe('Deficiency raised');
    expect(transitionCommandLabel('RECORD_CITIZEN_RESPONSE')).toBe('Citizen response recorded');
    expect(transitionCommandLabel('RECORD_APPROVED')).toBe('Approved (human)');
    expect(transitionCommandLabel('UNKNOWN_CMD')).toBe('UNKNOWN_CMD');
    expect(transitionSummary({ ...t, from_state: null })).toBe('∅ → DEFICIENCY_RAISED');
  });
});

describe('ops depth — tenant isolation fail-closed (WS6)', () => {
  it('refuses x-tenant-id / x-roles / Forwarded tenant= with SF-TEN-002', () => {
    const forged = tenantIdentifyingRefusal(
      new Request('http://officer.local/api/portal/applications', {
        headers: { 'x-tenant-id': '22222222-2222-4222-8222-222222222222' },
      }),
    );
    expect(forged?.status).toBe(403);
    expect(forged).not.toBeNull();

    const roles = tenantIdentifyingRefusal(
      new Request('http://officer.local/api/portal/applications', {
        headers: { 'x-roles': 'PLATFORM_ADMIN' },
      }),
    );
    expect(roles?.status).toBe(403);

    const forwarded = tenantIdentifyingRefusal(
      new Request('http://officer.local/api/portal/applications', {
        headers: { Forwarded: 'for=10.0.0.1;tenant=evil' },
      }),
    );
    expect(forwarded?.status).toBe(403);
  });

  it('allows ordinary requests without tenant-identifying headers', () => {
    expect(
      tenantIdentifyingRefusal(
        new Request('http://officer.local/api/portal/applications', {
          headers: { accept: 'application/json' },
        }),
      ),
    ).toBeNull();
  });

  it('cross-site POST without JSON content-type is refused (SF-SYS-003 / SF-AUTH-002)', () => {
    const res = crossSiteRefusal(
      new Request('http://officer.local/api/portal/applications/a', {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' },
        body: 'x',
      }),
    );
    expect(res?.status).toBe(403);
  });
});
