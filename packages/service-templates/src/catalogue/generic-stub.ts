import { createHash } from 'node:crypto';
import {
  ADDRESS_PARTS,
  control,
  dateOfBirth,
  declaration,
  fullName,
  gender,
  mobile,
  lgdPostalAddress,
  purpose,
} from '../fields';
import { formContentHash } from '../integrity';
import { SAMPLE_LAB_DUMMY_POLICY_FACTS } from '../sample-lab-dummy';
import type {
  CertificateTemplate,
  CredentialField,
  FormPackage,
  FormSchemaNode,
  UiElement,
} from '../types';

/**
 * Generic SAMPLE_LAB stubs for registry Certificate entries.
 * Form fields follow Recommended Core Fields only. Fee/time/eligibility/evidence use
 * SAMPLE_LAB DUMMY defaults (synthetic, tenant-overridable via CMP-052) — not statute.
 */

export const CERTIFICATE_OUTPUT_TYPE = 'Certificate' as const;

/** Hand-crafted templates that must not be replaced by the generic factory. */
export const HANDCRAFTED_CERTIFICATE_IDS = new Set([
  'IND-SOC-002', // Residence — SAMPLE_LAB_PUBLISHED
  'IND-SOC-031', // Income — richer stub + authoring_path
  'IND-SOC-001', // Domicile — richer stub
]);

const STUB_DECLARATION =
  'I declare that the particulars above are true for this SAMPLE_LAB preview and that no real personal data has been entered.';

const ISSUER_CORE = new Set([
  'Application ID',
  'Issue Date',
  'Issuing Authority',
  'Digital Signature',
  'QR/Verification URI',
  'Status',
  'Jurisdiction',
]);

/** Extra Recommended Core Fields → applicant-facing schema (labels from registry only). */
const EXTRA_FIELD_BUILDERS: Record<
  string,
  { key: string; node: () => FormSchemaNode; required?: boolean }
> = {
  'Family/Household ID': {
    key: 'family_household_id',
    node: () => ({
      type: 'string',
      title: 'Family / household ID',
      maxLength: 40,
      semanticElementId: 'SF-SEM-FAMILY-HOUSEHOLD-ID',
      'x-ux4g': { hint: 'If the state issues one · optional' },
    }),
  },
  'Annual Income': {
    key: 'annual_income_rupees',
    required: true,
    node: () => ({
      type: 'integer',
      title: 'Annual income (₹)',
      minimum: 0,
      semanticElementId: 'SF-SEM-ANNUAL-INCOME',
      'x-ux4g': { inputMode: 'numeric' },
    }),
  },
  'Assessment Period': {
    key: 'assessment_period',
    required: true,
    node: () => ({
      type: 'string',
      title: 'Assessment period (financial year, e.g. 2025-26)',
      pattern: '^[0-9]{4}-[0-9]{2}$',
      semanticElementId: 'SF-SEM-ASSESSMENT-PERIOD',
      'x-ux4g': { error_messages: { PATTERN: 'Use the form YYYY-YY, for example 2025-26' } },
    }),
  },
  'Community/Category': {
    key: 'community_category',
    required: true,
    node: () => ({
      type: 'string',
      title: 'Community / category (as on supporting evidence)',
      minLength: 1,
      maxLength: 120,
      semanticElementId: 'SF-SEM-COMMUNITY-CATEGORY',
      'x-ux4g': {
        hint: 'Free text · statutory category lists require owner policy',
        span: 2,
      },
    }),
  },
  'Category List/Order Reference': {
    key: 'category_list_order_reference',
    node: () => ({
      type: 'string',
      title: 'Category list / order reference',
      maxLength: 120,
      semanticElementId: 'SF-SEM-CATEGORY-LIST-REF',
      'x-ux4g': { hint: 'Optional · as cited on evidence' },
    }),
  },
  'Survey/Plot/Property ID': {
    key: 'survey_plot_property_id',
    required: true,
    node: () => ({
      type: 'string',
      title: 'Survey / plot / property ID',
      minLength: 1,
      maxLength: 80,
      semanticElementId: 'SF-SEM-SURVEY-PLOT-ID',
    }),
  },
  'Village/Ward': {
    key: 'village_ward',
    required: true,
    node: () => ({
      type: 'string',
      title: 'Village / ward',
      minLength: 1,
      maxLength: 120,
      semanticElementId: 'SF-SEM-VILLAGE-WARD',
    }),
  },
  'Ownership/Tenure': {
    key: 'ownership_tenure',
    required: true,
    node: () => ({
      type: 'string',
      title: 'Ownership / tenure (as on supporting evidence)',
      minLength: 1,
      maxLength: 120,
      semanticElementId: 'SF-SEM-OWNERSHIP-TENURE',
      'x-ux4g': { hint: 'Free text · no invented tenure enum' },
    }),
  },
  'Event Date': {
    key: 'event_date',
    required: true,
    node: () => ({
      type: 'string',
      format: 'date',
      title: 'Event date',
      semanticElementId: 'SF-SEM-EVENT-DATE',
    }),
  },
  'Event Place': {
    key: 'event_place',
    required: true,
    node: () => ({
      type: 'string',
      title: 'Event place',
      minLength: 1,
      maxLength: 200,
      semanticElementId: 'SF-SEM-EVENT-PLACE',
    }),
  },
  'Registration Number': {
    key: 'registration_number_claim',
    node: () => ({
      type: 'string',
      title: 'Existing registration number (if known)',
      maxLength: 60,
      semanticElementId: 'SF-SEM-REGISTRATION-NUMBER',
      'x-ux4g': { hint: 'Optional · issuer may assign a new number' },
    }),
  },
  'Valid From': {
    key: 'valid_from_claim',
    node: () => ({
      type: 'string',
      format: 'date',
      title: 'Requested valid-from date',
      semanticElementId: 'SF-SEM-VALID-FROM',
      'x-ux4g': { hint: 'Optional claim · final validity is issuer policy' },
    }),
  },
  'Valid Until': {
    key: 'valid_until_claim',
    node: () => ({
      type: 'string',
      format: 'date',
      title: 'Requested valid-until date',
      semanticElementId: 'SF-SEM-VALID-UNTIL',
      'x-ux4g': { hint: 'Optional claim · final validity is issuer policy' },
    }),
  },
  Conditions: {
    key: 'conditions_note',
    node: () => ({
      type: 'string',
      title: 'Conditions / notes for the request',
      maxLength: 500,
      semanticElementId: 'SF-SEM-CONDITIONS-NOTE',
      'x-ux4g': { span: 2 },
    }),
  },
};

export interface RegistryCertificateEntry {
  'Canonical Service ID': string;
  'Normalized National Definition': string;
  Category: string;
  'Service / Output Type': string;
  Definition: string;
  'Typical Issuing Authority': string;
  'Lifecycle / Validity Class': string;
  'Recommended Core Fields': string;
  'Recommended Credential Form': string;
  'DigiLocker / Wallet Suitability': 'High' | 'Medium' | 'Low';
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

/** Deterministic UUID (version 4 shape) from catalogue id — stable across regenerations. */
export function stubVersionId(catalogueId: string): string {
  const h = createHash('sha256').update(`sf-stub:${catalogueId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function applicantCategory(): UiElement {
  return {
    type: 'Category',
    label: 'Applicant',
    options: { hint: 'Identity details' },
    elements: [
      {
        type: 'Group',
        label: 'Identity',
        elements: [
          control('applicant_name'),
          control('applicant_dob'),
          control('applicant_mobile'),
          control('applicant_gender', { options: { format: 'radio' } }),
        ],
      },
    ],
  };
}

function addressGroup(): UiElement {
  return {
    type: 'Group',
    label: 'Address',
    elements: ADDRESS_PARTS.map((p) => control(`applicant_address/${p}`)),
  };
}

function reviewCategory(): UiElement {
  return {
    type: 'Category',
    label: 'Preview',
    options: { title: 'Preview application', hint: 'Review & declare', review: true },
    elements: [control('declaration_accepted')],
  };
}

const APPLICANT_CORE = new Set(['Applicant Name', 'DOB/Entity Date', 'Address']);

function genericForm(
  catalogueId: string,
  name: string,
  coreFields: readonly string[],
): FormPackage {
  const extras = coreFields.filter((f) => !ISSUER_CORE.has(f) && !APPLICANT_CORE.has(f));
  const properties: Record<string, FormSchemaNode> = {
    applicant_name: fullName(),
    applicant_dob: dateOfBirth(),
    applicant_gender: gender(),
    applicant_mobile: mobile(),
    applicant_address: lgdPostalAddress('Address'),
    purpose_of_certificate: purpose(),
    declaration_accepted: declaration(STUB_DECLARATION),
  };
  const required: string[] = [
    'applicant_name',
    'applicant_dob',
    'applicant_gender',
    'applicant_address',
    'purpose_of_certificate',
    'declaration_accepted',
  ];
  const detailControls: ReturnType<typeof control>[] = [
    control('purpose_of_certificate', { options: { format: 'textarea' } }),
  ];

  for (const field of extras) {
    const builder = EXTRA_FIELD_BUILDERS[field];
    if (!builder) {
      // Unknown registry core field: fail closed with a free-text claim (no invented enum).
      const key = `core_${slugify(field).replace(/-/g, '_')}`;
      properties[key] = {
        type: 'string',
        title: field,
        maxLength: 200,
        semanticElementId: `SF-SEM-CORE-${slugify(field).toUpperCase()}`,
        'x-ux4g': { hint: 'Registry core field · free text until owner policy' },
      };
      detailControls.push(control(key));
      continue;
    }
    properties[builder.key] = builder.node();
    if (builder.required) required.push(builder.key);
    detailControls.push(
      control(
        builder.key,
        builder.key === 'conditions_note' ? { options: { format: 'textarea' } } : {},
      ),
    );
  }

  return {
    form_id: `${catalogueId.toLowerCase()}.application`,
    json_schema: {
      type: 'object',
      title: `${name} application`,
      additionalProperties: false,
      required,
      properties,
    },
    ui_schema: {
      type: 'Categorization',
      elements: [
        applicantCategory(),
        {
          type: 'Category',
          label: 'Details',
          options: { hint: 'Address, purpose & registry core fields' },
          elements: [
            addressGroup(),
            {
              type: 'Group',
              label: 'Request',
              elements: detailControls,
            },
          ],
        },
        reviewCategory(),
      ],
    },
  };
}

function credentialFields(coreFields: readonly string[]): CredentialField[] {
  const fields: CredentialField[] = [
    {
      field_id: 'CERT_HOLDER_NAME',
      label: 'Name of certificate holder',
      source: '/applicant_name',
    },
    { field_id: 'CERT_ADDRESS', label: 'Address', source: '/applicant_address' },
  ];
  for (const field of coreFields) {
    const builder = EXTRA_FIELD_BUILDERS[field];
    if (builder && builder.required) {
      fields.push({
        field_id: `CERT_${builder.key.toUpperCase()}`,
        label: field,
        source: `/${builder.key}`,
      });
    }
  }
  fields.push(
    { field_id: 'CERT_APPLICATION_ID', label: 'Application ID', source: 'ISSUER' },
    { field_id: 'CERT_ISSUE_DATE', label: 'Issue date', source: 'ISSUER' },
    { field_id: 'CERT_ISSUING_AUTHORITY', label: 'Issuing authority', source: 'ISSUER' },
    { field_id: 'CERT_QR', label: 'QR / verification URI', source: 'ISSUER' },
  );
  return fields;
}

export function buildGenericCertificateStub(entry: RegistryCertificateEntry): CertificateTemplate {
  const catalogueId = entry['Canonical Service ID'];
  const name = entry['Normalized National Definition'];
  const coreFields = entry['Recommended Core Fields'].split('; ') as string[];
  const form = genericForm(catalogueId, name, coreFields);
  const summary =
    entry.Definition.length <= 180 ? entry.Definition : `${entry.Definition.slice(0, 177)}...`;

  return {
    template_id: `${catalogueId.toLowerCase()}.${slugify(name)}`,
    catalogue_id: catalogueId,
    name,
    summary,
    category: entry.Category,
    output_type: entry['Service / Output Type'],
    definition: entry.Definition,
    issuing_authority_class: entry['Typical Issuing Authority'],
    lifecycle_class: entry['Lifecycle / Validity Class'],
    credential_form: entry['Recommended Credential Form'],
    digilocker_suitability: entry['DigiLocker / Wallet Suitability'],
    core_fields: coreFields,
    maturity: 'SAMPLE_LAB_STUB',
    /** Factory pack: SAMPLE_LAB DUMMY defaults + per-id/tenant overlays. */
    authoring_path: `templates/certificate-packs/${catalogueId.toLowerCase()}/`,
    policy: SAMPLE_LAB_DUMMY_POLICY_FACTS,
    indicative_checks: [],
    credential_fields: credentialFields(coreFields),
    versions: [
      {
        version: '0.1.0',
        version_id: stubVersionId(catalogueId),
        status: 'DRAFT',
        published_at: null,
        content_hash: formContentHash(form),
        change_summary:
          'SAMPLE_LAB stub from registry core fields; SAMPLE_LAB DUMMY policy defaults (tenant-overridable).',
        form,
      },
    ],
  };
}
