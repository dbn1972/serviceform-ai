/**
 * Studio credential designer model. Compiles to CMP-033 CREDENTIAL payloads (`template_key`).
 * DigiLocker / wallet labels for SAMPLE_LAB stay DUMMY; never invent statutory credential text.
 */

export interface CredentialDesign {
  packKey: string;
  title: string;
  version: string;
  /** CMP-033 template_key. */
  templateKey: string;
  /** Citizen-facing credential title (lab overlay). */
  displayTitle: string;
  /** DigiLocker / wallet document label (SAMPLE_LAB_DUMMY OK). */
  digilockerLabel: string;
  notStatutory: boolean;
  policyKind: 'SAMPLE_LAB_DUMMY' | 'CONFIGURED';
}
