import { newId, slugKey, trimChar, uniqueKey } from './import';
import {
  allFields,
  fieldPath,
  findField,
  findSection,
  isChoice,
  type ChoiceOption,
  type Condition,
  type DesignerField,
  type DesignerForm,
  type DesignerSection,
  type DesignerStep,
  type FieldKind,
  type RequiredWhen,
  type VisibilityRule,
} from './model';

/**
 * Immutable editing operations used by the Studio canvas. Each returns a new form; renaming a
 * key rewrites every rule that refers to it so authors never break references by renaming.
 */

export type FieldTemplate = Omit<DesignerField, 'id'>;

export interface SectionTemplate {
  label?: string;
  object?: DesignerSection['object'];
  visibleWhen?: VisibilityRule;
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

function remapCondition<C extends Condition>(rule: C | undefined, paths: Map<string, string>) {
  if (!rule) return undefined;
  const to = paths.get(rule.field);
  return to === undefined ? rule : { ...rule, field: to };
}

/**
 * Adds a section to a step (at `index`, else last). Keys are made unique in their scope, and
 * rules inside the template that read its own answers follow any key that had to change.
 */
export function addSection(
  form: DesignerForm,
  stepId: string,
  template: SectionTemplate = { label: 'New section', fields: [] },
  index?: number,
): { form: DesignerForm; id: string; fieldIds: string[] } {
  const id = newId('section');
  const fieldIds: string[] = [];
  const taken = new Set(topLevelKeys(form));
  const oldObject = template.object?.key;
  const objectKey = oldObject ? uniqueKey(oldObject, taken) : undefined;
  const paths = new Map<string, string>();
  const fields: DesignerField[] = template.fields.map((t) => {
    const fid = newId('field');
    fieldIds.push(fid);
    if (oldObject && objectKey) {
      paths.set(`${oldObject}/${t.key}`, `${objectKey}/${t.key}`);
      return { ...t, id: fid };
    }
    const key = uniqueKey(t.key, taken);
    taken.add(key);
    paths.set(t.key, key);
    return { ...t, id: fid, key };
  });
  for (const f of fields) {
    const visibleWhen = remapCondition(f.visibleWhen, paths);
    const requiredWhen = remapCondition(f.requiredWhen, paths);
    if (visibleWhen) f.visibleWhen = visibleWhen;
    if (requiredWhen) f.requiredWhen = requiredWhen;
  }
  const section: DesignerSection = { id, fields };
  if (template.label !== undefined) section.label = template.label;
  if (template.object && objectKey) section.object = { ...template.object, key: objectKey };
  const visibleWhen = remapCondition(template.visibleWhen, paths);
  if (visibleWhen) section.visibleWhen = visibleWhen;
  return {
    form: mapSteps(form, (s) => {
      if (s.id !== stepId) return s;
      const sections = [...s.sections];
      sections.splice(index ?? sections.length, 0, section);
      return { ...s, sections };
    }),
    id,
    fieldIds,
  };
}

/**
 * A section as a reusable template. Visibility rules that read its own answers always travel;
 * rules on outside answers only with `keepOuterRules` (same form). "Required when / unless" rules
 * on its own answers are dropped: they would open a second root condition CMP-009 cannot evaluate.
 */
export function sectionTemplate(
  form: DesignerForm,
  sectionId: string,
  opts: { keepOuterRules?: boolean } = {},
): { template: SectionTemplate; dropped: number } | null {
  const found = findSection(form, sectionId);
  if (!found) return null;
  const section = found.section;
  const inner = new Set(section.fields.map((f) => fieldPath(section, f)));
  const keep = opts.keepOuterRules === true;
  let dropped = 0;
  const fields = section.fields.map((f) => {
    const { id: _id, ...t } = f;
    const template: FieldTemplate = { ...t };
    if (t.visibleWhen && !inner.has(t.visibleWhen.field) && !keep) {
      delete template.visibleWhen;
      dropped += 1;
    }
    if (t.requiredWhen && (inner.has(t.requiredWhen.field) || !keep)) {
      delete template.requiredWhen;
      dropped += 1;
    }
    return template;
  });
  const template: SectionTemplate = { fields };
  if (section.label !== undefined) template.label = section.label;
  if (section.object) template.object = { ...section.object };
  if (section.visibleWhen) {
    if (keep && !inner.has(section.visibleWhen.field)) template.visibleWhen = section.visibleWhen;
    else dropped += 1;
  }
  return { template, dropped };
}

/** Copies a section (fields, rules, grouped data) right after itself, with unique keys. */
export function duplicateSection(
  form: DesignerForm,
  sectionId: string,
): { form: DesignerForm; id: string; dropped: number } {
  const found = findSection(form, sectionId);
  const copy = sectionTemplate(form, sectionId, { keepOuterRules: true });
  if (!found || !copy) return { form, id: '', dropped: 0 };
  const template = copy.template;
  if (template.label !== undefined) template.label = `${template.label} (copy)`;
  if (template.object)
    template.object = { ...template.object, title: `${template.object.title} (copy)` };
  const res = addSection(form, found.step.id, template, found.sectionIndex + 1);
  return { form: res.form, id: res.id, dropped: copy.dropped };
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

/**
 * Moves a section before `beforeSectionId` (or to the end of `stepId`), across steps if needed.
 * Grouped-data keys are form-wide, so no key or rule reference changes.
 */
export function moveSectionTo(
  form: DesignerForm,
  sectionId: string,
  stepId: string,
  beforeSectionId?: string,
): DesignerForm {
  const found = findSection(form, sectionId);
  if (!found || beforeSectionId === sectionId) return form;
  if (!form.steps.some((s) => s.id === stepId)) return form;
  const removed = mapSteps(form, (s) => ({
    ...s,
    sections: s.sections.filter((x) => x.id !== sectionId),
  }));
  return mapSteps(removed, (s) => {
    if (s.id !== stepId) return s;
    const sections = [...s.sections];
    const at = beforeSectionId ? sections.findIndex((x) => x.id === beforeSectionId) : -1;
    sections.splice(at < 0 ? sections.length : at, 0, found.section);
    return { ...s, sections };
  });
}

/**
 * The section that receives a field dropped on a step: its last section without grouped data,
 * created when the step has none, so a dropped field never silently joins grouped data.
 */
export function stepDropSection(
  form: DesignerForm,
  stepId: string,
): { form: DesignerForm; sectionId: string } | null {
  const step = form.steps.find((s) => s.id === stepId);
  if (!step) return null;
  const plain = [...step.sections].reverse().find((s) => !s.object);
  if (plain) return { form, sectionId: plain.id };
  const created = addSection(form, stepId, { label: 'Details', fields: [] });
  return { form: created.form, sectionId: created.id };
}

/** Moves a field to the end of the step's drop section (see `stepDropSection`). */
export function moveFieldToStep(form: DesignerForm, fieldId: string, stepId: string): DesignerForm {
  const ref = findField(form, fieldId);
  if (!ref) return form;
  if (ref.step.id === stepId && !ref.section.object) return form;
  const target = stepDropSection(form, stepId);
  if (!target) return form;
  const dest = findSection(target.form, target.sectionId);
  return moveField(target.form, fieldId, target.sectionId, dest?.section.fields.length ?? 0);
}

/** Sections a field can be moved to, labelled "Step › Section" in applicant order. */
export function sectionTargets(form: DesignerForm): { id: string; label: string }[] {
  return form.steps.flatMap((step, i) =>
    step.sections.map((s, j) => ({
      id: s.id,
      label: `${i + 1}. ${step.label || 'Untitled step'} › ${s.label ?? s.object?.title ?? `Section ${j + 1}`}`,
    })),
  );
}

const MAX_PASTED_OPTIONS = 200;

function storedValueOf(label: string): string {
  return trimChar(label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), '_').slice(0, 64);
}

/**
 * Options from pasted text, one per line: `Label`, or `STORED_VALUE | Label` to keep a value.
 * Generated stored values are upper-case and unique; blank lines are skipped.
 */
export function optionsFromText(text: string): ChoiceOption[] {
  const out: ChoiceOption[] = [];
  const taken = new Set<string>();
  for (const raw of text.split('\n').slice(0, MAX_PASTED_OPTIONS)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const bar = line.indexOf('|');
    const label = (bar >= 0 ? line.slice(bar + 1) : line).trim();
    let value = bar >= 0 ? line.slice(0, bar).trim() : storedValueOf(label);
    if (value.length === 0) value = `OPTION_${out.length + 1}`;
    const unique = uniqueKey(value, taken);
    taken.add(unique);
    out.push({ value: unique, label: label || unique });
  }
  return out;
}

export type RuleTarget = { kind: 'field' | 'section'; id: string };

/** Sets (or with `null` removes) the one visibility rule a field or section can carry. */
export function setVisibilityRule(
  form: DesignerForm,
  target: RuleTarget,
  rule: VisibilityRule | null,
): DesignerForm {
  return target.kind === 'section'
    ? updateSection(form, target.id, { visibleWhen: rule })
    : updateField(form, target.id, { visibleWhen: rule });
}

/** Makes a field required when (or unless) a condition holds; `null` makes it optional. */
export function setRequirementRule(
  form: DesignerForm,
  fieldId: string,
  when: RequiredWhen | null,
): DesignerForm {
  return updateField(
    form,
    fieldId,
    when ? { required: false, requiredWhen: when } : { required: false, requiredWhen: null },
  );
}

/** Removes a rule by its Logic view id (`visible:<target id>` or `required:<field id>`). */
export function removeLogicRule(form: DesignerForm, ruleId: string): DesignerForm {
  const at = ruleId.indexOf(':');
  const kind = ruleId.slice(0, at);
  const id = ruleId.slice(at + 1);
  if (kind === 'required') return setRequirementRule(form, id, null);
  if (kind !== 'visible') return form;
  const target: RuleTarget = findSection(form, id)
    ? { kind: 'section', id }
    : { kind: 'field', id };
  return setVisibilityRule(form, target, null);
}

/**
 * The root condition every "required when / unless" rule shares (CMP-009 evaluates only one), so
 * a new requirement rule can reuse it instead of being refused.
 */
export function sharedRequirement(form: DesignerForm, exceptFieldId?: string): Condition | null {
  const ref = allFields(form).find((r) => r.field.requiredWhen && r.field.id !== exceptFieldId);
  const when = ref?.field.requiredWhen;
  if (!when) return null;
  const { unless: _unless, ...condition } = when;
  return condition;
}

/** Fields an author can use as a rule condition for `selfId` (everything except itself). */
export function conditionCandidates(form: DesignerForm, selfId?: string) {
  return allFields(form)
    .filter((r) => r.field.id !== selfId)
    .map((r) => ({ path: r.path, label: r.field.label || r.path, field: r.field }));
}
