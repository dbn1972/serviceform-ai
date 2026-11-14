import { newId, slugKey, uniqueKey } from './import';
import {
  allFields,
  findField,
  findSection,
  isChoice,
  type DesignerField,
  type DesignerForm,
  type DesignerSection,
  type DesignerStep,
  type FieldKind,
} from './model';

/**
 * Immutable editing operations used by the Studio canvas. Each returns a new form; renaming a
 * key rewrites every rule that refers to it so authors never break references by renaming.
 */

export type FieldTemplate = Omit<DesignerField, 'id'>;

export interface SectionTemplate {
  label?: string;
  object?: DesignerSection['object'];
  fields: FieldTemplate[];
}

function mapSteps(form: DesignerForm, fn: (step: DesignerStep) => DesignerStep): DesignerForm {
  return { ...form, steps: form.steps.map(fn) };
}

function mapSections(
  form: DesignerForm,
  fn: (section: DesignerSection, step: DesignerStep) => DesignerSection,
): DesignerForm {
  return mapSteps(form, (step) => ({
    ...step,
    sections: step.sections.map((s) => fn(s, step)),
  }));
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  const [item] = out.splice(from, 1);
  if (item === undefined) return [...items];
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

export function emptyForm(
  formId = 'new.application',
  title = 'New application form',
): DesignerForm {
  return {
    formId,
    title,
    version: '1.0.0',
    steps: [
      {
        id: newId('step'),
        key: 'applicant',
        label: 'Applicant',
        title: 'Applicant details',
        review: false,
        sections: [{ id: newId('section'), label: 'Details', fields: [] }],
      },
    ],
  };
}

export function updateForm(
  form: DesignerForm,
  patch: Partial<Pick<DesignerForm, 'formId' | 'title' | 'version'>>,
): DesignerForm {
  return { ...form, ...patch };
}

export function addStep(
  form: DesignerForm,
  label = 'New step',
): { form: DesignerForm; id: string } {
  const taken = new Set(form.steps.map((s) => s.key));
  const step: DesignerStep = {
    id: newId('step'),
    key: uniqueKey(slugKey(label, `step_${form.steps.length + 1}`), taken),
    label,
    review: false,
    sections: [{ id: newId('section'), label: 'Details', fields: [] }],
  };
  const reviewAt = form.steps.findIndex((s) => s.review);
  const steps = [...form.steps];
  steps.splice(reviewAt >= 0 ? reviewAt : steps.length, 0, step);
  return { form: { ...form, steps }, id: step.id };
}

export function updateStep(
  form: DesignerForm,
  stepId: string,
  patch: Partial<Omit<DesignerStep, 'id' | 'sections'>>,
): DesignerForm {
  return mapSteps(form, (s) => {
    if (s.id !== stepId) return s;
    const next: DesignerStep = { ...s, ...patch };
    if (patch.title === '') delete next.title;
    if (patch.hint === '') delete next.hint;
    return next;
  });
}

export function removeStep(form: DesignerForm, stepId: string): DesignerForm {
  return { ...form, steps: form.steps.filter((s) => s.id !== stepId) };
}

export function moveStep(form: DesignerForm, stepId: string, delta: number): DesignerForm {
  const i = form.steps.findIndex((s) => s.id === stepId);
  if (i < 0) return form;
  return { ...form, steps: move(form.steps, i, i + delta) };
}

export function addSection(
  form: DesignerForm,
  stepId: string,
  template: SectionTemplate = { label: 'New section', fields: [] },
): { form: DesignerForm; id: string; fieldIds: string[] } {
  const id = newId('section');
  const fieldIds: string[] = [];
  const taken = new Set(topLevelKeys(form));
  let objectKey = template.object?.key;
  if (objectKey) {
    objectKey = uniqueKey(objectKey, taken);
  }
  const fields = template.fields.map((t) => {
    const fid = newId('field');
    fieldIds.push(fid);
    return { ...t, id: fid };
  });
  if (!objectKey) {
    for (const f of fields) {
      f.key = uniqueKey(f.key, taken);
      taken.add(f.key);
    }
  }
  const section: DesignerSection = { id, fields };
  if (template.label !== undefined) section.label = template.label;
  if (template.object && objectKey) section.object = { ...template.object, key: objectKey };
  return {
    form: mapSteps(form, (s) =>
      s.id === stepId ? { ...s, sections: [...s.sections, section] } : s,
    ),
    id,
    fieldIds,
  };
}

export function updateSection(
  form: DesignerForm,
  sectionId: string,
  patch: {
    label?: string | null;
    object?: DesignerSection['object'] | null;
    visibleWhen?: DesignerSection['visibleWhen'] | null;
  },
): DesignerForm {
  const found = findSection(form, sectionId);
  const oldObjectKey = found?.section.object?.key;
  let next = mapSections(form, (s) => {
    if (s.id !== sectionId) return s;
    const out: DesignerSection = { ...s };
    if (patch.label === null) delete out.label;
    else if (patch.label !== undefined) out.label = patch.label;
    if (patch.object === null) delete out.object;
    else if (patch.object !== undefined) out.object = patch.object;
    if (patch.visibleWhen === null) delete out.visibleWhen;
    else if (patch.visibleWhen !== undefined) out.visibleWhen = patch.visibleWhen;
    return out;
  });
  const newObjectKey = findSection(next, sectionId)?.section.object?.key;
  if (oldObjectKey && newObjectKey && oldObjectKey !== newObjectKey && found) {
    const order = renameIn(next.requiredOrder, oldObjectKey, newObjectKey);
    if (order) next = { ...next, requiredOrder: order };
    for (const f of found.section.fields) {
      next = renameReferences(next, `${oldObjectKey}/${f.key}`, `${newObjectKey}/${f.key}`);
    }
  }
  return next;
}

export function removeSection(form: DesignerForm, sectionId: string): DesignerForm {
  return mapSteps(form, (s) => ({ ...s, sections: s.sections.filter((x) => x.id !== sectionId) }));
}

export function moveSection(form: DesignerForm, sectionId: string, delta: number): DesignerForm {
  return mapSteps(form, (s) => {
    const i = s.sections.findIndex((x) => x.id === sectionId);
    return i < 0 ? s : { ...s, sections: move(s.sections, i, i + delta) };
  });
}

function topLevelKeys(form: DesignerForm): string[] {
  return form.steps.flatMap((s) =>
    s.sections.flatMap((sec) => (sec.object ? [sec.object.key] : sec.fields.map((f) => f.key))),
  );
}

function siblingKeys(section: DesignerSection, form: DesignerForm): Set<string> {
  return new Set(section.object ? section.fields.map((f) => f.key) : topLevelKeys(form));
}

export function addField(
  form: DesignerForm,
  sectionId: string,
  template: FieldTemplate,
  index?: number,
): { form: DesignerForm; id: string } {
  const found = findSection(form, sectionId);
  if (!found) return { form, id: '' };
  const id = newId('field');
  const key = uniqueKey(template.key, siblingKeys(found.section, form));
  const field: DesignerField = { ...template, id, key };
  return {
    form: mapSections(form, (s) => {
      if (s.id !== sectionId) return s;
      const fields = [...s.fields];
      fields.splice(index ?? fields.length, 0, field);
      return { ...s, fields };
    }),
    id,
  };
}

export function duplicateField(
  form: DesignerForm,
  fieldId: string,
): { form: DesignerForm; id: string } {
  const ref = findField(form, fieldId);
  if (!ref) return { form, id: '' };
  const { id: _old, ...template } = ref.field;
  return addField(
    form,
    ref.section.id,
    { ...template, label: `${template.label} (copy)`, key: template.key },
    ref.fieldIndex + 1,
  );
}

function renameIn(order: string[] | undefined, from: string, to: string): string[] | undefined {
  return order?.map((n) => (n === from ? to : n));
}

function renameReferences(form: DesignerForm, from: string, to: string): DesignerForm {
  if (from === to) return form;
  const [fromHead, fromLeaf] = from.split('/');
  const [, toLeaf] = to.split('/');
  const base: DesignerForm = { ...form };
  if (fromLeaf === undefined) {
    const order = renameIn(form.requiredOrder, from, to);
    if (order) base.requiredOrder = order;
  }
  return mapSections(base, (s) => {
    const section: DesignerSection = { ...s };
    const object = s.object;
    if (object && fromLeaf !== undefined && toLeaf !== undefined && object.key === fromHead) {
      const order = renameIn(object.requiredOrder, fromLeaf, toLeaf);
      if (order) section.object = { ...object, requiredOrder: order };
    }
    if (s.visibleWhen?.field === from) section.visibleWhen = { ...s.visibleWhen, field: to };
    section.fields = s.fields.map((f) => {
      let next = f;
      if (f.visibleWhen?.field === from)
        next = { ...next, visibleWhen: { ...f.visibleWhen, field: to } };
      if (f.requiredWhen?.field === from) {
        next = { ...next, requiredWhen: { ...f.requiredWhen, field: to } };
      }
      return next;
    });
    return section;
  });
}

export type FieldPatch = {
  [K in keyof Omit<DesignerField, 'id'>]?: DesignerField[K] | null;
};

/** Applies a patch; `null` clears an optional property. Renaming a key updates references. */
export function updateField(form: DesignerForm, fieldId: string, patch: FieldPatch): DesignerForm {
  const ref = findField(form, fieldId);
  if (!ref) return form;
  let next = mapSections(form, (s) => ({
    ...s,
    fields: s.fields.map((f) => {
      if (f.id !== fieldId) return f;
      const cleared = new Set(
        Object.entries(patch)
          .filter(([, v]) => v === null)
          .map(([k]) => k),
      );
      const set = Object.entries(patch).filter(([, v]) => v !== null && v !== undefined);
      const out = Object.fromEntries([
        ...Object.entries(f).filter(([k]) => !cleared.has(k)),
        ...set,
      ]);
      const field = out as unknown as DesignerField;
      if (isChoice(field.kind) && !field.options) field.options = [];
      if (!isChoice(field.kind)) delete field.options;
      return field;
    }),
  }));
  if (patch.key && patch.key !== ref.field.key) {
    const prefix = ref.section.object ? `${ref.section.object.key}/` : '';
    next = renameReferences(next, `${prefix}${ref.field.key}`, `${prefix}${patch.key}`);
  }
  return next;
}

export function changeKind(form: DesignerForm, fieldId: string, kind: FieldKind): DesignerForm {
  const ref = findField(form, fieldId);
  if (!ref) return form;
  const patch: FieldPatch = { kind };
  if (kind === 'declaration') patch.required = true;
  if (isChoice(kind) && !ref.field.options?.length) {
    patch.options = [
      { value: 'OPTION_1', label: 'Option 1' },
      { value: 'OPTION_2', label: 'Option 2' },
    ];
  }
  if (kind !== 'text' && kind !== 'textarea') patch.pattern = null;
  if (kind !== 'integer' && kind !== 'number') {
    patch.minimum = null;
    patch.maximum = null;
  }
  return updateField(form, fieldId, patch);
}

export function removeField(form: DesignerForm, fieldId: string): DesignerForm {
  return mapSections(form, (s) => ({ ...s, fields: s.fields.filter((f) => f.id !== fieldId) }));
}

/** Moves a field by `delta` positions, crossing into the neighbouring section at the edges. */
export function moveFieldBy(form: DesignerForm, fieldId: string, delta: number): DesignerForm {
  const ref = findField(form, fieldId);
  if (!ref) return form;
  const target = ref.fieldIndex + delta;
  if (target >= 0 && target < ref.section.fields.length) {
    return moveField(form, fieldId, ref.section.id, target);
  }
  const sections = form.steps.flatMap((s) => s.sections);
  const at = sections.findIndex((s) => s.id === ref.section.id);
  const neighbour = sections[at + (delta < 0 ? -1 : 1)];
  if (!neighbour) return form;
  return moveField(form, fieldId, neighbour.id, delta < 0 ? neighbour.fields.length : 0);
}

/** Moves a field to `index` in `sectionId`, keeping its key unique in the new scope. */
export function moveField(
  form: DesignerForm,
  fieldId: string,
  sectionId: string,
  index: number,
): DesignerForm {
  const ref = findField(form, fieldId);
  const dest = findSection(form, sectionId);
  if (!ref || !dest) return form;
  if (ref.section.id === sectionId) {
    return mapSections(form, (s) =>
      s.id === sectionId ? { ...s, fields: move(s.fields, ref.fieldIndex, index) } : s,
    );
  }
  const removed = removeField(form, fieldId);
  const destAfter = findSection(removed, sectionId);
  if (!destAfter) return form;
  const key = uniqueKey(ref.field.key, siblingKeys(destAfter.section, removed));
  const field: DesignerField = { ...ref.field, key };
  if (destAfter.section.object) delete field.requiredWhen;
  let next = mapSections(removed, (s) => {
    if (s.id !== sectionId) return s;
    const fields = [...s.fields];
    fields.splice(Math.max(0, Math.min(index, fields.length)), 0, field);
    return { ...s, fields };
  });
  const oldPath = ref.path;
  const newPath = destAfter.section.object ? `${destAfter.section.object.key}/${key}` : key;
  next = renameReferences(next, oldPath, newPath);
  return next;
}

/** Fields an author can use as a rule condition for `selfId` (everything except itself). */
export function conditionCandidates(form: DesignerForm, selfId?: string) {
  return allFields(form)
    .filter((r) => r.field.id !== selfId)
    .map((r) => ({ path: r.path, label: r.field.label || r.path, field: r.field }));
}
