import { contentHash } from '../hash';
import {
  compileCredentialExecutable,
  credentialPinHash,
  type CredentialExecutable,
} from './compile';
import { credentialDocumentKey } from './lint';
import type { CredentialDesign } from './model';

export const CREDENTIAL_DESIGNER_TOOL = 'SF_STUDIO_CREDENTIAL_DESIGNER';

export function blankCredential(
  packKey = 'lab.new-service.credential',
  title = 'New credential template',
): CredentialDesign {
  return {
    packKey,
    title,
    version: '1.0.0',
    templateKey: 'lab.generic.credential',
    displayTitle: 'SAMPLE_LAB DUMMY credential',
    digilockerLabel: 'SAMPLE_LAB_DUMMY_CREDENTIAL',
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

export function residenceSampleCredential(): CredentialDesign {
  return {
    packKey: 'lab.ind-soc-002.credential',
    title: 'Residence Certificate credential (SAMPLE_LAB)',
    version: '1.0.0',
    templateKey: 'lab.ind-soc-002.resident-certificate',
    displayTitle: 'Residence Certificate (SAMPLE_LAB)',
    digilockerLabel: 'SAMPLE_LAB_IND_SOC_002_RESIDENT',
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

/** IND-SOC-031 SAMPLE_LAB DUMMY credential / DigiLocker label (M11 dry-run; SIM only). */
export function incomeCertificateDummyCredential(): CredentialDesign {
  return {
    packKey: 'lab.ind-soc-031.credential',
    title: 'Income Certificate credential (SAMPLE_LAB DUMMY)',
    version: '1.0.0',
    templateKey: 'lab.ind-soc-031.income-certificate',
    displayTitle: 'Income Certificate (SAMPLE_LAB DUMMY)',
    digilockerLabel: 'SAMPLE_LAB_DUMMY_IND_SOC_031',
    notStatutory: true,
    policyKind: 'SAMPLE_LAB_DUMMY',
  };
}

export const CREDENTIAL_TEMPLATES = [
  {
    id: 'ind-soc-002-credential',
    title: 'Residence Certificate credential',
    description: 'SAMPLE_LAB DigiLocker label overlay. Not statute; SIM publish only.',
    create: residenceSampleCredential,
  },
  {
    id: 'ind-soc-031-credential',
    title: 'Income Certificate credential (SAMPLE_LAB DUMMY)',
    description:
      'IND-SOC-031 M11 dry-run DigiLocker label. Not statute; SIM only; SF-33 gates PUBLISH.',
    create: incomeCertificateDummyCredential,
  },
] as const;

export function updateCredential(
  design: CredentialDesign,
  patch: Partial<CredentialDesign>,
): CredentialDesign {
  return { ...design, ...patch };
}

export interface CredentialDocumentPayload {
  template_key: string;
  display_title: string;
  digilocker_label: string;
  policy_kind: CredentialDesign['policyKind'];
  not_statutory: boolean;
  content_hash: string;
  authoring: {
    tool: typeof CREDENTIAL_DESIGNER_TOOL;
    model_version: 1;
    version: string;
    title: string;
    design: CredentialDesign;
  };
}

export interface CompiledCredential {
  documentKey: string;
  contentHash: string;
  designHash: string;
  payload: CredentialDocumentPayload;
  executable: CredentialExecutable;
}

export async function buildCredentialDocument(
  design: CredentialDesign,
): Promise<CompiledCredential> {
  const executable = compileCredentialExecutable(design);
  const hash = await credentialPinHash(design);
  return {
    documentKey: credentialDocumentKey(design),
    contentHash: hash,
    designHash: await contentHash(design),
    executable,
    payload: {
      template_key: executable.template_key,
      display_title: executable.display_title,
      digilocker_label: executable.digilocker_label,
      policy_kind: executable.policy_kind,
      not_statutory: executable.not_statutory,
      content_hash: hash,
      authoring: {
        tool: CREDENTIAL_DESIGNER_TOOL,
        model_version: 1,
        version: design.version,
        title: design.title,
        design,
      },
    },
  };
}

export function credentialDocumentOf(
  payload: unknown,
): { design: CredentialDesign; contentHash: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<CredentialDocumentPayload>;
  const design = p.authoring?.design;
  if (!design || typeof p.content_hash !== 'string' || typeof design.templateKey !== 'string')
    return null;
  if (p.authoring?.tool !== CREDENTIAL_DESIGNER_TOOL) return null;
  return { design, contentHash: p.content_hash };
}
