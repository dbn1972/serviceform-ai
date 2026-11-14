'use client';

import { Alert, Button, Checkbox, Icon, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import type { CompiledForm } from '@serviceform/studio-designers/forms';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { rememberDraft } from '../../lib/recent-drafts';
import {
  bindingsApi,
  explain,
  formsApi,
  metadataApi,
  orderedPins,
  publicationApi,
  type ApiResult,
  type Binding,
  type Interpretation,
  type MetadataDocument,
  type PublicationRequest,
  type SessionState,
} from '../../lib/studio-api';

export interface DocState {
  id: string;
  key: string;
  status: MetadataDocument['status'];
  savedHash: string;
}

type StepState = 'done' | 'current' | 'todo';

function PublishStep({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  children: ReactNode;
}) {
  return (
    <li className={`sf-designer-publish-step sf-designer-publish-${state}`}>
      <span className="sf-designer-publish-index" aria-hidden="true">
        {state === 'done' ? <Icon name="check" size={16} /> : index}
      </span>
      <div className="sf-designer-publish-body">
        <h3 className="ux4g-label-l-strong">
          {title}
          <span className="ux4g-sr-only">
            {state === 'done' ? ' (done)' : state === 'current' ? ' (next)' : ' (not yet)'}
          </span>
        </h3>
        {children}
      </div>
    </li>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The publication path for a designed form: CMP-033 draft → validate → freeze (immutable) →
 * CMP-009 resolves the hash pin → a TenantServiceBinding draft pinning the frozen form goes to
 * CMP-051 maker-checker. The checker approves and publishes on the Publication desk.
 */
export function DesignerPublish({
  title,
  compiled,
  blocked,
  doc,
  onDoc,
  session,
}: {
  title: string;
  compiled: CompiledForm | null;
  blocked: boolean;
  doc: DocState | null;
  onDoc: (doc: DocState) => void;
  session: SessionState | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [baseId, setBaseId] = useState('');
  const [base, setBase] = useState<Binding | null>(null);
  const [reason, setReason] = useState('');
  const [proposal, setProposal] = useState<Binding | null>(null);
  const [request, setRequest] = useState<PublicationRequest | null>(null);

  const saved = doc !== null && compiled !== null && doc.savedHash === compiled.contentHash;
  const frozen = doc?.status === 'PUBLISHED';
  const keyChanged = doc !== null && compiled !== null && doc.key !== compiled.documentKey;

  async function run<T>(label: string, fn: () => Promise<ApiResult<T>>): Promise<T | null> {
    setBusy(label);
    setError('');
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      setError(explain(res.error));
      return null;
    }
    return res.body;
  }

  function track(d: MetadataDocument, hash: string) {
    const next = { id: d.document_id, key: d.document_key, status: d.status, savedHash: hash };
    onDoc(next);
    rememberDraft({ id: next.id, key: next.key, title, status: next.status });
  }

  async function save() {
    if (!compiled) return;
    const body =
      doc && !keyChanged && !frozen
        ? await run('save', () => metadataApi.patch(doc.id, compiled.payload))
        : await run('save', () =>
            metadataApi.create('FORM', compiled.documentKey, compiled.payload),
          );
    if (body) track(body, compiled.contentHash);
  }

  async function validate() {
    if (!doc || !compiled) return;
    const body = await run('validate', () => metadataApi.validate(doc.id));
    if (body) track(body, compiled.contentHash);
  }

  async function freeze() {
    if (!doc || !compiled) return;
    const body = await run('freeze', () => metadataApi.publish(doc.id));
    if (body) track(body, compiled.contentHash);
  }

  async function verify() {
    if (!doc || !compiled) return;
    const body = await run('verify', () =>
      formsApi.interpret({
        form_key: compiled.formPackage.form_id,
        version_id: doc.id,
        content_hash: compiled.contentHash,
      }),
    );
    if (body) setInterpretation(body);
  }

  async function loadBase() {
    if (!UUID_RE.test(baseId.trim())) {
      setError('Enter the id of the TenantServiceBinding this form version should replace.');
      return;
    }
    const body = await run('base', () => bindingsApi.read(baseId.trim()));
    if (body) setBase(body);
  }

  async function propose() {
    if (!doc || !compiled || !base) return;
    const binding = await run('propose', () =>
      bindingsApi.create({
        binding_key: base.binding_key,
        offering_ref: base.offering_ref,
        metadata_bundle_ref: base.metadata_bundle_ref,
        pins: { ...base.pins, form: { version_ref: doc.id, content_hash: compiled.contentHash } },
      }),
    );
    if (!binding) return;
    setProposal(binding);
    const created = await run('propose', () =>
      publicationApi.create(binding.binding_id, binding.artifact_hash),
    );
    if (!created) return;
    setRequest(created);
    const submitted = await run('propose', () =>
      publicationApi.submit(created.request_id, reason.trim()),
    );
    if (submitted) setRequest(submitted);
  }

  const status = (s: string) => (
    <span className={s === 'PUBLISHED' ? 'ux4g-tag-tonal-success' : 'ux4g-tag-tonal-warning'}>
      {s === 'PUBLISHED' ? 'FROZEN (CMP-033 PUBLISHED)' : s}
    </span>
  );

  const step1: StepState = saved ? 'done' : 'current';
  const step2: StepState =
    saved && doc && doc.status !== 'DRAFT' ? 'done' : saved ? 'current' : 'todo';
  const step3: StepState = frozen
    ? 'done'
    : doc?.status === 'VALIDATED' && saved
      ? 'current'
      : 'todo';
  const step4: StepState = interpretation ? 'done' : frozen ? 'current' : 'todo';
  const step5: StepState = request?.status === 'SUBMITTED' ? 'done' : frozen ? 'current' : 'todo';

  return (
    <div className="sf-designer-publish">
      {session && !session.authenticated ? (
        <Alert variant="warning" title="Sign in to publish">
          Saving and publishing call the platform as a SIMULATED Studio officer.{' '}
          <Link href="/session">Open the Session page</Link> and sign in as the designer (maker).
        </Alert>
      ) : null}
      {blocked ? (
        <Alert variant="error" title="Fix the checks first">
          The form has problems that CMP-033 or CMP-009 would refuse. See Checks on the Design tab.
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="Platform response">
          {error}
        </Alert>
      ) : null}

      <ol className="sf-designer-publish-steps">
        <PublishStep index={1} title="Save draft (CMP-033)" state={step1}>
          <p className="ux4g-body-s-default">
            Stores the FORM package with its content hash as a mutable draft metadata document.
          </p>
          {doc ? (
            <dl className="sf-dl sf-dl-compact">
              <dt>Document</dt>
              <dd>
                <code className="sf-hash" data-testid="designer-document-id">
                  {doc.id}
                </code>
              </dd>
              <dt>Key</dt>
              <dd>
                <code className="sf-hash">{doc.key}</code>
              </dd>
              <dt>Status</dt>
              <dd data-testid="designer-document-status">{status(doc.status)}</dd>
            </dl>
          ) : null}
          {keyChanged && !frozen ? (
            <p className="ux4g-body-s-default">
              The key or version changed, so saving creates a new draft document.
            </p>
          ) : null}
          <Button
            disabled={blocked || !compiled || saved || frozen || busy !== null}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Saving…' : doc && !keyChanged ? 'Save changes' : 'Save draft'}
          </Button>
        </PublishStep>

        <PublishStep index={2} title="Validate (CMP-033)" state={step2}>
          <p className="ux4g-body-s-default">
            CMP-033 checks the structure and recomputes the content hash of exactly what was saved.
          </p>
          <Button
            variant="outline-primary"
            disabled={!saved || doc?.status !== 'DRAFT' || busy !== null}
            onClick={() => void validate()}
          >
            {busy === 'validate' ? 'Validating…' : 'Validate'}
          </Button>
        </PublishStep>

        <PublishStep index={3} title="Freeze this version" state={step3}>
          <p className="ux4g-body-s-default">
            Freezing publishes the CMP-033 document: it can never change again, so the hash pin
            always means the same form. It is not live until a checker approves a service binding.
          </p>
          <Checkbox
            id="freeze-ack"
            label="I understand this version becomes immutable."
            checked={ack}
            disabled={doc?.status !== 'VALIDATED' || !saved}
            onChange={(e) => setAck(e.target.checked)}
          />
          <Button
            variant="outline-primary"
            disabled={!ack || doc?.status !== 'VALIDATED' || !saved || busy !== null}
            onClick={() => void freeze()}
          >
            {busy === 'freeze' ? 'Freezing…' : 'Freeze version'}
          </Button>
        </PublishStep>

        <PublishStep index={4} title="Verify the pin with CMP-009" state={step4}>
          <p className="ux4g-body-s-default">
            The forms runtime resolves the frozen version by key, version id and content hash and
            interprets it with UX4G renderer ids.
          </p>
          {doc && compiled && frozen ? (
            <dl className="sf-dl sf-dl-compact">
              <dt>form_key</dt>
              <dd>
                <code className="sf-hash">{compiled.formPackage.form_id}</code>
              </dd>
              <dt>version_id</dt>
              <dd>
                <code className="sf-hash">{doc.id}</code>
              </dd>
              <dt>content_hash</dt>
              <dd>
                <code className="sf-hash">{shortHash(compiled.contentHash)}</code>
              </dd>
            </dl>
          ) : null}
          <Button
            variant="outline-primary"
            disabled={!frozen || busy !== null}
            onClick={() => void verify()}
          >
            {busy === 'verify' ? 'Resolving…' : 'Resolve in CMP-009'}
          </Button>
          {interpretation ? (
            <Alert variant="success" title="CMP-009 resolved the pinned form">
              <span data-testid="designer-cmp009-result">
                {interpretation.controls.length} controls · renderers{' '}
                {interpretation.renderer_ids.join(', ')} · client validation authoritative:{' '}
                {String(interpretation.client_validation_authoritative)}
              </span>
            </Alert>
          ) : null}
        </PublishStep>

        <PublishStep index={5} title="Request publication (maker-checker)" state={step5}>
          <p className="ux4g-body-s-default">
            Applications pin a TenantServiceBinding, so a new form version reaches applicants only
            through a new binding version. Pick the binding to update; every other pin is carried
            forward unchanged. A different Studio officer must approve it.
          </p>
          <div className="sf-designer-row sf-designer-row-end">
            <TextInput
              id="publish-base"
              label="TenantServiceBinding id to update"
              value={baseId}
              disabled={!frozen}
              onChange={(e) => setBaseId(e.target.value)}
            />
            <Button
              variant="outline-primary"
              disabled={!frozen || busy !== null}
              onClick={() => void loadBase()}
            >
              Load binding
            </Button>
          </div>
          {base && compiled && doc ? (
            <div className="sf-table-wrap">
              <table className="sf-table">
                <caption>Pins of the proposed binding version ({base.binding_key})</caption>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Version ref</th>
                    <th scope="col">Content hash</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedPins({
                    ...base.pins,
                    form: { version_ref: doc.id, content_hash: compiled.contentHash },
                  }).map(([kind, pin]) => (
                    <tr key={kind} aria-current={kind === 'form' ? 'true' : undefined}>
                      <th scope="row">
                        {kind}
                        {kind === 'form' ? (
                          <span className="ux4g-tag-tonal-primary"> New</span>
                        ) : null}
                      </th>
                      <td>
                        <code className="sf-hash">{pin.version_ref}</code>
                      </td>
                      <td>
                        <code className="sf-hash">{shortHash(pin.content_hash)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <TextInput
            id="publish-reason"
            label="Reason for the change (shown to the checker)"
            value={reason}
            disabled={!base}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={!base || reason.trim().length === 0 || request !== null || busy !== null}
            onClick={() => void propose()}
          >
            {busy === 'propose' ? 'Submitting…' : 'Create binding draft and submit for review'}
          </Button>
          {proposal && request ? (
            <Alert variant="success" title={`Publication request ${request.status}`}>
              <span data-testid="designer-publication-request">
                Request <code className="sf-hash">{request.request_id}</code> for binding draft{' '}
                <code className="sf-hash">{proposal.binding_id}</code>.{' '}
                <Link href={`/publication?request=${request.request_id}`}>
                  Open in the Publication desk
                </Link>{' '}
                (sign in as the checker).
              </span>
            </Alert>
          ) : null}
        </PublishStep>
      </ol>
    </div>
  );
}
