'use client';

import { Alert, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import {
  CREDENTIAL_TEMPLATES,
  blankCredential,
  buildCredentialDocument,
  credentialDocumentOf,
  credentialHasErrors,
  lintCredential,
  updateCredential,
  type CompiledCredential,
  type CredentialDesign,
} from '@serviceform/studio-designers/credential';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '../../lib/designer-history';
import { nextMinor, type WorkflowSourceRef } from '../../lib/designer-source';
import { explain, metadataApi, readSession, type SessionState } from '../../lib/studio-api';
import type { DocState } from '../forms/DesignerPublish';
import { ChecksPanel } from '../meta/ChecksPanel';
import { KindPublish } from '../meta/KindPublish';

type Tab = 'design' | 'schema' | 'publish';

function initial(source: WorkflowSourceRef): CredentialDesign {
  if (source.kind === 'template') {
    const t = CREDENTIAL_TEMPLATES.find((x) => x.id === source.id);
    if (t) return t.create();
  }
  return blankCredential();
}

/**
 * Studio credential designer: CMP-033 CREDENTIAL template_key + DigiLocker label overlays.
 * SAMPLE_LAB_DUMMY OK; SIM publish only. Not CERTIFIED.
 */
export function CredentialDesigner({ source }: { source: WorkflowSourceRef }) {
  const history = useHistory<CredentialDesign>(() => initial(source));
  const design = history.value;
  const [tab, setTab] = useState<Tab>('design');
  const [compiled, setCompiled] = useState<CompiledCredential | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(false);

  const issues = useMemo(() => lintCredential(design), [design]);
  const blocked = credentialHasErrors(issues);
  const readOnly = doc?.status === 'PUBLISHED' && compiled?.contentHash === doc.savedHash;

  useEffect(() => {
    let live = true;
    void buildCredentialDocument(design).then((c) => {
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
      const found = credentialDocumentOf(res.body.payload);
      if (!found)
        return setLoadError(
          'This metadata document was not authored with the credential designer.',
        );
      history.reset(found.design);
      setDoc({
        id: res.body.document_id,
        key: res.body.document_key,
        status: res.body.status,
        savedHash: found.contentHash,
      });
    });
  }, [source, history]);

  const apply = useCallback(
    (next: CredentialDesign, coalesce?: string) => {
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
            Credential designer · CMP-033 CREDENTIAL · DigiLocker SIM label
          </p>
          <h1 className="ux4g-heading-m-strong">{design.title || 'Untitled credential'}</h1>
          <div className="sf-tag-row">
            <code className="sf-hash">{compiled?.documentKey ?? design.packKey}</code>
            <span className="ux4g-tag-tonal-neutral">{status}</span>
            {compiled ? (
              <code className="sf-hash" title={compiled.contentHash}>
                {shortHash(compiled.contentHash)}
              </code>
            ) : null}
            <span className="ux4g-tag-outline-warning">SAMPLE_LAB · SIM · not CERTIFIED</span>
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
          DigiLocker labels and template keys here are SAMPLE_LAB overlays. REAL DigiLocker remains
          owner-held for G6.
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
            <section className="sf-designer-pane" aria-labelledby="cred-pack-title">
              <h2 id="cred-pack-title" className="ux4g-label-l-strong">
                Credential template
              </h2>
              <fieldset className="sf-designer-fieldset" disabled={readOnly}>
                <TextInput
                  id="cred-title"
                  label="Title"
                  value={design.title}
                  onChange={(e) =>
                    apply(updateCredential(design, { title: e.target.value }), 'cred-title')
                  }
                />
                <TextInput
                  id="cred-pack-key"
                  label="Pack key"
                  value={design.packKey}
                  onChange={(e) =>
                    apply(updateCredential(design, { packKey: e.target.value }), 'cred-key')
                  }
                />
                <TextInput
                  id="cred-version"
                  label="Version"
                  value={design.version}
                  onChange={(e) =>
                    apply(updateCredential(design, { version: e.target.value }), 'cred-ver')
                  }
                />
                <TextInput
                  id="cred-template-key"
                  label="Template key"
                  value={design.templateKey}
                  onChange={(e) =>
                    apply(updateCredential(design, { templateKey: e.target.value }), 'cred-tk')
                  }
                />
                <TextInput
                  id="cred-display"
                  label="Citizen display title"
                  value={design.displayTitle}
                  onChange={(e) =>
                    apply(updateCredential(design, { displayTitle: e.target.value }), 'cred-dt')
                  }
                />
                <TextInput
                  id="cred-digilocker"
                  label="DigiLocker / wallet label"
                  value={design.digilockerLabel}
                  onChange={(e) =>
                    apply(updateCredential(design, { digilockerLabel: e.target.value }), 'cred-dl')
                  }
                />
                <Checkbox
                  id="cred-not-statutory"
                  label="Not statutory (SAMPLE_LAB / DUMMY overlay)"
                  checked={design.notStatutory}
                  onChange={(e) =>
                    apply(updateCredential(design, { notStatutory: e.target.checked }))
                  }
                />
              </fieldset>
            </section>
            <ChecksPanel issues={issues} />
          </div>
        ) : null}

        {tab === 'schema' ? (
          <pre className="sf-designer-code" data-testid="credential-schema">
            {compiled ? JSON.stringify(compiled.payload, null, 2) : 'Compiling…'}
          </pre>
        ) : null}

        {tab === 'publish' ? (
          <KindPublish
            kind="CREDENTIAL"
            kindLabel="credential template"
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
