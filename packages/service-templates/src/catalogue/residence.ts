import {
  aadhaarLast4,
  ADDRESS_PARTS,
  control,
  dateOfBirth,
  declaration,
  fullName,
  gender,
  mobile,
  personName,
  postalAddress,
  purpose,
  showWhen,
} from '../fields';
import type { CertificateTemplate, FormPackage, FormSchemaNode } from '../types';

/** Accepted evidence types from the public e-District sample (fixtures/golden/ind-soc-002). */
const EVIDENCE_LABELS: Record<string, string> = {
  ELECTRICITY_BILL: 'Electricity bill',
  ROR_COPY: 'Copy of RoR',
  EPIC_OR_AADHAAR: 'EPIC / Aadhaar card',
  LANDLINE_TELEPHONE_BILL: 'Landline telephone bill',
  WATER_CONNECTION_BILL: 'Water connection bill',
  RATION_CARD: 'Ration card',
  HOLDING_TAX_RECEIPT: 'Holding tax receipt',
  LEASE_AGREEMENT: 'Lease agreement with house owner',
  EMPLOYER_CERTIFICATE: 'Certificate from the employer',
  BANK_PASSBOOK_FIRST_PAGE: 'First page of bank passbook',
  VOTER_LIST_EXTRACT: 'Extract of latest voter list',
};

const properties = (): Record<string, FormSchemaNode> => ({
  applicant_name: fullName(),
  applicant_dob: dateOfBirth(),
  applicant_gender: gender(),
  applicant_mobile: mobile(),
  applicant_aadhaar_last4: aadhaarLast4(),
  notify_by_email: {
    type: 'boolean',
    title: 'Also send status updates by email',
    'x-ux4g': { span: 2 },
  },
  applicant_email: {
    type: 'string',
    title: 'Email address',
    format: 'email',
    maxLength: 254,
    semanticElementId: 'SF-SEM-PERSON-EMAIL',
    'x-ux4g': {
      inputMode: 'email',
      autocomplete: 'email',
      error_messages: { REQUIRED: 'Enter an email address', FORMAT_EMAIL: 'Enter a valid email' },
    },
  },
  residence_address: postalAddress('Residence address'),
  residence_duration_months: {
    type: 'integer',
    title: 'Duration of residence at this address (months)',
    minimum: 0,
    maximum: 1200,
    semanticElementId: 'SF-SEM-RESIDENCE-DURATION-MONTHS',
    'x-ux4g': {
      inputMode: 'numeric',
      error_messages: { TYPE_NUMBER: 'Enter the months as a whole number' },
    },
  },
  purpose_of_certificate: purpose(),
  evidence_type: {
    type: 'string',
    title: 'Evidence type',
    enum: Object.keys(EVIDENCE_LABELS),
    semanticElementId: 'SF-SEM-EVIDENCE-TYPE',
    'x-ux4g': { enum_labels: EVIDENCE_LABELS, span: 2 },
  },
  evidence_file_name: {
    type: 'string',
    title: 'File name',
    minLength: 1,
    maxLength: 120,
    'x-ux4g': {
      hint: 'SAMPLE_LAB records a synthetic file reference only',
      error_messages: { REQUIRED: 'Attach a SAMPLE_LAB evidence file name' },
    },
  },
  evidence_mime: {
    type: 'string',
    title: 'MIME type',
    enum: ['application/pdf', 'image/jpeg', 'image/png'],
  },
  declaration_accepted: declaration(
    'I declare that the particulars above are true for this SAMPLE_LAB application and that no real personal data has been entered.',
  ),
});

const REQUIRED = [
  'applicant_name',
  'applicant_dob',
  'applicant_gender',
  'residence_address',
  'residence_duration_months',
  'purpose_of_certificate',
  'evidence_type',
  'evidence_file_name',
  'declaration_accepted',
] as const;

function residenceForm(extra: { guardian?: boolean } = {}): FormPackage {
  const props = properties();
  if (extra.guardian) {
    props['guardian_name'] = personName(
      "Father's / mother's / guardian's name",
      'SF-SEM-PERSON-GUARDIAN-NAME',
    );
  }
  return {
    form_id: 'ind-soc-002.application',
    json_schema: {
      type: 'object',
      title: 'Residence Certificate application',
      additionalProperties: false,
      required: REQUIRED,
      properties: props,
      if: { properties: { notify_by_email: { const: true } } },
      then: { required: ['applicant_email'] },
    },
    ui_schema: {
      type: 'Categorization',
      elements: [
        {
          type: 'Category',
          label: 'Applicant',
          options: { title: 'Applicant details', hint: 'Identity details' },
          elements: [
            {
              type: 'Group',
              label: 'Identity',
              elements: [
                control('applicant_name'),
                ...(extra.guardian ? [control('guardian_name')] : []),
                control('applicant_dob'),
                control('applicant_mobile'),
                control('applicant_gender', { options: { format: 'radio' } }),
                control('applicant_aadhaar_last4'),
              ],
            },
            {
              type: 'Group',
              label: 'Status updates',
              elements: [
                control('notify_by_email'),
                control('applicant_email', { rule: showWhen('notify_by_email', true) }),
              ],
            },
          ],
        },
        {
          type: 'Category',
          label: 'Residence',
          options: { title: 'Residence address', hint: 'Address & duration' },
          elements: [
            {
              type: 'Group',
              label: 'Postal address',
              elements: ADDRESS_PARTS.map((p) => control(`residence_address/${p}`)),
            },
            {
              type: 'Group',
              label: 'Residence claim',
              elements: [
                control('residence_duration_months'),
                control('purpose_of_certificate', { options: { format: 'textarea' } }),
              ],
            },
          ],
        },
        {
          type: 'Category',
          label: 'Evidence',
          options: { title: 'Supporting evidence', hint: 'Supporting document' },
          elements: [
            {
              type: 'Group',
              label: 'Supporting document',
              elements: [
                control('evidence_type'),
                control('evidence_file_name'),
                control('evidence_mime'),
              ],
            },
          ],
        },
        {
          type: 'Category',
          label: 'Preview',
          options: { title: 'Preview application', hint: 'Review & submit', review: true },
          elements: [control('declaration_accepted')],
        },
      ],
    },
  };
}

export const RESIDENCE_CERTIFICATE: CertificateTemplate = {
  template_id: 'ind-soc-002.residence-certificate',
  catalogue_id: 'IND-SOC-002',
  name: 'Residence Certificate',
  summary:
    'Certifies that you live at your current address. Issued after verification by an officer.',
  category: 'Residence, Community & Socioeconomic Status',
  output_type: 'Certificate',
  definition:
    'Certifies that the applicant resides at or within the stated jurisdiction for the purpose defined by the issuing authority.',
  issuing_authority_class:
    'Revenue Department / District Administration / Competent Caste Authority',
  lifecycle_class: 'Rule-dependent',
  credential_form: 'Digitally signed PDF + QR; VC/JSON-LD where appropriate',
  digilocker_suitability: 'High',
  core_fields: [
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
  ],
  maturity: 'SAMPLE_LAB_PUBLISHED',
  authoring_path: 'templates/residence-certificate/',
  policy: {
    fee: '₹0',
    service_time: '10 working days',
    eligibility: '12+ months at your address',
    evidence: 'One document from the published sample list',
    source: 'Public e-District sample (fixtures/golden/ind-soc-002/SOURCE_PROVENANCE.md)',
  },
  indicative_checks: [
    {
      pointer: '/residence_duration_months',
      minimum: 12,
      label: 'Residence of 12 months or more (public sample policy)',
    },
  ],
  credential_fields: [
    {
      field_id: 'CERT_HOLDER_NAME',
      label: 'Name of certificate holder',
      source: '/applicant_name',
    },
    { field_id: 'CERT_DOB', label: 'Date of birth', source: '/applicant_dob' },
    { field_id: 'CERT_GENDER', label: 'Gender', source: '/applicant_gender' },
    { field_id: 'CERT_ADDRESS', label: 'Residence address', source: '/residence_address' },
    { field_id: 'CERT_PURPOSE', label: 'Purpose', source: '/purpose_of_certificate' },
    { field_id: 'CERT_ISSUE_DATE', label: 'Issue date', source: 'ISSUER' },
    { field_id: 'CERT_QR', label: 'QR / verification URI', source: 'ISSUER' },
  ],
  versions: [
    {
      version: '1.0.0',
      version_id: '0d15ba00-0010-4000-8000-0d15ba000010',
      status: 'PUBLISHED',
      published_at: '2026-11-05T00:00:00.000Z',
      content_hash: 'sha256:6b659df18272546c28799bd1b0b7bf6d2a5b372864418ed82981ecee6de02562',
      change_summary:
        'SAMPLE_LAB published form: applicant, residence, evidence and declaration; optional email updates.',
      form: residenceForm(),
      sample_data: {
        applicant_name: 'SAMPLE Lab Citizen',
        applicant_dob: '1990-01-15',
        applicant_gender: 'PREFER_NOT_TO_SAY',
        applicant_aadhaar_last4: '4321',
        notify_by_email: false,
        residence_address: {
          house_no_or_name: 'SAMPLE Plot 1',
          locality: 'SAMPLE Locality',
          post_office: 'SAMPLE Post Office',
          district: 'SAMPLE District',
          state_code: 'OD',
          pincode: '751001',
        },
        residence_duration_months: 18,
        purpose_of_certificate: 'SAMPLE_LAB purpose — education admission (synthetic only)',
        evidence_type: 'ELECTRICITY_BILL',
        evidence_file_name: 'sample-electricity-bill.pdf',
        evidence_mime: 'application/pdf',
      },
    },
    {
      version: '1.1.0',
      version_id: '0d15ba00-0019-4000-8000-0d15ba000019',
      status: 'DRAFT',
      published_at: null,
      content_hash: 'sha256:c9a9915db1e5ceb5784069cce533d6889b8699c843eac1ce6e191e5b7f5e5006',
      change_summary: "Adds optional father's / mother's / guardian's name (maker draft).",
      form: residenceForm({ guardian: true }),
    },
  ],
};
