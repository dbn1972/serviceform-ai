import {
  ADDRESS_PARTS,
  control,
  dateOfBirth,
  declaration,
  fullName,
  gender,
  GENDER_ENUM,
  GENDER_LABELS,
  mobile,
  personName,
  lgdPostalAddress,
  purpose,
} from '../fields';
import { SAMPLE_LAB_DUMMY_POLICY_FACTS } from '../sample-lab-dummy';
import type { CertificateTemplate, FormPackage } from '../types';

/**
 * Hand-crafted SAMPLE_LAB stubs grounded in docs/catalogue (registry v1.0).
 * Form fields follow each entry's "Recommended Core Fields" only. Fee, service time, eligibility
 * and evidence use SAMPLE_LAB DUMMY defaults (synthetic, tenant-overridable) — not statute.
 * Stubs stay DRAFT until a PUBLISHED TSB placement; apply remains placement-gated.
 * Income (IND-SOC-031) Studio shell: templates/income-certificate/ with SAMPLE_LAB DUMMY.
 * Remaining Certificate-type registry entries are generated in generated-stubs.ts
 * (filter: Service / Output Type == Certificate) and get factory packs under
 * templates/certificate-packs/<id>/. Birth (IND-CIV-001) is Registration and stays here
 * as a pre-existing exception; it also receives a configurable pack.
 */

const STUB_DECLARATION =
  'I declare that the particulars above are true for this SAMPLE_LAB preview and that no real personal data has been entered.';

const ISSUER_FIELDS = [
  { field_id: 'CERT_APPLICATION_ID', label: 'Application ID', source: 'ISSUER' },
  { field_id: 'CERT_ISSUE_DATE', label: 'Issue date', source: 'ISSUER' },
  { field_id: 'CERT_ISSUING_AUTHORITY', label: 'Issuing authority', source: 'ISSUER' },
  { field_id: 'CERT_QR', label: 'QR / verification URI', source: 'ISSUER' },
] as const;

const COMMON_CORE = [
  'Applicant Name',
  'DOB/Entity Date',
  'Address',
  'Jurisdiction',
  'Application ID',
  'Issue Date',
  'Issuing Authority',
  'Digital Signature',
  'QR/Verification URI',
  'Status',
] as const;

const applicantCategory = (extra: string[] = []) => ({
  type: 'Category' as const,
  label: 'Applicant',
  options: { hint: 'Identity details' },
  elements: [
    {
      type: 'Group' as const,
      label: 'Identity',
      elements: [
        control('applicant_name'),
        ...extra.map((p) => control(p)),
        control('applicant_dob'),
        control('applicant_mobile'),
        control('applicant_gender', { options: { format: 'radio' as const } }),
      ],
    },
  ],
});

const addressGroup = (pointer: string, label: string) => ({
  type: 'Group' as const,
  label,
  elements: ADDRESS_PARTS.map((p) => control(`${pointer}/${p}`)),
});

const reviewCategory = () => ({
  type: 'Category' as const,
  label: 'Preview',
  options: { title: 'Preview application', hint: 'Review & declare', review: true },
  elements: [control('declaration_accepted')],
});

const incomeForm = (): FormPackage => ({
  form_id: 'ind-soc-031.application',
  json_schema: {
    type: 'object',
    title: 'Income Certificate (individual) application',
    additionalProperties: false,
    required: [
      'applicant_name',
      'applicant_dob',
      'applicant_gender',
      'residential_address',
      'annual_income_rupees',
      'assessment_period',
      'purpose_of_certificate',
      'declaration_accepted',
    ],
    properties: {
      applicant_name: fullName(),
      applicant_dob: dateOfBirth(),
      applicant_gender: gender(),
      applicant_mobile: mobile(),
      residential_address: lgdPostalAddress('Residential address'),
      family_household_id: {
        type: 'string',
        title: 'Family / household ID',
        maxLength: 40,
        semanticElementId: 'SF-SEM-FAMILY-HOUSEHOLD-ID',
        'x-ux4g': { hint: 'If the state issues one · optional' },
      },
      annual_income_rupees: {
        type: 'integer',
        title: 'Annual income (₹)',
        minimum: 0,
        semanticElementId: 'SF-SEM-ANNUAL-INCOME',
        'x-ux4g': { inputMode: 'numeric' },
      },
      assessment_period: {
        type: 'string',
        title: 'Assessment period (financial year, e.g. 2025-26)',
        pattern: '^[0-9]{4}-[0-9]{2}$',
        semanticElementId: 'SF-SEM-ASSESSMENT-PERIOD',
        'x-ux4g': { error_messages: { PATTERN: 'Use the form YYYY-YY, for example 2025-26' } },
      },
      purpose_of_certificate: purpose(),
      declaration_accepted: declaration(STUB_DECLARATION),
    },
  },
  ui_schema: {
    type: 'Categorization',
    elements: [
      applicantCategory(),
      {
        type: 'Category',
        label: 'Income',
        options: { hint: 'Address & assessed income' },
        elements: [
          addressGroup('residential_address', 'Residential address'),
          {
            type: 'Group',
            label: 'Income claim',
            elements: [
              control('family_household_id'),
              control('annual_income_rupees'),
              control('assessment_period'),
              control('purpose_of_certificate', { options: { format: 'textarea' } }),
            ],
          },
        ],
      },
      reviewCategory(),
    ],
  },
});

const domicileForm = (): FormPackage => ({
  form_id: 'ind-soc-001.application',
  json_schema: {
    type: 'object',
    title: 'Domicile Certificate application',
    additionalProperties: false,
    required: [
      'applicant_name',
      'applicant_dob',
      'applicant_gender',
      'guardian_name',
      'permanent_address',
      'purpose_of_certificate',
      'declaration_accepted',
    ],
    properties: {
      applicant_name: fullName(),
      guardian_name: personName(
        "Father's / mother's / guardian's name",
        'SF-SEM-PERSON-GUARDIAN-NAME',
      ),
      applicant_dob: dateOfBirth(),
      applicant_gender: gender(),
      applicant_mobile: mobile(),
      permanent_address: lgdPostalAddress('Permanent address'),
      purpose_of_certificate: purpose(),
      declaration_accepted: declaration(STUB_DECLARATION),
    },
  },
  ui_schema: {
    type: 'Categorization',
    elements: [
      applicantCategory(['guardian_name']),
      {
        type: 'Category',
        label: 'Domicile',
        options: { hint: 'Permanent address & purpose' },
        elements: [
          addressGroup('permanent_address', 'Permanent address'),
          {
            type: 'Group',
            label: 'Purpose',
            elements: [control('purpose_of_certificate', { options: { format: 'textarea' } })],
          },
        ],
      },
      reviewCategory(),
    ],
  },
});

const PLACE_OF_BIRTH_LABELS: Record<string, string> = {
  INSTITUTION: 'Hospital / institution',
  HOUSE: 'House',
  OTHER: 'Other place',
};

const birthForm = (): FormPackage => ({
  form_id: 'ind-civ-001.registration',
  json_schema: {
    type: 'object',
    title: 'Birth registration and birth certificate',
    additionalProperties: false,
    required: [
      'child_sex',
      'event_date',
      'event_place_type',
      'event_place',
      'mother_name',
      'informant_name',
      'address_at_birth',
      'declaration_accepted',
    ],
    properties: {
      child_name: {
        ...personName('Name of the child', 'SF-SEM-PERSON-FULL-NAME'),
        minLength: 0,
        'x-ux4g': { hint: 'May be added later where the rules allow · optional' },
      },
      child_sex: {
        type: 'string',
        title: 'Sex of the child',
        enum: GENDER_ENUM.filter((g) => g !== 'PREFER_NOT_TO_SAY'),
        semanticElementId: 'SF-SEM-PERSON-GENDER',
        'x-ux4g': { enum_labels: GENDER_LABELS, span: 2 },
      },
      event_date: {
        type: 'string',
        format: 'date',
        title: 'Date of birth (event date)',
        semanticElementId: 'SF-SEM-EVENT-DATE',
      },
      event_place_type: {
        type: 'string',
        title: 'Place of birth',
        enum: Object.keys(PLACE_OF_BIRTH_LABELS),
        semanticElementId: 'SF-SEM-EVENT-PLACE-TYPE',
        'x-ux4g': { enum_labels: PLACE_OF_BIRTH_LABELS },
      },
      event_place: {
        type: 'string',
        title: 'Name / address of the place of birth',
        minLength: 1,
        maxLength: 200,
        semanticElementId: 'SF-SEM-EVENT-PLACE',
      },
      mother_name: personName("Mother's name", 'SF-SEM-PERSON-MOTHER-NAME'),
      father_name: personName("Father's name", 'SF-SEM-PERSON-FATHER-NAME'),
      informant_name: personName('Name of the informant', 'SF-SEM-INFORMANT-NAME'),
      informant_mobile: mobile(),
      address_at_birth: lgdPostalAddress('Address of parents at the time of birth'),
      declaration_accepted: declaration(STUB_DECLARATION),
    },
  },
  ui_schema: {
    type: 'Categorization',
    elements: [
      {
        type: 'Category',
        label: 'Event',
        options: { hint: 'Child & birth details' },
        elements: [
          {
            type: 'Group',
            label: 'Child',
            elements: [
              control('child_name'),
              control('child_sex', { options: { format: 'radio' } }),
            ],
          },
          {
            type: 'Group',
            label: 'Birth event',
            elements: [control('event_date'), control('event_place_type'), control('event_place')],
          },
        ],
      },
      {
        type: 'Category',
        label: 'Parents',
        options: { hint: 'Parents & informant' },
        elements: [
          {
            type: 'Group',
            label: 'Parents and informant',
            elements: [
              control('mother_name'),
              control('father_name'),
              control('informant_name'),
              control('informant_mobile'),
            ],
          },
          addressGroup('address_at_birth', 'Address at the time of birth'),
        ],
      },
      reviewCategory(),
    ],
  },
});

export const INCOME_CERTIFICATE: CertificateTemplate = {
  template_id: 'ind-soc-031.income-certificate',
  catalogue_id: 'IND-SOC-031',
  name: 'Income Certificate (individual)',
  summary: 'Certifies the assessed income of an individual for a stated period and purpose.',
  category: 'Residence, Community & Socioeconomic Status',
  output_type: 'Certificate',
  definition: 'Certifies assessed income of an individual for the defined period and purpose.',
  issuing_authority_class:
    'Revenue Department / District Administration / Competent Caste Authority',
  lifecycle_class: 'Time-bound / renewable / purpose-specific',
  credential_form: 'Digitally signed PDF + QR; VC/JSON-LD where appropriate',
  digilocker_suitability: 'High',
  core_fields: [...COMMON_CORE, 'Family/Household ID', 'Annual Income', 'Assessment Period'],
  maturity: 'SAMPLE_LAB_STUB',
  /** Studio/config shell — SAMPLE_LAB DUMMY defaults; apply still needs PUBLISHED TSB placement. */
  authoring_path: 'templates/income-certificate/',
  policy: SAMPLE_LAB_DUMMY_POLICY_FACTS,
  indicative_checks: [],
  credential_fields: [
    {
      field_id: 'CERT_HOLDER_NAME',
      label: 'Name of certificate holder',
      source: '/applicant_name',
    },
    { field_id: 'CERT_ANNUAL_INCOME', label: 'Annual income', source: '/annual_income_rupees' },
    {
      field_id: 'CERT_ASSESSMENT_PERIOD',
      label: 'Assessment period',
      source: '/assessment_period',
    },
    ...ISSUER_FIELDS,
  ],
  versions: [
    {
      version: '0.1.0',
      version_id: '7e3a0031-0001-4000-8000-00000000031a',
      status: 'DRAFT',
      published_at: null,
      content_hash: 'sha256:cf79c84eb131a7241f67a9181c05df4030879466e3151589f7f6e622523642be',
      change_summary:
        'SAMPLE_LAB stub from registry core fields; SAMPLE_LAB DUMMY policy defaults (tenant-overridable).',
      form: incomeForm(),
    },
  ],
};

export const DOMICILE_CERTIFICATE: CertificateTemplate = {
  template_id: 'ind-soc-001.domicile-certificate',
  catalogue_id: 'IND-SOC-001',
  name: 'Domicile Certificate',
  summary: 'Certifies domicile or permanent legal connection with a State/UT.',
  category: 'Residence, Community & Socioeconomic Status',
  output_type: 'Certificate',
  definition:
    'Certifies domicile or permanent legal connection with a State/UT as defined by the applicable jurisdictional rules.',
  issuing_authority_class:
    'Revenue Department / District Administration / Competent Caste Authority',
  lifecycle_class: 'Long-lived / event-based',
  credential_form: 'Digitally signed PDF + QR; VC/JSON-LD where appropriate',
  digilocker_suitability: 'High',
  core_fields: COMMON_CORE,
  maturity: 'SAMPLE_LAB_STUB',
  authoring_path: 'templates/certificate-packs/ind-soc-001/',
  policy: SAMPLE_LAB_DUMMY_POLICY_FACTS,
  indicative_checks: [],
  credential_fields: [
    {
      field_id: 'CERT_HOLDER_NAME',
      label: 'Name of certificate holder',
      source: '/applicant_name',
    },
    {
      field_id: 'CERT_GUARDIAN',
      label: "Father's / mother's / guardian's name",
      source: '/guardian_name',
    },
    { field_id: 'CERT_ADDRESS', label: 'Permanent address', source: '/permanent_address' },
    ...ISSUER_FIELDS,
  ],
  versions: [
    {
      version: '0.1.0',
      version_id: '7e3a0001-0001-4000-8000-00000000001a',
      status: 'DRAFT',
      published_at: null,
      content_hash: 'sha256:55a4db0e216c91afe9d0bffdd620f3ff67c242e8b297ccdb87f719cc7d97e020',
      change_summary:
        'SAMPLE_LAB stub from registry core fields; SAMPLE_LAB DUMMY policy defaults (tenant-overridable).',
      form: domicileForm(),
    },
  ],
};

export const BIRTH_CERTIFICATE: CertificateTemplate = {
  template_id: 'ind-civ-001.birth-certificate',
  catalogue_id: 'IND-CIV-001',
  name: 'Birth Registration and Birth Certificate',
  summary: 'Registers a birth and issues the official birth certificate.',
  category: 'Civil Registration & Personal Identity',
  output_type: 'Registration',
  definition:
    'Registers a birth in the civil registration system and issues the official birth certificate containing the legally recorded event details.',
  issuing_authority_class: 'Registrar of Births & Deaths / Marriage Registrar / Revenue Authority',
  lifecycle_class: 'Long-lived / event-based',
  credential_form: 'Digitally signed PDF + QR; VC/JSON-LD where appropriate',
  digilocker_suitability: 'Medium',
  core_fields: [...COMMON_CORE, 'Event Date', 'Event Place', 'Registration Number'],
  maturity: 'SAMPLE_LAB_STUB',
  authoring_path: 'templates/certificate-packs/ind-civ-001/',
  policy: SAMPLE_LAB_DUMMY_POLICY_FACTS,
  indicative_checks: [],
  credential_fields: [
    { field_id: 'CERT_CHILD_NAME', label: 'Name of the child', source: '/child_name' },
    { field_id: 'CERT_SEX', label: 'Sex', source: '/child_sex' },
    { field_id: 'CERT_EVENT_DATE', label: 'Date of birth', source: '/event_date' },
    { field_id: 'CERT_EVENT_PLACE', label: 'Place of birth', source: '/event_place' },
    { field_id: 'CERT_MOTHER', label: "Mother's name", source: '/mother_name' },
    { field_id: 'CERT_FATHER', label: "Father's name", source: '/father_name' },
    { field_id: 'CERT_REGISTRATION_NUMBER', label: 'Registration number', source: 'ISSUER' },
    ...ISSUER_FIELDS,
  ],
  versions: [
    {
      version: '0.1.0',
      version_id: '7e3ac001-0001-4000-8000-0000000c001a',
      status: 'DRAFT',
      published_at: null,
      content_hash: 'sha256:3b955ea295679338d01e1829ec1d74829deaa008a5ca164d77f6d8893fde1fe7',
      change_summary:
        'SAMPLE_LAB stub from registry core fields; SAMPLE_LAB DUMMY policy defaults (tenant-overridable).',
      form: birthForm(),
    },
  ],
};
