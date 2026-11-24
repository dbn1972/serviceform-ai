'use client';

import { Alert, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  EVIDENCE_TEMPLATES,
  addEvidenceRequirement,
  blankEvidence,
  buildEvidenceDocument,
  evidenceDocumentOf,
  evidenceHasErrors,
  lintEvidence,
  moveEvidenceRequirement,
  removeEvidenceRequirement,
  updateEvidence,
  updateEvidenceRequirement,
  type CompiledEvidence,
  type EvidenceDesign,
} from '@serviceform/studio-designers/evidence';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '../../lib/designer-history';
import { nextMinor, type WorkflowSourceRef } from '../../lib/designer-source';
import { explain, metadataApi, readSession, type SessionState } from '../../lib/studio-api';
import type { DocState } from '../forms/DesignerPublish';
import { ChecksPanel } from '../meta/ChecksPanel';
import { KindPublish } from '../meta/KindPublish';

type Tab = 'design' | 'schema' | 'publish';

function initial(source: WorkflowSourceRef): EvidenceDesign {
  if (source.kind === 'template') {
    const t = EVIDENCE_TEMPLATES.find((x) => x.id === source.id);
    if (t) return t.create();
  }
  return blankEvidence();
}

/** Studio evidence designer: CMP-033 EVIDENCE requirements. SAMPLE_LAB_DUMMY OK; not CERTIFIED. */
export function EvidenceDesigner({ source }: { source: WorkflowSourceRef }) {
  const history = useHistory<EvidenceDesign>(() => initial(source));
  const design = history.value;
  const [tab, setTab] = useState<Tab>('design');
  const [selected, setSelected] = useState<string | null>(design.requirements[0]?.id ?? null);
  const [compiled, setCompiled] = useState<CompiledEvidence | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(false);

  const issues = useMemo(() => lintEvidence(design), [design]);
  const blocked = evidenceHasErrors(issues);
  const readOnly = doc?.status === 'PUBLISHED' && compiled?.contentHash === doc.savedHash;
  const selectedReq = design.requirements.find((r) => r.id === selected) ?? null;

  useEffect(() => {
    let live = true;
    void buildEvidenceDocument(design).then((c) => {
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
      const found = evidenceDocumentOf(res.body.payload);
      if (!found)
        return setLoadError('This metadata document was not authored with the evidence designer.');
      history.reset(found.design);
      setSelected(found.design.requirements[0]?.id ?? null);
      setDoc({
        id: res.body.document_id,
        key: res.body.document_key,
        status: res.body.status,
        savedHash: found.contentHash,
      });
    });
  }, [source, history]);

  const apply = useCallback(
    (next: EvidenceDesign, coalesce?: string) => {
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
            Evidence designer · CMP-033 EVIDENCE · upload accept ≠ business verify
          </p>
          <h1 className="ux4g-heading-m-strong">{design.title || 'Untitled evidence pack'}</h1>
          <div className="sf-tag-row">
            <code className="sf-hash">{compiled?.documentKey ?? design.packKey}</code>
            <span className="ux4g-tag-tonal-neutral">{status}</span>
            {compiled ? (
              <code className="sf-hash" title={compiled.contentHash}>
                {shortHash(compiled.contentHash)}
              </code>
            ) : null}
            <span className="ux4g-tag-outline-warning">SAMPLE_LAB_DUMMY OK · not CERTIFIED</span>
          </div>
        </div>
        <div className="sf-designer-bar-actions">
          <Button variant="outline-primary" disabled={!history.canUndo || readOnly} onClick={() => history.undo()}>
            Undo
          </Button>
          <Button variant="outline-primary" disabled={!history.canRedo || readOnly} onClick={() => history.redo()}>
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
          Evidence lists here are SAMPLE_LAB configurable overlays. Officers still verify business
          meaning; technical upload accept is not approval.
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
            <section className="sf-designer-pane" aria-labelledby="evd-pack-title">
              <h2 id="evd-pack-title" className="ux4g-label-l-strong">
                Evidence pack
              </h2>
              <fieldset className="sf-designer-fieldset" disabled={readOnly}>
                <TextInput
                  id="evd-title"
                  label="Title"
                  value={design.title}
                  onChange={(e) =>
                    apply(updateEvidence(design, { title: e.target.value }), 'evd-title')
                  }
                />
                <TextInput
                  id="evd-pack-key"
                  label="Pack key"
                  value={design.packKey}
                  onChange={(e) =>
                    apply(updateEvidence(design, { packKey: e.target.value }), 'evd-key')
                  }
                />
                <TextInput
                  id="evd-version"
                  label="Version"
                  value={design.version}
                  onChange={(e) =>
                    apply(updateEvidence(design, { version: e.target.value }), 'evd-ver')
                  }
                />
                <Checkbox
                  id="evd-not-statutory"
                  label="Not statutory (SAMPLE_LAB / DUMMY overlay)"
                  checked={design.notStatutory}
                  onChange={(e) =>
                    apply(updateEvidence(design, { notStatutory: e.target.checked }))
                  }
                />
              </fieldset>

              <div className="sf-designer-inspector-head">
                <h3 className="ux4g-label-l-strong">Requirements</h3>
                <Button
                  variant="outline-primary"
                  disabled={readOnly}
                  onClick={() => {
                    const { design: next, id } = addEvidenceRequirement(design);
                    apply(next);
                    setSelected(id);
                  }}
                >
                  Add requirement
                </Button>
              </div>
              <div className="sf-table-wrap">
                <table className="sf-table">
                  <caption>CMP-033 EVIDENCE requirements</caption>
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Label</th>
                      <th scope="col">Artifact type</th>
                      <th scope="col">Required</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {design.requirements.map((req, index) => (
                      <tr key={req.id} aria-current={req.id === selected ? 'true' : undefined}>
                        <th scope="row">
                          <button
                            type="button"
                            className="ux4g-btn-text-neutral ux4g-btn-s"
                            aria-label={`Edit requirement ${req.label}`}
                            onClick={() => setSelected(req.id)}
                          >
                            <code className="sf-hash">{req.key}</code>
                          </button>
                        </th>
                        <td>{req.label}</td>
                        <td>
                          <code className="sf-hash">{req.artifact_type}</code>
                        </td>
                        <td>{req.required ? 'Yes' : 'No'}</td>
                        <td>
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || index === 0}
                            onClick={() => apply(moveEvidenceRequirement(design, req.id, -1))}
                          >
                            Up
                          </Button>{' '}
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || index === design.requirements.length - 1}
                            onClick={() => apply(moveEvidenceRequirement(design, req.id, 1))}
                          >
                            Down
                          </Button>{' '}
                          <Button
                            variant="outline-primary"
                            disabled={readOnly || design.requirements.length <= 1}
                            onClick={() => {
                              apply(removeEvidenceRequirement(design, req.id));
                              if (selected === req.id) setSelected(null);
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

              {selectedReq ? (
                <fieldset className="sf-designer-fieldset" disabled={readOnly}>
                  <legend className="ux4g-label-l-strong">Selected requirement</legend>
                  <TextInput
                    id="evd-req-key"
                    label="Requirement key"
                    value={selectedReq.key}
                    onChange={(e) =>
                      apply(
                        updateEvidenceRequirement(design, selectedReq.id, { key: e.target.value }),
                        'evd-rk',
                      )
                    }
                  />
                  <TextInput
                    id="evd-req-label"
                    label="Label"
                    value={selectedReq.label}
                    onChange={(e) =>
                      apply(
                        updateEvidenceRequirement(design, selectedReq.id, {
                          label: e.target.value,
                        }),
                        'evd-rl',
                      )
                    }
                  />
                  <TextInput
                    id="evd-req-type"
                    label="Artifact type"
                    value={selectedReq.artifact_type}
                    onChange={(e) =>
                      apply(
                        updateEvidenceRequirement(design, selectedReq.id, {
                          artifact_type: e.target.value,
                        }),
                        'evd-rt',
                      )
                    }
                  />
                  <TextInput
                    id="evd-req-guidance"
                    label="Guidance (optional)"
                    value={selectedReq.guidance ?? ''}
                    onChange={(e) => {
                      const next = e.target.value;
                      const requirements = design.requirements.map((r) => {
                        if (r.id !== selectedReq.id) return r;
                        if (!next.trim()) {
                          const { guidance: _drop, ...rest } = r;
                          return rest;
                        }
                        return { ...r, guidance: next };
                      });
                      apply({ ...design, requirements }, 'evd-rg');
                    }}
                  />
                  <Checkbox
                    id="evd-req-required"
                    label="Required"
                    checked={selectedReq.required}
                    onChange={(e) =>
                      apply(
                        updateEvidenceRequirement(design, selectedReq.id, {
                          required: e.target.checked,
                        }),
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
          <pre className="sf-designer-code" data-testid="evidence-schema">
            {compiled ? JSON.stringify(compiled.payload, null, 2) : 'Compiling…'}
          </pre>
        ) : null}

        {tab === 'publish' ? (
          <KindPublish
            kind="EVIDENCE"
            kindLabel="evidence pack"
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
