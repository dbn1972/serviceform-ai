import { describe, expect, it } from 'vitest';
import {
  auditTrailDepth,
  sanitizeAuditRow,
  shortCorrelationId,
  transitionCommandLabel,
  transitionSummary,
  type CaseTransitionView,
} from '../lib/portal/audit-view';
import {
  decideBlockedByOpenDeficiency,
  deficiencyLoopPhase,
  deficiencyLoopPhaseLabel,
  deficiencyTimeline,
} from '../lib/portal/deficiency-view';
import {
  orderedCasePins,
  pinIntegrityCue,
  PIN_LABELS,
  requiredPinsComplete,
  type CasePinGraph,
} from '../lib/portal/pin-view';
import {
  breachedSlaClocks,
  hasSlaBreach,
  hasSlaWarning,
  slaBreachSummary,
  type SlaClockView,
} from '../lib/portal/sla-view';
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

  it('refuses forged tenant headers on task queue paths (P8-5)', () => {
    const tasks = tenantIdentifyingRefusal(
      new Request('http://officer.local/api/portal/tasks', {
        headers: { 'x-tenant-id': '22222222-2222-4222-8222-222222222222' },
      }),
    );
    expect(tasks?.status).toBe(403);
    const claim = tenantIdentifyingRefusal(
      new Request('http://officer.local/api/portal/tasks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/claim', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-roles': 'APPROVER',
        },
        body: '{}',
      }),
    );
    expect(claim?.status).toBe(403);
  });
});

describe('ops depth — deficiency loop decide-block (P8-5)', () => {
  it('blocks decide while OPEN and maps loop phases + timeline', () => {
    const open = {
      deficiency_id: 'd1',
      status: 'OPEN',
      opened_at: '2026-11-24T10:00:00.000Z',
      responded_at: null,
      closed_at: null,
    };
    const responded = {
      deficiency_id: 'd2',
      status: 'RESPONSE_RECEIVED',
      opened_at: '2026-11-24T10:00:00.000Z',
      responded_at: '2026-11-24T12:00:00.000Z',
      closed_at: null,
    };
    const closed = {
      deficiency_id: 'd3',
      status: 'CLOSED',
      opened_at: '2026-11-24T10:00:00.000Z',
      responded_at: '2026-11-24T12:00:00.000Z',
      closed_at: '2026-11-24T13:00:00.000Z',
    };
    expect(decideBlockedByOpenDeficiency([open, responded]).blocked).toBe(true);
    expect(decideBlockedByOpenDeficiency([open, responded]).open_count).toBe(1);
    expect(decideBlockedByOpenDeficiency([responded, closed]).blocked).toBe(false);
    expect(deficiencyLoopPhase(open)).toBe('OPEN_AWAITING_CITIZEN');
    expect(deficiencyLoopPhaseLabel(deficiencyLoopPhase(responded))).toContain('responded');
    expect(deficiencyTimeline(closed).every((s) => s.done)).toBe(true);
  });
});

describe('ops depth — SLA breach visibility (P8-5)', () => {
  const base: SlaClockView = {
    clock_id: 'c1',
    application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    stage_code: 'OVERALL',
    clock_status: 'RUNNING',
    deadline_at: '2026-12-01T00:00:00.000Z',
    pause_reason_code: null,
    breach_at: null,
    escalation_level: 0,
    start_anchor: 'PUBLISHED_POLICY_ANCHOR',
    completion_anchor: 'DECISION_RECORDED',
    portal_clock_start_event: 'APPLICATION_SUBMITTED',
    warning_emitted_at: null,
    started_at: '2026-11-20T00:00:00.000Z',
    paused_at: null,
    completed_at: null,
  };

  it('detects breach by status or breach_at and summarises', () => {
    expect(hasSlaBreach([base])).toBe(false);
    expect(slaBreachSummary([base])).toBeNull();
    const breached = {
      ...base,
      clock_status: 'BREACHED',
      breach_at: '2026-11-30T00:00:00.000Z',
      escalation_level: 1,
    };
    expect(hasSlaBreach([breached])).toBe(true);
    expect(breachedSlaClocks([breached, base])).toHaveLength(1);
    expect(slaBreachSummary([breached])).toContain('breached at');
  });

  it('surfaces warning_emitted_at before breach', () => {
    expect(hasSlaWarning([{ ...base, warning_emitted_at: '2026-11-28T00:00:00.000Z' }])).toBe(
      true,
    );
    expect(hasSlaWarning([{ ...base, clock_status: 'COMPLETED', warning_emitted_at: 'x' }])).toBe(
      false,
    );
  });
});

describe('ops depth — pin integrity cue (P8-5)', () => {
  it('reports complete required pins and never claims G6 seal', () => {
    expect(requiredPinsComplete(SAMPLE_PINS)).toBe(true);
    const cue = pinIntegrityCue({
      pins: SAMPLE_PINS,
      pin_graph_hash: 'deadbeef',
      silent_repoint_forbidden: true,
    });
    expect(cue.silent_repoint_forbidden).toBe(true);
    expect(cue.required_pins_complete).toBe(true);
    expect(cue.pin_graph_hash_present).toBe(true);
    expect(cue.tsb_immutability_sealed).toBe(false);
    expect(cue.certified).toBe(false);
    expect(cue.g6).toBe(false);
    const { form_version_id: _f, ...incomplete } = SAMPLE_PINS;
    expect(requiredPinsComplete(incomplete as CasePinGraph)).toBe(false);
  });
});

describe('ops depth — audit trail depth + sanitize (P8-5)', () => {
  it('counts deficiency loop events and strips forbidden identity keys', () => {
    const rows: CaseTransitionView[] = [
      {
        transition_id: 't1',
        application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        command: 'RAISE_DEFICIENCY',
        from_state: 'UNDER_SCRUTINY',
        to_state: 'DEFICIENCY_RAISED',
        transition_key: null,
        transition_class: null,
        aggregate_version: 4,
        authz_policy_revision: 'authz-1',
        correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        actor_type: 'OFFICER',
        reason_code: 'MISSING_PROOF',
        occurred_at: '2026-11-24T12:00:00.000Z',
      },
      {
        transition_id: 't2',
        application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        command: 'RECORD_CITIZEN_RESPONSE',
        from_state: 'DEFICIENCY_RAISED',
        to_state: 'CITIZEN_RESPONSE',
        transition_key: null,
        transition_class: null,
        aggregate_version: 5,
        authz_policy_revision: 'authz-1',
        correlation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        actor_type: 'CITIZEN',
        reason_code: null,
        occurred_at: '2026-11-24T13:00:00.000Z',
      },
      {
        transition_id: 't3',
        application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        command: 'RECORD_APPROVED',
        from_state: 'DECISION_PENDING',
        to_state: 'APPROVED',
        transition_key: null,
        transition_class: null,
        aggregate_version: 8,
        authz_policy_revision: 'authz-1',
        correlation_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        actor_type: 'OFFICER',
        reason_code: null,
        occurred_at: '2026-11-24T15:00:00.000Z',
      },
    ];
    const depth = auditTrailDepth(rows);
    expect(depth.total).toBe(3);
    expect(depth.deficiency_loop_events).toBe(2);
    expect(depth.has_human_decision).toBe(true);
    expect(shortCorrelationId(rows[0]!.correlation_id)).toBe('cccccccc…');
    expect(transitionCommandLabel('FORWARD_FOR_APPROVAL')).toBe('Forwarded for approval');
    const dirty = sanitizeAuditRow({
      transition_id: 't1',
      actor_id: 'should-strip',
      tenant_id: 'should-strip',
      principal_id: 'should-strip',
      command: 'SUBMIT',
    });
    expect(dirty).not.toHaveProperty('actor_id');
    expect(dirty).not.toHaveProperty('tenant_id');
    expect(dirty).not.toHaveProperty('principal_id');
    expect(dirty.command).toBe('SUBMIT');
  });
});
