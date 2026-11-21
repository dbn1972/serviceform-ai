/**
 * SAMPLE_LAB journey notification catalogue (SF-55).
 * Mirrors fixtures/lab/platform/notification-catalogue.json.
 * SIMULATED SMS via CMP-025; REAL SMS remains owner-held. CERTIFIED=false. G6=false.
 */

export type JourneyNotifyTrigger =
  | 'DEFICIENCY_OPENED'
  | 'DEFICIENCY_CLOSED'
  | 'APPLICATION_APPROVED'
  | 'APPLICATION_REJECTED'
  | 'CREDENTIAL_ISSUED';

export type SampleLabNotificationTemplate = {
  template_ref: string;
  trigger: JourneyNotifyTrigger;
  subject_template: string | null;
  body_template: string;
  allowed_params: readonly string[];
};

export type SampleLabNotificationCatalogue = {
  simulation: 'SIMULATED';
  locale: string;
  channel: 'SMS';
  sms_binding_id: string;
  recipient_handle_class: 'CITIZEN_HANDLE_REF';
  recipient_handle_ref: string;
  simulator_version: string;
  workload: {
    publisher_actor_id: string;
    publisher_roles: readonly string[];
    worker_actor_id: string;
    worker_roles: readonly string[];
  };
  templates: readonly SampleLabNotificationTemplate[];
};

export const SAMPLE_LAB_NOTIFICATION_CATALOGUE: SampleLabNotificationCatalogue = {
  simulation: 'SIMULATED',
  locale: 'en-IN',
  channel: 'SMS',
  sms_binding_id: '0d15ba00-0c25-4000-8000-0d15ba000c25',
  recipient_handle_class: 'CITIZEN_HANDLE_REF',
  recipient_handle_ref: 'sample-lab.citizen.handle',
  simulator_version: 'sample-lab-notify-sim-1',
  workload: {
    publisher_actor_id: '0d15ba00-0025-4000-8000-0d15ba00025a',
    publisher_roles: ['SAMPLE_LAB_NOTIFY_OPERATOR'],
    worker_actor_id: '0d15ba00-0025-4000-8000-0d15ba00025b',
    worker_roles: ['SAMPLE_LAB_NOTIFY_WORKER'],
  },
  templates: [
    {
      template_ref: 'sample-lab.deficiency.opened.v1',
      trigger: 'DEFICIENCY_OPENED',
      subject_template: null,
      body_template:
        'Action needed on application {{application_ref}}. Additional documents requested. Open your portal to respond.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.deficiency.closed.v1',
      trigger: 'DEFICIENCY_CLOSED',
      subject_template: null,
      body_template:
        'Deficiency closed for application {{application_ref}}. Processing will continue.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.decision.approved.v1',
      trigger: 'APPLICATION_APPROVED',
      subject_template: null,
      body_template:
        'Decision recorded for application {{application_ref}}: approved. Credential issuance may follow.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.decision.rejected.v1',
      trigger: 'APPLICATION_REJECTED',
      subject_template: null,
      body_template:
        'Decision recorded for application {{application_ref}}: not approved. Check your portal for next steps.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.credential.issued.v1',
      trigger: 'CREDENTIAL_ISSUED',
      subject_template: null,
      body_template:
        'Credential issued for application {{application_ref}}. Available in your portal and DigiLocker (SIMULATED).',
      allowed_params: ['application_ref'],
    },
  ],
};

const BY_TRIGGER = new Map(
  SAMPLE_LAB_NOTIFICATION_CATALOGUE.templates.map((t) => [t.trigger, t] as const),
);

export function templateForTrigger(
  trigger: JourneyNotifyTrigger,
): SampleLabNotificationTemplate | undefined {
  return BY_TRIGGER.get(trigger);
}

/** CMP-019 deficiency kinds → catalogue triggers (responded has no citizen SMS in P1). */
export function deficiencyKindToTrigger(
  kind: 'DEFICIENCY_OPENED' | 'DEFICIENCY_RESPONDED' | 'DEFICIENCY_CLOSED',
): JourneyNotifyTrigger | null {
  if (kind === 'DEFICIENCY_OPENED') return 'DEFICIENCY_OPENED';
  if (kind === 'DEFICIENCY_CLOSED') return 'DEFICIENCY_CLOSED';
  return null;
}
