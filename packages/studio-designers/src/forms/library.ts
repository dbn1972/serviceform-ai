import type { DesignerForm } from './model';
import { sectionTemplate, type SectionTemplate } from './ops';

/** A section reused across catalogue forms, offered as a palette item. */
export interface LibrarySection {
  /** `lib-` and a stable hash of the section's content. */
  id: string;
  label: string;
  /** First catalogue form version that has it, e.g. "Residence Certificate v1.0.0 › Address". */
  source: string;
  /** How many catalogue form versions contain exactly this section. */
  uses: number;
  fieldLabels: string[];
  /** Rules on answers outside the section, left behind when it is copied. */
  dropped: number;
  template: SectionTemplate;
}

/** Field labels shown to tell apart sections that share a heading. */
const SHORT_LABEL = 32;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Distinct sections of the given forms (catalogue template versions), most reused first. Copies
 * carry their own rules only, so they read the same in any form they are added to.
 */
export function sectionLibrary(
  sources: readonly { source: string; form: DesignerForm }[],
): LibrarySection[] {
  const byKey = new Map<string, LibrarySection>();
  for (const { source, form } of sources) {
    for (const step of form.steps) {
      for (const section of step.sections) {
        if (section.fields.length === 0) continue;
        const copy = sectionTemplate(form, section.id);
        if (!copy) continue;
        const key = JSON.stringify(copy.template);
        const seen = byKey.get(key);
        if (seen) {
          seen.uses += 1;
          continue;
        }
        const label = section.label ?? section.object?.title ?? step.label;
        byKey.set(key, {
          id: `lib-${fnv1a(key)}`,
          label,
          source: `${source} › ${step.label}`,
          uses: 1,
          fieldLabels: section.fields.map((f) => f.label),
          dropped: copy.dropped,
          template: copy.template,
        });
      }
    }
  }
  const items = [...byKey.values()];
  const named = new Map<string, number>();
  for (const s of items) named.set(s.label, (named.get(s.label) ?? 0) + 1);
  for (const s of items) {
    if ((named.get(s.label) ?? 0) < 2) continue;
    const shown = s.fieldLabels
      .slice(0, 2)
      .map((l) => (l.length > SHORT_LABEL ? `${l.slice(0, SHORT_LABEL - 1)}…` : l))
      .join(', ');
    s.label = `${s.label}: ${shown}${s.fieldLabels.length > 2 ? '…' : ''}`;
  }
  return items.sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label));
}
