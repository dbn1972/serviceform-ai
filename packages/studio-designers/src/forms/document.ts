import type { FormPackage } from '@serviceform/service-templates';
import { contentHash } from '../hash';
import { compileForm, formPages } from './compile';
import { documentKey } from './lint';
import type { DesignerForm } from './model';

export const FORM_DESIGNER_TOOL = 'SF_STUDIO_FORMS_DESIGNER';
export const FORM_DESIGNER_MODEL_VERSION = 1;

/**
 * CMP-033 FORM metadata payload. `pages` is the structural summary CMP-033 has always required;
 * `form_package` is the executable CMP-009 FORM package and `content_hash` its canonical digest,
 * which CMP-033 re-computes on validate and CMP-009 checks on every pinned resolve.
 */
export interface FormDocumentPayload {
  pages: { id: string; fields: { id: string; control: string }[] }[];
  form_package: FormPackage;
  content_hash: string;
  authoring: {
    tool: typeof FORM_DESIGNER_TOOL;
    model_version: number;
    form_version: string;
    source?: string;
  };
}

export interface CompiledForm {
  documentKey: string;
  formPackage: FormPackage;
  contentHash: string;
  payload: FormDocumentPayload;
}

export async function buildFormDocument(
  form: DesignerForm,
  source?: string,
): Promise<CompiledForm> {
  const formPackage = compileForm(form);
  const hash = await contentHash(formPackage);
  return {
    documentKey: documentKey(form),
    formPackage,
    contentHash: hash,
    payload: {
      pages: formPages(form),
      form_package: formPackage,
      content_hash: hash,
      authoring: {
        tool: FORM_DESIGNER_TOOL,
        model_version: FORM_DESIGNER_MODEL_VERSION,
        form_version: form.version,
        ...(source ? { source } : {}),
      },
    },
  };
}

/** The pin a TenantServiceBinding and CMP-009 use for a frozen form version. */
export interface FormPin {
  form_key: string;
  version_id: string;
  content_hash: string;
}

/** Reads a designer document back out of a CMP-033 payload; null when it is not one. */
export function formPackageOf(
  payload: unknown,
): { formPackage: FormPackage; contentHash: string; version?: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<FormDocumentPayload>;
  const pkg = p.form_package;
  if (
    !pkg ||
    typeof pkg !== 'object' ||
    typeof pkg.form_id !== 'string' ||
    typeof pkg.json_schema !== 'object' ||
    typeof pkg.ui_schema !== 'object' ||
    typeof p.content_hash !== 'string'
  ) {
    return null;
  }
  return {
    formPackage: pkg,
    contentHash: p.content_hash,
    ...(typeof p.authoring?.form_version === 'string' ? { version: p.authoring.form_version } : {}),
  };
}
