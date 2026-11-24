'use client';

import { Alert, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  SLA_TEMPLATES,
  addSlaClock,
  blankSla,
  buildSlaDocument,
  lintSla,
  moveSlaClock,
  removeSlaClock,
  slaDocumentOf,
  slaHasErrors,
  updateSla,
  updateSlaClock,
  type CompiledSla,
  type SlaDesign,
} from '@serviceform/studio-designers/sla';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '../../lib/designer-history';
import { nextMinor, type WorkflowSourceRef } from '../../lib/designer-source';
import { explain, metadataApi, readSession, type SessionState } from '../../lib/studio-api';
import type { DocState } from '../forms/DesignerPublish';
import { ChecksPanel } from '../meta/ChecksPanel';
import { KindPublish } from '../meta/KindPublish';

type Tab = 'design' | 'schema' | 'publish';

function initial(source: WorkflowSourceRef): SlaDesign {
  if (source.kind === 'template') {
    const t = SLA_TEMPLATES.find((x) => x.id === source.id);
    if (t) return t.create();
  }
  return blankSla();
}

/** Studio SLA designer: CMP-033 SLA clocks (duration_iso). SAMPLE_LAB overlays; not CERTIFIED. */
export function SlaDesigner({ source }: { source: WorkflowSourceRef }) {
  const history = useHistory<SlaDesign>(() => initial(source));
  const design = history.value;
  const [tab, setTab] = useState<Tab>('design');
  const [selected, setSelected] = useState<string | null>(design.clocks[0]?.id ?? null);
  const [compiled, setCompiled] = useState<CompiledSla | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(false);

  const issues = useMemo(() => lintSla(design), [design]);
  const blocked = slaHasErrors(issues);
  const readOnly = doc?.status === 'PUBLISHED' && compiled?.contentHash === doc.savedHash;
  const selectedClock = design.clocks.find((c) => c.id === selected) ?? null;

  useEffect(() => {
    let live = true;
    void buildSlaDocument(design).then((c) => {
      if (live) setCompiled(c);
    });
    return () => {
      live = false;
    };
  }, [design]);

  useEffect(() => {
    void readSession().then(setSession);
  }, []);

  useEffect(() => {
    if (source.kind !== 'document' || loaded.current) return;
    loaded.current = true;
    void metadataApi.read(source.id).then((res) => {
      if (!res.ok) return setLoadError(explain(res.error));
      const found = slaDocumentOf(res.body.payload);
      if (!found)
        return setLoadError('This metadata document was not authored with the SLA designer.');
      history.reset(found.design);
      setSelected(found.design.clocks[0]?.id ?? null);
      setDoc({
        id: res.body.document_id,
        key: res.body.document_key,
        status: res.body.status,
        savedHash: found.contentHash,
      });
    });
  }, [source, history]);

  const apply = useCallback(
    (next: SlaDesign, coalesce?: string) => {
      if (!readOnly) history.apply(next, coalesce);
    },
    [history, readOnly],
  );

  const status = doc
    ? doc.savedHash === compiled?.contentHash
      ? doc.status === 'PUBLISHED'
        ? 'FROZEN'
        : doc.status
      : 'UNSAVED CHANGES'
    : 'NOT SAVED';

  return (
    <div className="sf-designer">
      <header className="sf-designer-bar">
        <div className="sf-designer-bar-title">
          <p className="ux4g-label-s-default sf-designer-muted">
            SLA designer · CMP-033 SLA · CMP-029 runtime clocks
          </p>
          <h1 className="ux4g-heading-m-strong">{design.title || 'Untitled SLA pack'}</h1>
          <div className="sf-tag-row">
            <code className="sf-hash">{compiled?.documentKey ?? design.packKey}</code>
            <span className="ux4g-tag-tonal-neutral">{status}</span>
            {compiled ? (
              <code className="sf-hash" title={compiled.contentHash}>
                {shortHash(compiled.contentHash)}
              </code>
            ) : null}
            <span className="ux4g-tag-outline-warning">SAMPLE_LAB · not CERTIFIED</span>
          </div>
        </div>
        <div className="sf-designer-bar-actions">
          <Button
            variant="outline-primary"
            disabled={!history.canUndo || readOnly}
            onClick={() => history.undo()}
          >
            Undo
          </Button>
          <Button
            variant="outline-primary"
            disabled={!history.canRedo || readOnly}
            onClick={() => history.redo()}
          >
            Redo
          </Button>
          {doc?.status === 'PUBLISHED' ? (
            <Button
              variant="outline-primary"
              onClick={() => {
                history.reset({ ...design, version: nextMinor(design.version) });
                setDoc(null);
              }}
            >
              New version
            </Button>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <Alert variant="error" title="Could not open draft">
          {loadError}
        </Alert>
      ) : null}
      {design.notStatutory ? (
        <Alert variant="warning" title="Not statutory">
          SAMPLE_LAB SLA durations are lab overlays. Do not invent statutory service times.
        </Alert>
      ) : null}

      <div className="sf-designer-tabs" role="tablist" aria-label="Designer views">
        {(
          [
            ['design', 'Design'],
            ['schema', 'Schema'],
            ['publish', 'Publish'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`sf-designer-tab${tab === id ? ' sf-designer-tab-current' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'design' ? (
          <div className="sf-designer-publish-grid">
            <section className="sf-designer-pane" aria-labelledby="sla-pack-title">
              <h2 id="sla-pack-title" className="ux4g-label-l-strong">
                SLA pack
              </h2>
              <fieldset className="sf-designer-fieldset" disabled={readOnly}>
                <TextInput
                  id="sla-title"
                  label="Title"
                  value={design.title}
                  onChange={(e) => apply(updateSla(design, { title: e.target.value }), 'sla-title')}
                />
                <TextInput
                  id="sla-pack-key"
                  label="Pack key"
                  value={design.packKey}
                  onChange={(e) => apply(updateSla(design, { packKey: e.target.value }), 'sla-key')}
                />
                <TextInput
                  id="sla-version"
                  label="Version"
                  value={design.version}
                  onChange={(e) => apply(updateSla(design, { version: e.target.value }), 'sla-ver')}
                />
                <TextInput
                  id="sla-start"
                  label="Start event label"
                  value={design.startEventLabel}
                  onChange={(e) =>
                    apply(updateSla(design, { startEventLabel: e.target.value }), 'sla-start')
                  }
                />
                <TextInput
                  id="sla-complete"
                  label="Completion label"
                  value={design.completionLabel}
                  onChange={(e) =>
                    apply(updateSla(design, { completionLabel: e.target.value }), 'sla-end')
                  }
                />
                <Checkbox
                  id="sla-not-statutory"
                  label="Not statutory (SAMPLE_LAB / DUMMY overlay)"
                  checked={design.notStatutory}
                  onChange={(e) => apply(updateSla(design, { notStatutory: e.target.checked }))}
                />
              </fieldset>

              <div className="sf-designer-inspector-head">
                <h3 className="ux4g-label-l-strong">Clocks</h3>
                <Button
                  variant="outline-primary"
                  disabled={readOnly}
                  onClick={() => {
                    const { design: next, id } = addSlaClock(design);
                    apply(next);
                    setSelected(id);
                  }}
                >
                  Add clock
                </Button>
              </div>
              <div className="sf-table-wrap">
                <table className="sf-table">
                  <caption>CMP-033 SLA clocks (duration_iso)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Label</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {design.clocks.map((clock, index) => (
                      <tr key={clock.id} aria-current={clock.id === selected ? 'true' : undefined}>
                        <th scope="row">
                          <button
                            type="button"
                            className="ux4g-btn-text-neutral ux4g-btn-s"
                            aria-label={`Edit clock ${clock.label}`}
                            onClick={() => setSelected(clock.id)}
                          >
                            <code className="sf-hash">{clock.key}</code>
                          </button>
                        </th>
                        <td>{clock.label}</td>
                        <td>
                          <code className="sf-hash">{clock.duration_iso}</code>
                        </td>
                        <td>
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || index === 0}
                            onClick={() => apply(moveSlaClock(design, clock.id, -1))}
                          >
                            Up
                          </Button>{' '}
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || index === design.clocks.length - 1}
                            onClick={() => apply(moveSlaClock(design, clock.id, 1))}
                          >
                            Down
                          </Button>{' '}
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || design.clocks.length <= 1}
                            onClick={() => {
                              apply(removeSlaClock(design, clock.id));
                              if (selected === clock.id) setSelected(null);
                            }}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedClock ? (
                <fieldset className="sf-designer-fieldset" disabled={readOnly}>
                  <legend className="ux4g-label-l-strong">Selected clock</legend>
                  <TextInput
                    id="sla-clock-key"
                    label="Clock key"
                    value={selectedClock.key}
                    onChange={(e) =>
                      apply(
                        updateSlaClock(design, selectedClock.id, { key: e.target.value }),
                        'sla-ck',
                      )
                    }
                  />
                  <TextInput
                    id="sla-clock-label"
                    label="Label"
                    value={selectedClock.label}
                    onChange={(e) =>
                      apply(
                        updateSlaClock(design, selectedClock.id, { label: e.target.value }),
                        'sla-cl',
                      )
                    }
                  />
                  <TextInput
                    id="sla-clock-duration"
                    label="Duration (ISO-8601)"
                    value={selectedClock.duration_iso}
                    onChange={(e) =>
                      apply(
                        updateSlaClock(design, selectedClock.id, { duration_iso: e.target.value }),
                        'sla-cd',
                      )
                    }
                  />
                  <TextInput
                    id="sla-clock-pause"
                    label="Pause reason codes (comma-separated)"
                    value={selectedClock.pause_reason_codes.join(', ')}
                    onChange={(e) =>
                      apply(
                        updateSlaClock(design, selectedClock.id, {
                          pause_reason_codes: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }),
                        'sla-cp',
                      )
                    }
                  />
                </fieldset>
              ) : null}
            </section>
            <ChecksPanel issues={issues} />
          </div>
        ) : null}

        {tab === 'schema' ? (
          <pre className="sf-designer-code" data-testid="sla-schema">
            {compiled ? JSON.stringify(compiled.payload, null, 2) : 'Compiling…'}
          </pre>
        ) : null}

        {tab === 'publish' ? (
          <KindPublish
            kind="SLA"
            kindLabel="SLA pack"
            title={design.title}
            documentKey={compiled?.documentKey ?? ''}
            contentHash={compiled?.contentHash ?? null}
            payload={compiled?.payload ?? null}
            blocked={blocked}
            doc={doc}
            onDoc={setDoc}
            session={session}
          />
        ) : null}
      </div>
    </div>
  );
}
