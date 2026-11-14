'use client';

import { Alert, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import type { CompiledWorkflow } from '@serviceform/studio-designers/workflow';
import Link from 'next/link';
import { useState } from 'react';
import { rememberDraft } from '../../lib/recent-drafts';
import {
  bindingsApi,
  explain,
  metadataApi,
  orderedPins,
  publicationApi,
  workflowApi,
  type ApiResult,
  type Binding,
  type MetadataDocument,
  type PublicationRequest,
  type SessionState,
  type WorkflowDraft,
} from '../../lib/studio-api';
import { PublishStep, type DocState, type StepState } from '../forms/DesignerPublish';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Workflow publication: CMP-033 draft → validate (graph_hash recomputed) → freeze → emit the frozen
 * graph as a CMP-016 DRAFT (CMP-016 re-validates it) → binding change pinning the CMP-016 version
 * for CMP-051 maker-checker. Publishing the CMP-016 version itself needs the checker's approval.
 */
export function WorkflowPublish({
  title,
  compiled,
  blocked,
  doc,
  onDoc,
  session,
}: {
  title: string;
  compiled: CompiledWorkflow | null;
  blocked: boolean;
  doc: DocState | null;
  onDoc: (doc: DocState) => void;
  session: SessionState | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [baseId, setBaseId] = useState('');
  const [base, setBase] = useState<Binding | null>(null);
  const [reason, setReason] = useState('');
  const [proposal, setProposal] = useState<Binding | null>(null);
  const [request, setRequest] = useState<PublicationRequest | null>(null);

  const saved = doc !== null && compiled !== null && doc.savedHash === compiled.graphHash;
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
    rememberDraft({ id: next.id, kind: 'WORKFLOW', key: next.key, title, status: next.status });
  }

  async function save() {
    if (!compiled) return;
    const body =
      doc && !keyChanged && !frozen
        ? await run('save', () => metadataApi.patch(doc.id, compiled.payload))
        : await run('save', () =>
            metadataApi.create('WORKFLOW', compiled.documentKey, compiled.payload),
          );
    if (body) track(body, compiled.graphHash);
  }

  async function step(label: 'validate' | 'freeze') {
    if (!doc || !compiled) return;
    const body = await run(label, () =>
      label === 'validate' ? metadataApi.validate(doc.id) : metadataApi.publish(doc.id),
    );
    if (body) track(body, compiled.graphHash);
  }

  async function emit() {
    if (!doc || !compiled) return;
    const body = await run('emit', () =>
      workflowApi.emitDraft({
        definition_key: compiled.payload.authoring.definition_key,
        graph: compiled.graph,
        graph_hash: compiled.graphHash,
        source_ref: `cmp-033:${doc.id}`,
      }),
    );
    if (body) setDraft(body);
  }

  async function loadBase() {
    if (!UUID_RE.test(baseId.trim())) {
      setError('Enter the id of the TenantServiceBinding this workflow version should replace.');
      return;
    }
    const body = await run('base', () => bindingsApi.read(baseId.trim()));
    if (body) setBase(body);
  }

  async function propose() {
    if (!draft || !base) return;
    const binding = await run('propose', () =>
      bindingsApi.create({
        binding_key: base.binding_key,
        offering_ref: base.offering_ref,
        metadata_bundle_ref: base.metadata_bundle_ref,
        pins: {
          ...base.pins,
          workflow: { version_ref: draft.version_id, content_hash: draft.graph_hash },
        },
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

  const s1: StepState = saved ? 'done' : 'current';
  const s2: StepState =
    saved && doc && doc.status !== 'DRAFT' ? 'done' : saved ? 'current' : 'todo';
  const s3: StepState = frozen ? 'done' : doc?.status === 'VALIDATED' && saved ? 'current' : 'todo';
  const s4: StepState = draft ? 'done' : frozen ? 'current' : 'todo';
  const s5: StepState = request?.status === 'SUBMITTED' ? 'done' : draft ? 'current' : 'todo';

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
          The graph has problems CMP-016 would refuse. See Checks on the Design tab.
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="Platform response">
          {error}
        </Alert>
      ) : null}
      <ol className="sf-designer-publish-steps">
        <PublishStep index={1} title="Save draft (CMP-033)" state={s1}>
          <p className="ux4g-body-s-default">
            Stores the canonical graph, its graph_hash and the canvas layout as a WORKFLOW draft.
          </p>
          {doc ? (
            <dl className="sf-dl sf-dl-compact">
              <dt>Document</dt>
              <dd>
                <code className="sf-hash" data-testid="workflow-document-id">
                  {doc.id}
                </code>
              </dd>
              <dt>Status</dt>
              <dd data-testid="workflow-document-status">
                <span className={frozen ? 'ux4g-tag-tonal-success' : 'ux4g-tag-tonal-warning'}>
                  {frozen ? 'FROZEN (CMP-033 PUBLISHED)' : doc.status}
                </span>
              </dd>
            </dl>
          ) : null}
          <Button
            disabled={blocked || !compiled || saved || frozen || busy !== null}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Saving…' : doc && !keyChanged ? 'Save changes' : 'Save draft'}
          </Button>
        </PublishStep>
        <PublishStep index={2} title="Validate (CMP-033)" state={s2}>
          <p className="ux4g-body-s-default">
            CMP-033 recomputes the graph_hash of exactly what was saved.
          </p>
          <Button
            variant="outline-primary"
            disabled={!saved || doc?.status !== 'DRAFT' || busy !== null}
            onClick={() => void step('validate')}
          >
            {busy === 'validate' ? 'Validating…' : 'Validate'}
          </Button>
        </PublishStep>
        <PublishStep index={3} title="Freeze this version" state={s3}>
          <p className="ux4g-body-s-default">
            The frozen document never changes again, so the graph_hash always means the same graph.
          </p>
          <Checkbox
            id="wf-freeze-ack"
            label="I understand this version becomes immutable."
            checked={ack}
            disabled={doc?.status !== 'VALIDATED' || !saved}
            onChange={(e) => setAck(e.target.checked)}
          />
          <Button
            variant="outline-primary"
            disabled={!ack || doc?.status !== 'VALIDATED' || !saved || busy !== null}
            onClick={() => void step('freeze')}
          >
            {busy === 'freeze' ? 'Freezing…' : 'Freeze version'}
          </Button>
        </PublishStep>
        <PublishStep index={4} title="Emit to CMP-016" state={s4}>
          <p className="ux4g-body-s-default">
            CMP-016 validates the frozen graph again and stores it as a DRAFT workflow version. It
            runs on Temporal only after a checker approves its publication.
          </p>
          <Button
            variant="outline-primary"
            disabled={!frozen || draft !== null || busy !== null}
            onClick={() => void emit()}
          >
            {busy === 'emit' ? 'Emitting…' : 'Emit CMP-016 draft'}
          </Button>
          {draft && compiled ? (
            <Alert variant="success" title="CMP-016 draft version stored">
              <span data-testid="workflow-cmp016-draft">
                Version <code className="sf-hash">{draft.version_id}</code> (v{draft.version_no},{' '}
                {draft.status}, {draft.origin}) · graph_hash{' '}
                {draft.graph_hash === compiled.graphHash ? 'matches the frozen design' : 'DIFFERS'}
              </span>
            </Alert>
          ) : null}
        </PublishStep>
        <PublishStep index={5} title="Request publication (maker-checker)" state={s5}>
          <p className="ux4g-body-s-default">
            A new workflow version reaches cases only through a new TenantServiceBinding version.
            Every other pin is carried forward; a different Studio officer must approve.
          </p>
          <div className="sf-designer-row sf-designer-row-end">
            <TextInput
              id="wf-publish-base"
              label="TenantServiceBinding id to update"
              value={baseId}
              disabled={!draft}
              onChange={(e) => setBaseId(e.target.value)}
            />
            <Button
              variant="outline-primary"
              disabled={!draft || busy !== null}
              onClick={() => void loadBase()}
            >
              Load binding
            </Button>
          </div>
          {base && draft ? (
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
                    workflow: { version_ref: draft.version_id, content_hash: draft.graph_hash },
                  }).map(([kind, pin]) => (
                    <tr key={kind} aria-current={kind === 'workflow' ? 'true' : undefined}>
                      <th scope="row">
                        {kind}
                        {kind === 'workflow' ? (
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
            id="wf-publish-reason"
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
              <span data-testid="workflow-publication-request">
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
