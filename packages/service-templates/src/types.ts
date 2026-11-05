/**
 * Studio template catalogue types. A template version's `form` is a CMP-009 FORM package
 * (JSON Schema + UI schema). `x-ux4g` and `semanticElementId` are presentation/semantic hints that
 * CMP-009 ignores; validation meaning lives only in standard JSON Schema keywords.
 */

export type Ux4gInputMode = 'numeric' | 'email' | 'tel' | 'text';

export interface Ux4gHints {
  hint?: string;
  inputMode?: Ux4gInputMode;
  autocomplete?: string;
  enum_labels?: Record<string, string>;
  /** Error copy keyed by CMP-009 issue code (REQUIRED, PATTERN, MIN_LENGTH ...). */
  error_messages?: Record<string, string>;
  /** Full-width control in the two-column UX4G form grid. */
  span?: 2;
}

export interface FormSchemaNode {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  title?: string;
  description?: string;
  format?: 'date' | 'date-time' | 'email' | 'uuid';
  enum?: readonly string[];
  const?: string | number | boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  properties?: Record<string, FormSchemaNode>;
  required?: readonly string[];
  additionalProperties?: boolean;
  if?: FormSchemaNode;
  then?: FormSchemaNode;
  else?: FormSchemaNode;
  semanticElementId?: string;
  'x-ux4g'?: Ux4gHints;
}

export interface UiRule {
  effect: 'SHOW' | 'HIDE' | 'ENABLE' | 'DISABLE';
  condition: {
    scope: string;
    schema: { const?: string | number | boolean; enum?: readonly string[] };
  };
}

export interface UiControl {
  type: 'Control';
  scope: string;
  options?: { format?: 'radio' | 'textarea' };
  rule?: UiRule;
}

export interface UiLayout {
  type: 'Categorization' | 'Category' | 'Group' | 'VerticalLayout' | 'HorizontalLayout';
  label?: string;
  /** `title` heads the step's card; `label` names it in the stepper. */
  options?: { title?: string; hint?: string; review?: boolean };
  rule?: UiRule;
  elements: readonly UiElement[];
}

export type UiElement = UiControl | UiLayout;

export interface FormPackage {
  form_id: string;
  json_schema: FormSchemaNode;
  ui_schema: UiLayout;
}

export type VersionStatus = 'PUBLISHED' | 'DRAFT' | 'RETIRED';

export interface TemplateVersion {
  version: string;
  /** Pinned by a TenantServiceBinding as `form_version_id`. */
  version_id: string;
  status: VersionStatus;
  published_at: string | null;
  /** `sha256:` + canonical-JSON digest of `form`; frozen once PUBLISHED. */
  content_hash: string;
  change_summary: string;
  form: FormPackage;
  /** Synthetic SAMPLE_LAB prefill. Never real personal data. */
  sample_data?: Record<string, unknown>;
}

/** SAMPLE_LAB_PUBLISHED: offered in the lab tenant. SAMPLE_LAB_STUB: browse/preview only. */
export type TemplateMaturity = 'SAMPLE_LAB_PUBLISHED' | 'SAMPLE_LAB_STUB';

export interface CredentialField {
  field_id: string;
  label: string;
  /** JSON pointer into the form data, or ISSUER when CMP-022 supplies it at issuance. */
  source: string;
}

export interface PolicyFacts {
  fee: string;
  service_time: string;
  eligibility: string;
  evidence: string;
  source: string;
}

/** Indicative, non-authoritative pre-check shown to the citizen. Officers and CMP-008 decide. */
export interface IndicativeCheck {
  pointer: string;
  minimum: number;
  label: string;
}

export interface CertificateTemplate {
  template_id: string;
  catalogue_id: string;
  name: string;
  summary: string;
  category: string;
  output_type: string;
  definition: string;
  issuing_authority_class: string;
  lifecycle_class: string;
  credential_form: string;
  digilocker_suitability: 'High' | 'Medium' | 'Low';
  core_fields: readonly string[];
  maturity: TemplateMaturity;
  authoring_path: string | null;
  policy: PolicyFacts;
  indicative_checks: readonly IndicativeCheck[];
  credential_fields: readonly CredentialField[];
  versions: readonly TemplateVersion[];
}
