import {
  aadhaarLast4,
  dateOfBirth,
  declaration,
  fullName,
  gender,
  mobile,
  postalAddress,
  purpose,
} from '@serviceform/service-templates/fields';
import type { FormSchemaNode } from '@serviceform/service-templates';
import { fieldFromSchema } from './import';
import type { FieldKind } from './model';
import type { FieldTemplate, SectionTemplate } from './ops';

export type PaletteGroup = 'basic' | 'choice' | 'semantic';

export interface FieldPaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  description: string;
  kind: FieldKind;
  create(): FieldTemplate;
}

export interface SectionPaletteItem {
  id: string;
  label: string;
  description: string;
  create(): SectionTemplate;
}

function basic(
  id: string,
  kind: FieldKind,
  label: string,
  description: string,
  extra: Partial<FieldTemplate> = {},
): FieldPaletteItem {
  return {
    id,
    group:
      kind === 'select' || kind === 'radio' || kind === 'checkbox' || kind === 'declaration'
        ? 'choice'
        : 'basic',
    label,
    description,
    kind,
    create: () => ({ key: id, kind, label, required: false, ...extra }),
  };
}

function preset(
  id: string,
  key: string,
  label: string,
  description: string,
  make: () => FormSchemaNode,
  format?: 'radio' | 'textarea',
  required = true,
): FieldPaletteItem {
  return {
    id,
    group: 'semantic',
    label,
    description,
    kind: fieldFromSchema(key, make(), { ...(format ? { format } : {}), required }).kind,
    create: () => {
      const { id: _id, ...template } = fieldFromSchema(key, make(), {
        ...(format ? { format } : {}),
        required,
      });
      return template;
    },
  };
}

const TWO_OPTIONS = [
  { value: 'OPTION_1', label: 'Option 1' },
  { value: 'OPTION_2', label: 'Option 2' },
];

/** Generic inputs plus the catalogue's reusable semantic field shapes (Constitution §38). */
export const FIELD_PALETTE: readonly FieldPaletteItem[] = [
  basic('short_text', 'text', 'Short text', 'One line of text, such as a name or reference.', {
    maxLength: 100,
  }),
  basic('long_text', 'textarea', 'Long text', 'Several lines, such as a reason or description.', {
    maxLength: 500,
    wide: true,
  }),
  basic('whole_number', 'integer', 'Whole number', 'Counts such as months, members or age.', {
    minimum: 0,
    inputMode: 'numeric',
  }),
  basic('decimal_number', 'number', 'Decimal number', 'Amounts or measurements with decimals.'),
  basic('date', 'date', 'Date', 'A calendar date (YYYY-MM-DD).'),
  basic('email', 'email', 'Email', 'An email address, checked for a valid shape.', {
    maxLength: 254,
    inputMode: 'email',
    autocomplete: 'email',
  }),
  basic('dropdown', 'select', 'Dropdown', 'Pick one option from a list.', {
    options: TWO_OPTIONS,
  }),
  basic('radio', 'radio', 'Radio buttons', 'Pick one of a few visible options.', {
    options: TWO_OPTIONS,
    wide: true,
  }),
  basic('yes_no', 'checkbox', 'Yes / no checkbox', 'A single tick box the applicant may tick.'),
  basic('declaration', 'declaration', 'Declaration', 'A statement the applicant must confirm.', {
    label: 'I declare that the particulars above are true.',
    required: true,
    wide: true,
  }),
  preset('sem_full_name', 'applicant_name', 'Full name', 'SF-SEM-PERSON-FULL-NAME', () =>
    fullName(),
  ),
  preset('sem_dob', 'applicant_dob', 'Date of birth', 'SF-SEM-PERSON-DOB', () => dateOfBirth()),
  preset(
    'sem_gender',
    'applicant_gender',
    'Gender',
    'SF-SEM-PERSON-GENDER',
    () => gender(),
    'radio',
  ),
  preset(
    'sem_mobile',
    'applicant_mobile',
    'Mobile number',
    'SF-SEM-PERSON-MOBILE',
    () => mobile(),
    undefined,
    false,
  ),
  preset(
    'sem_aadhaar_last4',
    'applicant_aadhaar_last4',
    'Aadhaar last 4 digits',
    'SF-SEM-PERSON-AADHAAR-LAST4 · masked',
    () => aadhaarLast4(),
    undefined,
    false,
  ),
  preset(
    'sem_purpose',
    'purpose_of_certificate',
    'Purpose of certificate',
    'SF-SEM-PURPOSE-OF-CERT',
    () => purpose(),
    'textarea',
  ),
  preset(
    'sem_declaration',
    'declaration_accepted',
    'Applicant declaration',
    'SF-SEM-APPLICANT-DECLARATION',
    () => declaration('I declare that the particulars above are true and complete.'),
  ),
];

/** Section presets that bind a nested JSON Schema object. */
export const SECTION_PALETTE: readonly SectionPaletteItem[] = [
  {
    id: 'blank_section',
    label: 'Blank section',
    description: 'A titled group of fields on the current step.',
    create: () => ({ label: 'New section', fields: [] }),
  },
  {
    id: 'postal_address',
    label: 'Postal address',
    description: 'Six address parts stored as one object (SF-SEM-ADDR-*).',
    create: () => {
      const node = postalAddress('Postal address');
      const required = new Set(node.required ?? []);
      return {
        label: 'Postal address',
        object: { key: 'postal_address', title: node.title ?? 'Postal address' },
        fields: Object.entries(node.properties ?? {}).map(([key, child]) => {
          const { id: _id, ...template } = fieldFromSchema(key, child, {
            required: required.has(key),
          });
          return template;
        }),
      };
    },
  },
];
