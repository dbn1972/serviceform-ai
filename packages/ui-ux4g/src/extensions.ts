/**
 * ServiceForm UX4G extension registry (DESIGN-SYSTEM.md candidates).
 * Composites are registered here; they are not product Studio pages (SF-M03-007).
 * Status `registered` means the id is reserved on the UX4G wrapper — implement
 * only when UX4G has no equivalent control and evidence exists.
 */
export type ExtensionStatus = 'registered';

export type Ux4gExtension = {
  id: string;
  title: string;
  ux4gBase: string;
  status: ExtensionStatus;
};

export const SF_UX4G_EXTENSIONS: readonly Ux4gExtension[] = [
  {
    id: 'jurisdiction-selector',
    title: 'Jurisdiction hierarchy selector',
    ux4gBase: 'ux4g-dropdown',
    status: 'registered',
  },
  {
    id: 'digilocker-picker',
    title: 'DigiLocker document picker',
    ux4gBase: 'ux4g-input-container',
    status: 'registered',
  },
  {
    id: 'evidence-upload',
    title: 'Evidence upload + verification state',
    ux4gBase: 'ux4g-input-container',
    status: 'registered',
  },
  {
    id: 'case-timeline',
    title: 'Application/case timeline',
    ux4gBase: 'ux4g-stepper',
    status: 'registered',
  },
  {
    id: 'sla-indicator',
    title: 'SLA/escalation indicator',
    ux4gBase: 'ux4g-badge',
    status: 'registered',
  },
  {
    id: 'appointment-slot',
    title: 'Appointment slot picker',
    ux4gBase: 'ux4g-dropdown',
    status: 'registered',
  },
  {
    id: 'officer-task-card',
    title: 'Officer task/work-queue card',
    ux4gBase: 'ux4g-card',
    status: 'registered',
  },
  {
    id: 'consent-privacy-card',
    title: 'Consent/privacy-rights card',
    ux4gBase: 'ux4g-card',
    status: 'registered',
  },
  {
    id: 'credential-qr',
    title: 'Credential/QR viewer',
    ux4gBase: 'ux4g-card',
    status: 'registered',
  },
  {
    id: 'ai-disclosure-card',
    title: 'AI-assistance disclosure/suggestion card',
    ux4gBase: 'ux4g-alert',
    status: 'registered',
  },
] as const;
