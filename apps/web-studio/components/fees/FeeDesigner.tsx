'use client';

import { Alert, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  FEE_TEMPLATES,
  addFeeItem,
  blankFee,
  buildFeeDocument,
  feeDocumentOf,
  feeHasErrors,
  lintFee,
  moveFeeItem,
  removeFeeItem,
  updateFee,
  updateFeeItem,
  type CompiledFee,
  type FeeDesign,
} from '@serviceform/studio-designers/fee';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '../../lib/designer-history';
import { nextMinor, type WorkflowSourceRef } from '../../lib/designer-source';
import { explain, metadataApi, readSession, type SessionState } from '../../lib/studio-api';
import type { DocState } from '../forms/DesignerPublish';
import { ChecksPanel } from '../meta/ChecksPanel';
import { KindPublish } from '../meta/KindPublish';

type Tab = 'design' | 'schema' | 'publish';

function initial(source: WorkflowSourceRef): FeeDesign {
  if (source.kind === 'template') {
    const t = FEE_TEMPLATES.find((x) => x.id === source.id);
    if (t) return t.create();
  }
  return blankFee();
}

/**
 * ServiceForm Studio fee designer: author CMP-033 FEE items (amount_minor), with SAMPLE_LAB_DUMMY
 * labels for lab overlays. Publish via CMP-033 → CMP-051 maker-checker. Not CERTIFIED.
 */
export function FeeDesigner({ source }: { source: WorkflowSourceRef }) {
  const history = useHistory<FeeDesign>(() => initial(source));
  const design = history.value;
  const [tab, setTab] = useState<Tab>('design');
  const [selected, setSelected] = useState<string | null>(design.items[0]?.id ?? null);
  const [compiled, setCompiled] = useState<CompiledFee | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const loaded = useRef(false);

  const issues = useMemo(() => lintFee(design), [design]);
  const blocked = feeHasErrors(issues);
  const readOnly = doc?.status === 'PUBLISHED' && compiled?.contentHash === doc.savedHash;
  const selectedItem = design.items.find((i) => i.id === selected) ?? null;

  useEffect(() => {
    let live = true;
    void buildFeeDocument(design).then((c) => {
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
      const found = feeDocumentOf(res.body.payload);
      if (!found)
        return setLoadError('This metadata document was not authored with the fee designer.');
      history.reset(found.design);
      setSelected(found.design.items[0]?.id ?? null);
      setDoc({
        id: res.body.document_id,
        key: res.body.document_key,
        status: res.body.status,
        savedHash: found.contentHash,
      });
    });
  }, [source, history]);

  const apply = useCallback(
    (next: FeeDesign, coalesce?: string) => {
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
            Fee designer · CMP-033 FEE · SAMPLE_LAB overlays
          </p>
          <h1 className="ux4g-heading-m-strong">{design.title || 'Untitled fee schedule'}</h1>
          <div className="sf-tag-row">
            <code className="sf-hash">{compiled?.documentKey ?? design.packKey}</code>
            <span className="ux4g-tag-tonal-neutral">{status}</span>
            {compiled ? (
              <code className="sf-hash" title={compiled.contentHash}>
                {shortHash(compiled.contentHash)}
              </code>
            ) : null}
            <span className="ux4g-tag-outline-warning">
              {design.policyKind === 'SAMPLE_LAB_DUMMY'
                ? 'SAMPLE_LAB_DUMMY · not statute'
                : design.policyKind}
            </span>
            <span className="ux4g-tag-outline-warning">CERTIFIED=false · G6=false</span>
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
                setNotice(`Started version ${nextMinor(design.version)}.`);
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
      {notice ? (
        <Alert variant="info" title="Notice">
          {notice}
        </Alert>
      ) : null}
      {design.notStatutory ? (
        <Alert variant="warning" title="Not statutory">
          SAMPLE_LAB fee overlays are configurable lab parameters. Do not present them as real
          government fee schedules.
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

      <div className="sf-designer-panel" role="tabpanel">
        {tab === 'design' ? (
          <div className="sf-designer-publish-grid">
            <section className="sf-designer-pane" aria-labelledby="fee-pack-title">
              <h2 id="fee-pack-title" className="ux4g-label-l-strong">
                Fee pack
              </h2>
              <fieldset className="sf-designer-fieldset" disabled={readOnly}>
                <TextInput
                  id="fee-title"
                  label="Title"
                  value={design.title}
                  onChange={(e) => apply(updateFee(design, { title: e.target.value }), 'fee-title')}
                />
                <TextInput
                  id="fee-pack-key"
                  label="Pack key"
                  value={design.packKey}
                  onChange={(e) =>
                    apply(updateFee(design, { packKey: e.target.value }), 'fee-pack-key')
                  }
                />
                <TextInput
                  id="fee-version"
                  label="Version"
                  value={design.version}
                  onChange={(e) =>
                    apply(updateFee(design, { version: e.target.value }), 'fee-version')
                  }
                />
                <TextInput
                  id="fee-currency"
                  label="Currency"
                  value={design.currency}
                  onChange={(e) =>
                    apply(updateFee(design, { currency: e.target.value }), 'fee-currency')
                  }
                />
                <TextInput
                  id="fee-amount-display"
                  label="Citizen amount display"
                  value={design.amountDisplay}
                  onChange={(e) =>
                    apply(updateFee(design, { amountDisplay: e.target.value }), 'fee-display')
                  }
                />
                <TextInput
                  id="fee-schedule-ref"
                  label="Fee schedule ref"
                  value={design.feeScheduleRef}
                  onChange={(e) =>
                    apply(updateFee(design, { feeScheduleRef: e.target.value }), 'fee-sched')
                  }
                />
                <Checkbox
                  id="fee-not-statutory"
                  label="Not statutory (SAMPLE_LAB / DUMMY overlay)"
                  checked={design.notStatutory}
                  onChange={(e) => apply(updateFee(design, { notStatutory: e.target.checked }))}
                />
              </fieldset>

              <div className="sf-designer-inspector-head">
                <h3 className="ux4g-label-l-strong">Fee lines</h3>
                <Button
                  variant="outline-primary"
                  disabled={readOnly}
                  onClick={() => {
                    const { design: next, id } = addFeeItem(design);
                    apply(next);
                    setSelected(id);
                  }}
                >
                  Add line
                </Button>
              </div>
              <div className="sf-table-wrap">
                <table className="sf-table">
                  <caption>CMP-033 FEE items (amount_minor)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Label</th>
                      <th scope="col">Amount (paise)</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {design.items.map((item, index) => (
                      <tr key={item.id} aria-current={item.id === selected ? 'true' : undefined}>
                        <th scope="row">
                          <button
                            type="button"
                            className="ux4g-btn-ghost ux4g-btn-s"
                            aria-label={`Edit fee line ${item.label}`}
                            onClick={() => setSelected(item.id)}
                          >
                            <code className="sf-hash">{item.key}</code>
                          </button>
                        </th>
                        <td>{item.label}</td>
                        <td>{item.amount_minor}</td>
                        <td>
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || index === 0}
                            onClick={() => apply(moveFeeItem(design, item.id, -1))}
                          >
                            Up
                          </Button>{' '}
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || index === design.items.length - 1}
                            onClick={() => apply(moveFeeItem(design, item.id, 1))}
                          >
                            Down
                          </Button>{' '}
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || design.items.length <= 1}
                            onClick={() => {
                              apply(removeFeeItem(design, item.id));
                              if (selected === item.id) setSelected(null);
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

              {selectedItem ? (
                <fieldset className="sf-designer-fieldset" disabled={readOnly}>
                  <legend className="ux4g-label-l-strong">Selected line</legend>
                  <TextInput
                    id="fee-item-key"
                    label="Line key"
                    value={selectedItem.key}
                    onChange={(e) =>
                      apply(
                        updateFeeItem(design, selectedItem.id, { key: e.target.value }),
                        'fee-item-key',
                      )
                    }
                  />
                  <TextInput
                    id="fee-item-label"
                    label="Label"
                    value={selectedItem.label}
                    onChange={(e) =>
                      apply(
                        updateFeeItem(design, selectedItem.id, { label: e.target.value }),
                        'fee-item-label',
                      )
                    }
                  />
                  <TextInput
                    id="fee-item-amount"
                    label="Amount (minor units / paise)"
                    value={String(selectedItem.amount_minor)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      apply(
                        updateFeeItem(design, selectedItem.id, {
                          amount_minor: Number.isFinite(n) ? Math.trunc(n) : 0,
                        }),
                        'fee-item-amount',
                      );
                    }}
                  />
                  <TextInput
                    id="fee-item-desc"
                    label="Description code (optional)"
                    value={selectedItem.description_code ?? ''}
                    onChange={(e) => {
                      const next = e.target.value.trim();
                      const items = design.items.map((i) => {
                        if (i.id !== selectedItem.id) return i;
                        if (!next) {
                          const { description_code: _drop, ...rest } = i;
                          return rest;
                        }
                        return { ...i, description_code: next };
                      });
                      apply({ ...design, items }, 'fee-item-desc');
                    }}
                  />
                </fieldset>
              ) : null}
            </section>
            <ChecksPanel issues={issues} />
          </div>
        ) : null}

        {tab === 'schema' ? (
          <div className="sf-designer-schema">
            <p className="ux4g-body-s-default sf-designer-muted">
              Structural pin is the content_hash of fee items. Authoring (labels, SAMPLE_LAB flags)
              travels with the draft but is not part of the pin.
            </p>
            <pre className="sf-designer-code" data-testid="fee-schema">
              {compiled ? JSON.stringify(compiled.payload, null, 2) : 'Compiling…'}
            </pre>
          </div>
        ) : null}

        {tab === 'publish' ? (
          <KindPublish
            kind="FEE"
            kindLabel="fee schedule"
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
