import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deficiencyKindToTrigger,
  journeyTriggerForCommand,
  LAB_NOTIFY_DEFAULTS,
  LabDeficiencyNotificationPort,
  LabJourneyNotifyBridge,
  LabNotificationBindings,
  LabRecipientDirectory,
  loadNotificationCatalogue,
  notifyPublisherContext,
  notifyWorkerContext,
  templateForTrigger,
} from '../src/platform/notification.js';

const ROOT = join(import.meta.dirname, '../../..');
const FIXTURE = join(ROOT, 'fixtures/lab/platform/notification-catalogue.json');
const PACKAGE_SRC = join(ROOT, 'packages/m10-sample-lab/src/notification-catalogue.ts');
const TENANT = '0d15ba00-0001-4000-8000-0d15ba0000d1';

// REQ SF-55: SAMPLE_LAB journey notify catalogue + host adapters; SIM only; CERTIFIED=false.
describe('SAMPLE_LAB journey notification host adapters', () => {
  it('publishes deficiency/decision/credential templates aligned with fixture and package', () => {
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      sms_binding_id: string;
      simulation: string;
      templates: { template_ref: string; trigger: string }[];
    };
    const src = readFileSync(PACKAGE_SRC, 'utf8');
    expect(file.simulation).toBe('SIMULATED');
    expect(file.sms_binding_id).toBe(LAB_NOTIFY_DEFAULTS.sms_binding_id);
    expect(file.templates.map((t) => t.trigger)).toEqual([
      'DEFICIENCY_OPENED',
      'DEFICIENCY_CLOSED',
      'APPLICATION_APPROVED',
      'APPLICATION_REJECTED',
      'CREDENTIAL_ISSUED',
    ]);
    for (const tpl of file.templates) {
      expect(src).toContain(`template_ref: '${tpl.template_ref}'`);
      expect(LAB_NOTIFY_DEFAULTS.templates.some((t) => t.template_ref === tpl.template_ref)).toBe(
        true,
      );
    }
    expect(src).toContain("'SAMPLE_LAB_NOTIFY_OPERATOR'");
    expect(src).toMatch(/REAL SMS remains owner-held/);
    expect(src).not.toMatch(/twilio|msg91|aws-sns/i);
  });

  it('loadNotificationCatalogue fail-closes to known SAMPLE_LAB defaults', () => {
    const loaded = loadNotificationCatalogue(join(ROOT, 'fixtures/lab/platform'));
    expect(loaded.sms_binding_id).toBe(LAB_NOTIFY_DEFAULTS.sms_binding_id);
    expect(loaded.channel).toBe('SMS');
    expect(loaded.simulation).toBe('SIMULATED');
  });

  it('maps deficiency kinds and case commands to journey triggers', () => {
    expect(deficiencyKindToTrigger('DEFICIENCY_OPENED')).toBe('DEFICIENCY_OPENED');
    expect(deficiencyKindToTrigger('DEFICIENCY_CLOSED')).toBe('DEFICIENCY_CLOSED');
    expect(deficiencyKindToTrigger('DEFICIENCY_RESPONDED')).toBeNull();
    expect(journeyTriggerForCommand('RECORD_APPROVED')).toBe('APPLICATION_APPROVED');
    expect(journeyTriggerForCommand('RECORD_REJECTED')).toBe('APPLICATION_REJECTED');
    expect(journeyTriggerForCommand('SUBMIT')).toBeNull();
    expect(templateForTrigger('CREDENTIAL_ISSUED')?.template_ref).toBe(
      'sample-lab.credential.issued.v1',
    );
  });

  it('builds OFFICER publisher and SYSTEM worker contexts', () => {
    const pub = notifyPublisherContext(LAB_NOTIFY_DEFAULTS, 'cell-lab', TENANT);
    expect(pub.actor.type).toBe('OFFICER');
    expect(pub.roles).toEqual(['SAMPLE_LAB_NOTIFY_OPERATOR']);
    const worker = notifyWorkerContext(LAB_NOTIFY_DEFAULTS, 'cell-lab', TENANT);
    expect(worker.actor.type).toBe('SYSTEM');
    expect(worker.roles).toEqual(['SAMPLE_LAB_NOTIFY_WORKER']);
    expect(worker.auth_assurance).toBe('WORKLOAD_IDENTITY');
  });

  it('LabNotificationBindings resolves only the SAMPLE_LAB SIM SMS binding', async () => {
    const port = new LabNotificationBindings(LAB_NOTIFY_DEFAULTS, TENANT, 'CI');
    const hit = await port.resolve(TENANT, LAB_NOTIFY_DEFAULTS.sms_binding_id);
    expect(hit).toMatchObject({
      mode: 'SIMULATED',
      connector_type: 'SMS',
      environment: 'CI',
      secret_ref: null,
    });
    expect(await port.resolve(TENANT, '00000000-0000-4000-8000-000000000099')).toBeNull();
  });

  it('LabRecipientDirectory resolves opaque handle without exposing other tenants', async () => {
    const dir = new LabRecipientDirectory(LAB_NOTIFY_DEFAULTS, TENANT);
    const ok = await dir.resolve({
      tenantId: TENANT,
      handleRef: LAB_NOTIFY_DEFAULTS.recipient_handle_ref,
    });
    expect(ok?.address).toMatch(/^\+/);
    expect(
      await dir.resolve({
        tenantId: '99999999-9999-4999-8999-999999999999',
        handleRef: LAB_NOTIFY_DEFAULTS.recipient_handle_ref,
      }),
    ).toBeNull();
  });

  it('LabDeficiencyNotificationPort maps OPEN/CLOSE to CMP-025 dispatch bodies', async () => {
    const calls: unknown[] = [];
    const fakeService = {
      publishTemplate: async () => ({ status: 201, body: { ok: true } }),
      dispatch: async (_ctx: unknown, input: unknown, idem: unknown) => {
        calls.push({ input, idem });
        return {
          status: 202,
          body: { dispatch_id: '0d15ba00-0d25-4000-8000-0d15ba000d25', status: 'QUEUED' },
        };
      },
    };
    const bridge = new LabJourneyNotifyBridge(
      fakeService,
      { deliverDue: async () => ({ claimed: 1 }) },
      null,
      LAB_NOTIFY_DEFAULTS,
      'cell',
      TENANT,
    );
    const port = new LabDeficiencyNotificationPort(bridge);
    await port.requestNotification({
      notification_port: 'M06_CMP025',
      tenant_id: TENANT,
      application_id: '0d15ba00-0a00-4000-8000-0d15ba000a01',
      deficiency_id: '0d15ba00-0d19-4000-8000-0d15ba000d19',
      kind: 'DEFICIENCY_OPENED',
      source_event_id: '0d15ba00-0e00-4000-8000-0d15ba000e00',
    });
    expect(calls).toHaveLength(1);
    const body = (calls[0] as { input: Record<string, unknown> }).input;
    expect(body['template_ref']).toBe('sample-lab.deficiency.opened.v1');
    expect(body['channel']).toBe('SMS');
    expect(body['connector_binding_id']).toBe(LAB_NOTIFY_DEFAULTS.sms_binding_id);
    expect(body['recipient_handle_ref']).toBe(LAB_NOTIFY_DEFAULTS.recipient_handle_ref);
    expect(String((body['template_params'] as { application_ref: string }).application_ref)).toMatch(
      /^APP-/,
    );
    // Responded is intentionally skipped in P1 (opened/closed only).
    await port.requestNotification({
      notification_port: 'M06_CMP025',
      tenant_id: TENANT,
      application_id: '0d15ba00-0a00-4000-8000-0d15ba000a01',
      deficiency_id: '0d15ba00-0d19-4000-8000-0d15ba000d19',
      kind: 'DEFICIENCY_RESPONDED',
      source_event_id: '0d15ba00-0e00-4000-8000-0d15ba000e01',
    });
    expect(calls).toHaveLength(1);
  });

  it('notifyCredentialIssued returns cmp025.dispatch ref for downstream outcome', async () => {
    const bridge = new LabJourneyNotifyBridge(
      {
        publishTemplate: async () => ({ status: 201, body: {} }),
        dispatch: async () => ({
          status: 202,
          body: { dispatch_id: '0d15ba00-0d25-4000-8000-0d15ba000d99' },
        }),
      },
      null,
      null,
      LAB_NOTIFY_DEFAULTS,
      'cell',
      TENANT,
    );
    const out = await bridge.notifyCredentialIssued(
      '0d15ba00-0a00-4000-8000-0d15ba000a01',
      '0d15ba00-0c22-4000-8000-0d15ba000c22',
    );
    expect(out.notification_ref).toBe('cmp025.dispatch:0d15ba00-0d25-4000-8000-0d15ba000d99');
  });

  it('composition source documents SIMULATED SMS and refuses REAL claims', () => {
    const src = readFileSync(join(ROOT, 'apps/api/src/platform/notification.ts'), 'utf8');
    expect(src).toMatch(/SIMULATED/);
    expect(src).toMatch(/REAL SMS remains owner-held|REAL SMS still owner/i);
    expect(src).toMatch(/CERTIFIED=false/);
    expect(src).toMatch(/G6=false/);
    expect(src).not.toMatch(/twilio|msg91|aws-sns/i);
  });
});
