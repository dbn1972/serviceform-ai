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
  postalAddress,
  purpose,
} from '../fields';
import type { CertificateTemplate, FormPackage, PolicyFacts } from '../types';

/**
 * SAMPLE_LAB stubs grounded in docs/catalogue/India_Gov_Normalized_Service_Registry.json (v1.0).
 * Form fields follow each entry's "Recommended Core Fields" only. Fee, service time, eligibility
 * and evidence are POLICY_INPUT_REQUIRED from the statutory owner: nothing is invented here.
 * Stubs are DRAFT, not offered by any lab tenant, and cannot be applied for.
 */

const POLICY_INPUT_REQUIRED: PolicyFacts = {
  fee: 'POLICY_INPUT_REQUIRED',
  service_time: 'POLICY_INPUT_REQUIRED',
  eligibility: 'POLICY_INPUT_REQUIRED',
  evidence: 'POLICY_INPUT_REQUIRED',
  source: 'docs/catalogue (normalized registry v1.0) — statutory owner input pending',
};

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
      residential_address: postalAddress('Residential address'),
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
      permanent_address: postalAddress('Permanent address'),
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
      address_at_birth: postalAddress('Address of parents at the time of birth'),
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
  authoring_path: null,
  policy: POLICY_INPUT_REQUIRED,
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
      content_hash: 'sha256:39a81f7763e09f3a006112656bfc84d846372e8500f3510e7b3d3da8b53b52d3',
      change_summary: 'SAMPLE_LAB stub from registry core fields; policy inputs pending.',
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
  authoring_path: null,
  policy: POLICY_INPUT_REQUIRED,
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
      content_hash: 'sha256:b12d8e1e085ff314d22f0228d5f5850307ecb4ad06ff58dcb441f06d006caa01',
      change_summary: 'SAMPLE_LAB stub from registry core fields; policy inputs pending.',
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
  authoring_path: null,
  policy: POLICY_INPUT_REQUIRED,
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
      content_hash: 'sha256:6da761ffc76ffa2e50c1f36ebac67a55f56c6564c43e8bcf5f3ad6a5e95567b6',
      change_summary: 'SAMPLE_LAB stub from registry core fields; policy inputs pending.',
      form: birthForm(),
    },
  ],
};
