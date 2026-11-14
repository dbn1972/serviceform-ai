'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import {
  KIND_INFO,
  sizeOf,
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type WorkflowDesign,
  type WorkflowIssue,
} from '@serviceform/studio-designers/workflow';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export type WorkflowSelection =
  { kind: 'workflow' } | { kind: 'node'; id: string } | { kind: 'edge'; id: string };

export const NODE_KIND_MIME = 'application/x-sf-node-kind';

export interface CanvasActions {
  select: (s: WorkflowSelection) => void;
  move: (id: string, x: number, y: number, settle: boolean) => void;
  connect: (from: string, to: string) => void;
  dropKind: (kind: NodeKind, x: number, y: number) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
}

interface Point {
  x: number;
  y: number;
}

const PAD = 120;

function center(n: FlowNode): Point {
  const s = sizeOf(n.kind);
  return { x: n.x + s.w / 2, y: n.y + s.h / 2 };
}

/** Edge path: forward edges leave right and enter left; back edges loop underneath. */
function edgePath(a: FlowNode, b: FlowNode): { d: string; label: Point } {
  const sa = sizeOf(a.kind);
  const sb = sizeOf(b.kind);
  const start = { x: a.x + sa.w, y: a.y + sa.h / 2 };
  const end = { x: b.x, y: b.y + sb.h / 2 };
  if (end.x >= start.x + 24) {
    const mid = (start.x + end.x) / 2;
    return {
      d: `M ${start.x} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${end.x} ${end.y}`,
      label: { x: mid, y: (start.y + end.y) / 2 },
    };
  }
  const ca = center(a);
  const cb = center(b);
  const below = Math.max(a.y + sa.h, b.y + sb.h) + 48;
  const from = { x: ca.x, y: a.y + sa.h };
  const to = { x: cb.x, y: b.y + sb.h };
  return {
    d: `M ${from.x} ${from.y} C ${from.x} ${below}, ${to.x} ${below}, ${to.x} ${to.y}`,
    label: { x: (from.x + to.x) / 2, y: below - 12 },
  };
}

function shapeFor(n: FlowNode) {
  const { w, h } = sizeOf(n.kind);
  const shape = KIND_INFO[n.kind].shape;
  if (shape === 'circle') {
    return <circle className="sf-wf-shape" cx={w / 2} cy={h / 2} r={w / 2 - 2} />;
  }
  if (shape === 'diamond') {
    return (
      <polygon
        className="sf-wf-shape"
        points={`${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`}
      />
    );
  }
  if (shape === 'hexagon') {
    const c = 14;
    return (
      <polygon
        className="sf-wf-shape"
        points={`${c},2 ${w - c},2 ${w - 2},${h / 2} ${w - c},${h - 2} ${c},${h - 2} 2,${h / 2}`}
      />
    );
  }
  return <rect className="sf-wf-shape" x={1} y={1} width={w - 2} height={h - 2} rx={10} />;
}

function wrap(label: string, max: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).map((l, i, all) => (i === 1 && all.length < lines.length ? `${l}…` : l));
}

/**
 * SVG canvas over the canonical graph. Pointer: drag a step to move it, drag its right handle onto
 * another step to connect, drop palette items to add. Keyboard: Tab to a step, arrows move it,
 * Enter selects, Delete removes; the Outline view and inspector offer every action as controls.
 */
export function WorkflowCanvas({
  design,
  selection,
  issues,
  readOnly,
  actions,
}: {
  design: WorkflowDesign;
  selection: WorkflowSelection;
  issues: readonly WorkflowIssue[];
  readOnly: boolean;
  actions: CanvasActions;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [link, setLink] = useState<{ from: string; to: Point } | null>(null);
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const width = Math.max(960, ...design.nodes.map((n) => n.x + sizeOf(n.kind).w + PAD));
  const height = Math.max(520, ...design.nodes.map((n) => n.y + sizeOf(n.kind).h + PAD));
  const errorNodes = new Set(
    issues
      .filter((i) => i.severity === 'error' && i.target.kind === 'node')
      .map((i) => (i.target as { id: string }).id),
  );
  const errorEdges = new Set(
    issues
      .filter((i) => i.severity === 'error' && i.target.kind === 'edge')
      .map((i) => (i.target as { id: string }).id),
  );

  const toSvg = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: clientX, y: clientY };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const onNodeDown = (e: PointerEvent<SVGGElement>, n: FlowNode) => {
    actions.select({ kind: 'node', id: n.id });
    if (readOnly || e.button !== 0) return;
    const p = toSvg(e.clientX, e.clientY);
    setDrag({ id: n.id, dx: p.x - n.x, dy: p.y - n.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onNodeMove = (e: PointerEvent<SVGGElement>) => {
    if (!drag) return;
    const p = toSvg(e.clientX, e.clientY);
    actions.move(drag.id, p.x - drag.dx, p.y - drag.dy, false);
  };

  const onNodeUp = (e: PointerEvent<SVGGElement>) => {
    if (!drag) return;
    const p = toSvg(e.clientX, e.clientY);
    actions.move(drag.id, p.x - drag.dx, p.y - drag.dy, true);
    setDrag(null);
  };

  const onHandleDown = (e: PointerEvent<SVGCircleElement>, n: FlowNode) => {
    e.stopPropagation();
    if (readOnly) return;
    setLink({ from: n.id, to: toSvg(e.clientX, e.clientY) });
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onSvgMove = (e: PointerEvent<SVGSVGElement>) => {
    if (link) setLink({ ...link, to: toSvg(e.clientX, e.clientY) });
  };

  const onSvgUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!link) return;
    const p = toSvg(e.clientX, e.clientY);
    const target = design.nodes.find((n) => {
      const s = sizeOf(n.kind);
      return p.x >= n.x && p.x <= n.x + s.w && p.y >= n.y && p.y <= n.y + s.h;
    });
    if (target && target.id !== link.from) actions.connect(link.from, target.id);
    setLink(null);
  };

  const onNodeKey = (e: KeyboardEvent<SVGGElement>, n: FlowNode) => {
    const step = e.shiftKey ? 40 : 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[e.key];
    if (delta && !readOnly) {
      e.preventDefault();
      actions.move(n.id, n.x + delta[0], n.y + delta[1], true);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      actions.select({ kind: 'node', id: n.id });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
      e.preventDefault();
      actions.removeNode(n.id);
    }
  };

  const linkFrom = link ? byId.get(link.from) : undefined;

  return (
    <section className="sf-designer-pane sf-wf-canvas-pane" aria-label="Workflow canvas">
      <div className="sf-wf-toolbar">
        <div className="sf-designer-segmented" role="group" aria-label="Zoom">
          <Button
            size="xs"
            variant="text-neutral"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
          >
            −
          </Button>
          <span className="ux4g-body-s-default sf-wf-zoom" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            size="xs"
            variant="text-neutral"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))}
          >
            <Icon name="plus" size={14} />
          </Button>
        </div>
        <span className="ux4g-body-s-default sf-designer-muted">
          Drag a step to move it · drag the round handle onto another step to connect · arrows move
          the focused step
        </span>
      </div>
      <div
        className="sf-wf-scroll"
        onDragOver={(e) => {
          if (!readOnly && Array.from(e.dataTransfer.types).includes(NODE_KIND_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const kind = e.dataTransfer.getData(NODE_KIND_MIME) as NodeKind;
          if (!kind || readOnly) return;
          e.preventDefault();
          const p = toSvg(e.clientX, e.clientY);
          actions.dropKind(kind, p.x - 40, p.y - 28);
        }}
      >
        <svg
          ref={svgRef}
          className="sf-wf-svg"
          width={width * zoom}
          height={height * zoom}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`${design.title}: ${design.nodes.length} steps, ${design.edges.length} paths`}
          onPointerMove={onSvgMove}
          onPointerUp={onSvgUp}
          onPointerDown={(e) => {
            if (e.target === svgRef.current) actions.select({ kind: 'workflow' });
          }}
        >
          <defs>
            <pattern id="sf-wf-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path className="sf-wf-grid-line" d="M 24 0 L 0 0 0 24" fill="none" />
            </pattern>
            <marker
              id="sf-wf-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path className="sf-wf-arrow" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <rect className="sf-wf-grid" width={width} height={height} />
          <g aria-hidden="true">
            {design.edges.map((e: FlowEdge) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const { d, label } = edgePath(a, b);
              const selected = selection.kind === 'edge' && selection.id === e.id;
              const text = e.outcome ?? (e.ruleRef ? `rule ${e.ruleRef}` : '');
              return (
                <g
                  key={e.id}
                  className={`sf-wf-edge${selected ? ' sf-wf-selected' : ''}${errorEdges.has(e.id) ? ' sf-wf-error' : ''}`}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    actions.select({ kind: 'edge', id: e.id });
                  }}
                >
                  <path className="sf-wf-edge-hit" d={d} />
                  <path className="sf-wf-edge-line" d={d} markerEnd="url(#sf-wf-arrow)" />
                  {text ? (
                    <g transform={`translate(${label.x}, ${label.y})`}>
                      <rect
                        className="sf-wf-edge-label-bg"
                        x={-(text.length * 3.4) - 6}
                        y={-10}
                        width={text.length * 6.8 + 12}
                        height={20}
                        rx={10}
                      />
                      <text className="sf-wf-edge-label" textAnchor="middle" dy="4">
                        {text}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
          {design.nodes.map((n) => {
            const { w, h } = sizeOf(n.kind);
            const selected = selection.kind === 'node' && selection.id === n.id;
            const info = KIND_INFO[n.kind];
            const lines = wrap(n.label || n.id, info.shape === 'rect' ? 22 : 18);
            const showText = info.shape === 'rect' || info.shape === 'hexagon';
            return (
              <g
                key={n.id}
                data-node-id={n.id}
                className={`sf-wf-node sf-wf-${n.kind.toLowerCase()} sf-wf-shape-${info.shape}${selected ? ' sf-wf-selected' : ''}${errorNodes.has(n.id) ? ' sf-wf-error' : ''}`}
                transform={`translate(${n.x}, ${n.y})`}
                tabIndex={0}
                role="button"
                aria-pressed={selected}
                aria-label={`${info.label}: ${n.label || n.id} (${n.id})${errorNodes.has(n.id) ? ', has errors' : ''}`}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPointerMove={onNodeMove}
                onPointerUp={onNodeUp}
                onKeyDown={(e) => onNodeKey(e, n)}
              >
                {shapeFor(n)}
                {showText ? (
                  <>
                    <text className="sf-wf-kind" x={w / 2} y={14} textAnchor="middle">
                      {info.label.toUpperCase()}
                    </text>
                    {lines.map((l, i) => (
                      <text
                        key={i}
                        className="sf-wf-label"
                        x={w / 2}
                        y={h / 2 + 6 + i * 15 - (lines.length - 1) * 4}
                        textAnchor="middle"
                      >
                        {l}
                      </text>
                    ))}
                  </>
                ) : (
                  lines.map((l, i) => (
                    <text
                      key={i}
                      className="sf-wf-label"
                      x={w / 2}
                      y={h + 16 + i * 14}
                      textAnchor="middle"
                    >
                      {l}
                    </text>
                  ))
                )}
                {n.kind === 'HUMAN_TASK' && n.assignment ? (
                  <text className="sf-wf-kind" x={w / 2} y={h - 6} textAnchor="middle">
                    {n.assignment.role_code}
                  </text>
                ) : null}
                {readOnly || n.kind === 'END' ? null : (
                  <circle
                    className="sf-wf-handle"
                    cx={w}
                    cy={h / 2}
                    r={7}
                    aria-hidden="true"
                    onPointerDown={(e) => onHandleDown(e, n)}
                  />
                )}
              </g>
            );
          })}
          {link && linkFrom ? (
            <path
              className="sf-wf-edge-line sf-wf-linking"
              d={`M ${linkFrom.x + sizeOf(linkFrom.kind).w} ${linkFrom.y + sizeOf(linkFrom.kind).h / 2} L ${link.to.x} ${link.to.y}`}
              markerEnd="url(#sf-wf-arrow)"
            />
          ) : null}
        </svg>
      </div>
      {selection.kind === 'edge' && !readOnly ? (
        <div className="sf-actions">
          <Button
            variant="outline-danger"
            size="s"
            onClick={() => actions.removeEdge(selection.id)}
          >
            <Icon name="trash" size={16} /> Delete selected path
          </Button>
        </div>
      ) : null}
    </section>
  );
}
