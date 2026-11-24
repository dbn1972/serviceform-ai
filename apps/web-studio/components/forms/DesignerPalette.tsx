'use client';

import { Button, Icon, TextInput } from '@serviceform/ui-ux4g';
import {
  FIELD_PALETTE,
  KIND_LABEL,
  SECTION_PALETTE,
  type FieldPaletteItem,
  type LibrarySection,
  type PaletteGroup,
} from '@serviceform/studio-designers/forms';
import { useState } from 'react';

export const PALETTE_MIME = 'application/x-sf-palette';

const GROUPS: { id: PaletteGroup; title: string; note: string }[] = [
  { id: 'basic', title: 'Inputs', note: 'Generic fields' },
  { id: 'choice', title: 'Choices', note: 'Options and confirmations' },
  { id: 'semantic', title: 'Common government fields', note: 'Bound to canonical semantic ids' },
];

/** Library sections listed before "Show all" when nothing is searched. */
const LIBRARY_PREVIEW = 4;

function PaletteButton({
  item,
  disabled,
  onAdd,
}: {
  item: { id: string; label: string; description: string; name?: string };
  disabled: boolean;
  onAdd: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="sf-designer-palette-item"
        draggable={!disabled}
        disabled={disabled}
        aria-label={item.name ?? `Add ${item.label}`}
        onDragStart={(e) => {
          e.dataTransfer.setData(PALETTE_MIME, item.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => onAdd(item.id)}
      >
        <span className="sf-designer-palette-icon" aria-hidden="true">
          <Icon name="plus" size={16} />
        </span>
        <span className="sf-designer-palette-copy">
          <span className="ux4g-label-m-default">{item.label}</span>
          <span className="ux4g-body-s-default">{item.description}</span>
        </span>
      </button>
    </li>
  );
}

/** Every word of the query appears in one of the texts (case-insensitive). */
export function paletteMatches(query: string, ...texts: string[]): boolean {
  const haystack = texts.join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function libraryItem(s: LibrarySection) {
  const fields = `${s.fieldLabels.length} ${s.fieldLabels.length === 1 ? 'field' : 'fields'}`;
  const uses = `in ${s.uses} catalogue ${s.uses === 1 ? 'form' : 'forms'}`;
  return {
    id: s.id,
    label: s.label,
    name: `Reuse section ${s.label} from ${s.source}`,
    description: `${fields} · ${uses} · from ${s.source}`,
  };
}

/**
 * Field and section palette with search. Click (or Enter/Space) adds to the selected section;
 * drag-and-drop onto the canvas is a pointer shortcut for the same action. Catalogue sections are
 * copies of sections already used in catalogue forms, carrying only their own rules.
 */
export function DesignerPalette({
  disabled,
  library = [],
  onAddField,
  onAddSection,
}: {
  disabled: boolean;
  library?: readonly LibrarySection[];
  onAddField: (item: FieldPaletteItem) => void;
  onAddSection: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [allLibrary, setAllLibrary] = useState(false);
  const searching = query.trim() !== '';
  const fields = FIELD_PALETTE.filter((p) =>
    paletteMatches(query, p.label, p.description, KIND_LABEL[p.kind]),
  );
  const sections = SECTION_PALETTE.filter((p) => paletteMatches(query, p.label, p.description));
  const reusable = library.filter((s) =>
    paletteMatches(query, s.label, s.source, ...s.fieldLabels),
  );
  const shownLibrary = searching || allLibrary ? reusable : reusable.slice(0, LIBRARY_PREVIEW);
  const total = fields.length + sections.length + reusable.length;
  return (
    <aside className="sf-designer-pane sf-designer-palette" aria-label="Add to the form">
      <h2 className="ux4g-heading-xs-strong">Add to the form</h2>
      <TextInput
        id="palette-search"
        label="Find a field or section"
        type="search"
        size="s"
        value={query}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="ux4g-body-s-default sf-designer-muted" role="status" aria-live="polite">
        {searching ? `${total} ${total === 1 ? 'match' : 'matches'}` : ''}
      </p>
      {GROUPS.map((g) => {
        const items = fields.filter((p) => p.group === g.id);
        if (items.length === 0) return null;
        return (
          <section key={g.id} aria-labelledby={`palette-${g.id}`}>
            <h3 id={`palette-${g.id}`} className="sf-designer-pane-title">
              {g.title}
              <span className="ux4g-body-s-default">{g.note}</span>
            </h3>
            <ul className="sf-designer-palette-list">
              {items.map((item) => (
                <PaletteButton
                  key={item.id}
                  item={item}
                  disabled={disabled}
                  onAdd={(id) => {
                    const found = FIELD_PALETTE.find((p) => p.id === id);
                    if (found) onAddField(found);
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {sections.length > 0 ? (
        <section aria-labelledby="palette-sections">
          <h3 id="palette-sections" className="sf-designer-pane-title">
            Sections
            <span className="ux4g-body-s-default">Groups on the current step</span>
          </h3>
          <ul className="sf-designer-palette-list">
            {sections.map((item) => (
              <PaletteButton key={item.id} item={item} disabled={disabled} onAdd={onAddSection} />
            ))}
          </ul>
        </section>
      ) : null}
      {reusable.length > 0 ? (
        <section aria-labelledby="palette-library">
          <h3 id="palette-library" className="sf-designer-pane-title">
            Sections from the catalogue
            <span className="ux4g-body-s-default">
              Reuse a section other forms already use; keys stay unique
            </span>
          </h3>
          <ul className="sf-designer-palette-list" data-testid="palette-library">
            {shownLibrary.map((s) => (
              <PaletteButton
                key={s.id}
                item={libraryItem(s)}
                disabled={disabled}
                onAdd={onAddSection}
              />
            ))}
          </ul>
          {!searching && reusable.length > LIBRARY_PREVIEW ? (
            <Button
              variant="text-primary"
              size="s"
              aria-expanded={allLibrary}
              onClick={() => setAllLibrary((v) => !v)}
            >
              {allLibrary ? 'Show fewer' : `Show all ${reusable.length}`}
            </Button>
          ) : null}
        </section>
      ) : null}
      {searching && total === 0 ? (
        <p className="ux4g-body-s-default">
          Nothing matches &ldquo;{query.trim()}&rdquo;. Try a shorter word, such as
          &ldquo;date&rdquo; or &ldquo;address&rdquo;.
        </p>
      ) : null}
    </aside>
  );
}
