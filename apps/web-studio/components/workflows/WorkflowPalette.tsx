'use client';

import { Icon } from '@serviceform/ui-ux4g';
import {
  KIND_INFO,
  NODE_KINDS,
  type KindGroup,
  type NodeKind,
} from '@serviceform/studio-designers/workflow';
import { NODE_KIND_MIME } from './WorkflowCanvas';

const GROUPS: { id: KindGroup; title: string }[] = [
  { id: 'events', title: 'Events' },
  { id: 'work', title: 'Work' },
  { id: 'routing', title: 'Routing' },
  { id: 'ports', title: 'Ports (platform services)' },
  { id: 'requests', title: 'Withdrawal and cancellation' },
];

/** Step palette over the FROZEN node kinds. Click adds next to the selection; drag drops it. */
export function WorkflowPalette({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (kind: NodeKind) => void;
}) {
  return (
    <aside className="sf-designer-pane sf-designer-palette" aria-label="Add steps">
      <h2 className="ux4g-heading-xs-strong">Add steps</h2>
      {GROUPS.map((g) => (
        <section key={g.id} aria-labelledby={`wf-palette-${g.id}`}>
          <h3 id={`wf-palette-${g.id}`} className="sf-designer-pane-title">
            {g.title}
          </h3>
          <ul className="sf-designer-palette-list">
            {NODE_KINDS.filter((k) => KIND_INFO[k].group === g.id && k !== 'START').map((kind) => (
              <li key={kind}>
                <button
                  type="button"
                  className="sf-designer-palette-item"
                  draggable={!disabled}
                  disabled={disabled}
                  aria-label={`Add ${KIND_INFO[kind].label}`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(NODE_KIND_MIME, kind);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAdd(kind)}
                >
                  <span
                    className={`sf-designer-palette-icon sf-wf-swatch-${KIND_INFO[kind].shape}`}
                    aria-hidden="true"
                  >
                    <Icon name="plus" size={16} />
                  </span>
                  <span className="sf-designer-palette-copy">
                    <span className="ux4g-label-m-default">{KIND_INFO[kind].label}</span>
                    <span className="ux4g-body-s-default">{KIND_INFO[kind].description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
