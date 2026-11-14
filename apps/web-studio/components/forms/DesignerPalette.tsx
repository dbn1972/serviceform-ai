'use client';

import { Icon } from '@serviceform/ui-ux4g';
import {
  FIELD_PALETTE,
  SECTION_PALETTE,
  type FieldPaletteItem,
  type PaletteGroup,
} from '@serviceform/studio-designers/forms';

export const PALETTE_MIME = 'application/x-sf-palette';

const GROUPS: { id: PaletteGroup; title: string; note: string }[] = [
  { id: 'basic', title: 'Inputs', note: 'Generic fields' },
  { id: 'choice', title: 'Choices', note: 'Options and confirmations' },
  { id: 'semantic', title: 'Common government fields', note: 'Bound to canonical semantic ids' },
];

function PaletteButton({
  item,
  disabled,
  onAdd,
}: {
  item: { id: string; label: string; description: string };
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
        aria-label={`Add ${item.label}`}
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

/**
 * Field and section palette. Click (or Enter/Space) adds to the selected section; drag-and-drop
 * onto the canvas is a pointer shortcut for the same action.
 */
export function DesignerPalette({
  disabled,
  onAddField,
  onAddSection,
}: {
  disabled: boolean;
  onAddField: (item: FieldPaletteItem) => void;
  onAddSection: (id: string) => void;
}) {
  return (
    <aside className="sf-designer-pane sf-designer-palette" aria-label="Add to the form">
      <h2 className="ux4g-heading-xs-strong">Add to the form</h2>
      {GROUPS.map((g) => (
        <section key={g.id} aria-labelledby={`palette-${g.id}`}>
          <h3 id={`palette-${g.id}`} className="sf-designer-pane-title">
            {g.title}
            <span className="ux4g-body-s-default">{g.note}</span>
          </h3>
          <ul className="sf-designer-palette-list">
            {FIELD_PALETTE.filter((p) => p.group === g.id).map((item) => (
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
      ))}
      <section aria-labelledby="palette-sections">
        <h3 id="palette-sections" className="sf-designer-pane-title">
          Sections
          <span className="ux4g-body-s-default">Groups on the current step</span>
        </h3>
        <ul className="sf-designer-palette-list">
          {SECTION_PALETTE.map((item) => (
            <PaletteButton key={item.id} item={item} disabled={disabled} onAdd={onAddSection} />
          ))}
        </ul>
      </section>
    </aside>
  );
}
