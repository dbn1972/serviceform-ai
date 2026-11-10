/**
 * Studio forms designer model. It is an authoring view only: the executable artefact is the
 * CMP-009 FORM package produced by `compileForm`, pinned by its canonical content hash.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'integer'
  | 'number'
  | 'date'
  | 'email'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'declaration';

export const FIELD_KINDS: readonly FieldKind[] = [
  'text',
  'textarea',
  'integer',
  'number',
  'date',
  'email',
  'select',
  'radio',
  'checkbox',
  'declaration',
];

export type Scalar = string | number | boolean;

export type InputMode = 'numeric' | 'email' | 'tel' | 'text';

export interface ChoiceOption {
  value: string;
  label: string;
}

/** UI-schema rule: SHOW or HIDE a control/section while another field holds a value. */
export interface VisibilityRule {
  effect: 'SHOW' | 'HIDE';
  /** Root-relative field path: `notify_by_email` or `residence_address/state_code`. */
  field: string;
  /** Exactly one of `equals` (JSON Schema `const`) or `oneOf` (`enum`). */
  equals?: Scalar;
  oneOf?: string[];
}

/** Root `if/then` requirement. CMP-009 evaluates one root condition, so all must share it. */
export interface RequiredWhen {
  field: string;
  equals: Scalar;
}

export interface DesignerField {
  /** Editor identity; never emitted. */
  id: string;
  /** JSON Schema property name. */
  key: string;
  kind: FieldKind;
  label: string;
  description?: string;
  required: boolean;
  requiredWhen?: RequiredWhen;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  options?: ChoiceOption[];
  /** Emit `enum_labels` even when every label equals its value. */
  keepOptionLabels?: boolean;
  /** Imported `enum_labels` for values that are not offered; kept verbatim. */
  extraOptionLabels?: Record<string, string>;
  /** Full row in the two-column UX4G form grid (`x-ux4g.span = 2`). */
  wide?: boolean;
  inputMode?: InputMode;
  autocomplete?: string;
  /** Citizen copy keyed by CMP-009 issue code. */
  errorMessages?: Record<string, string>;
  /** Canonical semantic element (Constitution §38). Bound by presets, never invented. */
  semanticElementId?: string;
  visibleWhen?: VisibilityRule;
}

/** A nested JSON Schema object (for example a postal address) rendered as one section. */
export interface SectionObject {
  key: string;
  title: string;
  semanticElementId?: string;
  /** Declared order of the object's `required` names; see `DesignerForm.requiredOrder`. */
  requiredOrder?: string[];
}

export interface DesignerSection {
  id: string;
  /** UI `Group` label. Without a label the controls sit directly in the step. */
  label?: string;
  object?: SectionObject;
  visibleWhen?: VisibilityRule;
  fields: DesignerField[];
}

export interface DesignerStep {
  id: string;
  /** CMP-033 page id. */
  key: string;
  /** Stepper label. */
  label: string;
  /** Heading of the step card. */
  title?: string;
  hint?: string;
  /** Read-only summary step that precedes submit. */
  review: boolean;
  sections: DesignerSection[];
}

export interface DesignerForm {
  /** CMP-009 form key. */
  formId: string;
  title: string;
  /** Semantic version of this authoring draft; part of the CMP-033 document key. */
  version: string;
  steps: DesignerStep[];
  /**
   * Declared order of the root `required` names from an imported package. Names keep this order
   * and new ones follow in layout order, so unchanged imports keep their content hash.
   */
  requiredOrder?: string[];
}

export interface FieldRef {
  step: DesignerStep;
  stepIndex: number;
  section: DesignerSection;
  sectionIndex: number;
  field: DesignerField;
  fieldIndex: number;
  /** Root-relative path (`key` or `object/key`). */
  path: string;
}

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;
export const FORM_KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
export const STEP_KEY_RE = /^[a-z][a-z0-9_-]{1,63}$/;
export const SEMVER_RE = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;
const SEMANTIC_PART_RE = /^[A-Z0-9]{1,32}$/;

/** `SF-SEM-` followed by one to eight upper-case segments (CMP-058 canonical element ids). */
export function isSemanticId(value: string): boolean {
  if (!value.startsWith('SF-SEM-')) return false;
  const parts = value.slice('SF-SEM-'.length).split('-');
  return parts.length <= 8 && parts.every((p) => SEMANTIC_PART_RE.test(p));
}

export function fieldPath(section: DesignerSection, field: DesignerField): string {
  return section.object ? `${section.object.key}/${field.key}` : field.key;
}

export function allFields(form: DesignerForm): FieldRef[] {
  const out: FieldRef[] = [];
  form.steps.forEach((step, stepIndex) =>
    step.sections.forEach((section, sectionIndex) =>
      section.fields.forEach((field, fieldIndex) =>
        out.push({
          step,
          stepIndex,
          section,
          sectionIndex,
          field,
          fieldIndex,
          path: fieldPath(section, field),
        }),
      ),
    ),
  );
  return out;
}

export function findField(form: DesignerForm, fieldId: string): FieldRef | null {
  return allFields(form).find((r) => r.field.id === fieldId) ?? null;
}

export function findFieldByPath(form: DesignerForm, path: string): FieldRef | null {
  return allFields(form).find((r) => r.path === path) ?? null;
}

export function findSection(
  form: DesignerForm,
  sectionId: string,
): {
  step: DesignerStep;
  stepIndex: number;
  section: DesignerSection;
  sectionIndex: number;
} | null {
  for (const [stepIndex, step] of form.steps.entries()) {
    const sectionIndex = step.sections.findIndex((s) => s.id === sectionId);
    const section = step.sections[sectionIndex];
    if (section) return { step, stepIndex, section, sectionIndex };
  }
  return null;
}

export function isChoice(kind: FieldKind): boolean {
  return kind === 'select' || kind === 'radio';
}

export function isText(kind: FieldKind): boolean {
  return kind === 'text' || kind === 'textarea' || kind === 'email';
}

export function isNumeric(kind: FieldKind): boolean {
  return kind === 'integer' || kind === 'number';
}

export function isBoolean(kind: FieldKind): boolean {
  return kind === 'checkbox' || kind === 'declaration';
}

/** Plain-language name of a field kind for authors. */
export const KIND_LABEL: Record<FieldKind, string> = {
  text: 'Short text',
  textarea: 'Long text',
  integer: 'Whole number',
  number: 'Decimal number',
  date: 'Date',
  email: 'Email',
  select: 'Dropdown',
  radio: 'Radio buttons',
  checkbox: 'Yes / no checkbox',
  declaration: 'Declaration',
};
