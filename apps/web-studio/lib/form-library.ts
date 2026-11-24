import { listTemplates } from '@serviceform/service-templates';
import {
  importForm,
  sectionLibrary,
  type LibrarySection,
} from '@serviceform/studio-designers/forms';

let cached: LibrarySection[] | null = null;

/** Sections of every catalogue form version, most reused first; computed once per process. */
export function catalogueSectionLibrary(): LibrarySection[] {
  cached ??= sectionLibrary(
    listTemplates().flatMap((t) =>
      t.versions.map((v) => ({
        source: `${t.name} v${v.version}`,
        form: importForm(v.form, v.version).form,
      })),
    ),
  );
  return cached;
}
