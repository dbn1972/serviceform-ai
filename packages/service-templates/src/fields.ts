import type { FormSchemaNode, UiControl, UiRule } from './types';

/**
 * Reusable field shapes bound to canonical semantic element ids (Constitution §38).
 * Editing a shape changes every template version that uses it; the catalogue test fails if a
 * PUBLISHED version's content hash moves, so published forms cannot drift silently.
 */

export const GENDER_ENUM = ['MALE', 'FEMALE', 'TRANSGENDER', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;

export const GENDER_LABELS: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  TRANSGENDER: 'Transgender',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

export const fullName = (title = 'Full name (as per official record)'): FormSchemaNode => ({
  type: 'string',
  title,
  minLength: 1,
  maxLength: 80,
  semanticElementId: 'SF-SEM-PERSON-FULL-NAME',
  'x-ux4g': { autocomplete: 'name', span: 2, error_messages: { REQUIRED: 'Enter the full name' } },
});

export const personName = (title: string, semanticElementId: string): FormSchemaNode => ({
  type: 'string',
  title,
  minLength: 1,
  maxLength: 80,
  semanticElementId,
});

export const dateOfBirth = (): FormSchemaNode => ({
  type: 'string',
  format: 'date',
  title: 'Date of birth',
  semanticElementId: 'SF-SEM-PERSON-DOB',
  'x-ux4g': { autocomplete: 'bday', error_messages: { REQUIRED: 'Enter the date of birth' } },
});

export const gender = (): FormSchemaNode => ({
  type: 'string',
  title: 'Gender',
  enum: GENDER_ENUM,
  semanticElementId: 'SF-SEM-PERSON-GENDER',
  'x-ux4g': { enum_labels: GENDER_LABELS, span: 2 },
});

export const mobile = (): FormSchemaNode => ({
  type: 'string',
  title: 'Mobile number',
  pattern: '^[0-9]{10}$',
  semanticElementId: 'SF-SEM-PERSON-MOBILE',
  'x-ux4g': {
    inputMode: 'numeric',
    autocomplete: 'tel-national',
    hint: '10 digits · synthetic only',
    error_messages: { PATTERN: 'Mobile must be 10 digits' },
  },
});

export const aadhaarLast4 = (): FormSchemaNode => ({
  type: 'string',
  title: 'Last 4 digits of Aadhaar (verification only)',
  pattern: '^[0-9]{4}$',
  semanticElementId: 'SF-SEM-PERSON-AADHAAR-LAST4',
  'x-ux4g': {
    inputMode: 'numeric',
    hint: 'Masked · not full Aadhaar · SAMPLE_LAB',
    error_messages: { PATTERN: 'Enter the last 4 digits only' },
  },
});

export const STATE_CODE_LABELS: Record<string, string> = { OD: 'OD', XX: 'XX (other sample)' };

export const postalAddress = (title: string): FormSchemaNode => ({
  type: 'object',
  title,
  additionalProperties: false,
  required: ['house_no_or_name', 'locality', 'district', 'state_code', 'pincode'],
  properties: {
    house_no_or_name: {
      type: 'string',
      title: 'House no / name',
      minLength: 1,
      maxLength: 100,
      semanticElementId: 'SF-SEM-ADDR-HOUSE',
    },
    locality: {
      type: 'string',
      title: 'Locality / village / ward',
      minLength: 1,
      maxLength: 150,
      semanticElementId: 'SF-SEM-ADDR-LOCALITY',
    },
    post_office: {
      type: 'string',
      title: 'Post office',
      maxLength: 100,
      semanticElementId: 'SF-SEM-ADDR-POST-OFFICE',
    },
    district: {
      type: 'string',
      title: 'District',
      minLength: 1,
      maxLength: 80,
      semanticElementId: 'SF-SEM-ADDR-DISTRICT',
    },
    state_code: {
      type: 'string',
      title: 'State code',
      enum: ['OD', 'XX'],
      semanticElementId: 'SF-SEM-ADDR-STATE-CODE',
      'x-ux4g': { enum_labels: STATE_CODE_LABELS },
    },
    pincode: {
      type: 'string',
      title: 'PIN code',
      pattern: '^[0-9]{6}$',
      semanticElementId: 'SF-SEM-ADDR-PINCODE',
      'x-ux4g': {
        inputMode: 'numeric',
        autocomplete: 'postal-code',
        error_messages: { PATTERN: 'PIN code must be 6 digits' },
      },
    },
  },
});

export const ADDRESS_PARTS = [
  'house_no_or_name',
  'locality',
  'post_office',
  'district',
  'state_code',
  'pincode',
] as const;

export const purpose = (): FormSchemaNode => ({
  type: 'string',
  title: 'Purpose for which certificate is required',
  minLength: 1,
  maxLength: 500,
  semanticElementId: 'SF-SEM-PURPOSE-OF-CERT',
  'x-ux4g': { span: 2 },
});

export const declaration = (text: string): FormSchemaNode => ({
  type: 'boolean',
  title: text,
  const: true,
  semanticElementId: 'SF-SEM-APPLICANT-DECLARATION',
  'x-ux4g': {
    span: 2,
    error_messages: {
      REQUIRED: 'Confirm the declaration before submit',
      CONST_MISMATCH: 'Confirm the declaration before submit',
    },
  },
});

export const control = (
  pointer: string,
  extra: Omit<UiControl, 'type' | 'scope'> = {},
): UiControl => ({
  type: 'Control',
  scope: `#/properties/${pointer.split('/').join('/properties/')}`,
  ...extra,
});

export const showWhen = (pointer: string, value: string | number | boolean): UiRule => ({
  effect: 'SHOW',
  condition: {
    scope: `#/properties/${pointer.split('/').join('/properties/')}`,
    schema: { const: value },
  },
});
