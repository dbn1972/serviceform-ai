import { pinHash } from '../common';
import type { CredentialDesign } from './model';

export interface CredentialExecutable {
  template_key: string;
  display_title: string;
  digilocker_label: string;
  policy_kind: CredentialDesign['policyKind'];
  not_statutory: boolean;
}

export function compileCredentialExecutable(design: CredentialDesign): CredentialExecutable {
  return {
    template_key: design.templateKey,
    display_title: design.displayTitle,
    digilocker_label: design.digilockerLabel,
    policy_kind: design.policyKind,
    not_statutory: design.notStatutory,
  };
}

/** Pin hash over CMP-033 structural field (`template_key`). */
export function credentialPinHash(design: CredentialDesign): Promise<string> {
  return pinHash({ template_key: design.templateKey });
}
