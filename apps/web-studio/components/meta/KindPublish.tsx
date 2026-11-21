'use client';

import { Alert, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import Link from 'next/link';
import { useState } from 'react';
import { rememberDraft } from '../../lib/recent-drafts';
import {
  bindingsApi,
  explain,
  metadataApi,
  orderedPins,
  publicationApi,
  type ApiResult,
  type Binding,
  type MetadataDocument,
  type PublicationRequest,
  type SessionState,
} from '../../lib/studio-api';
import { PublishStep, type DocState, type StepState } from '../forms/DesignerPublish';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MetaKind = 'FEE' | 'SLA' | 'EVIDENCE' | 'CREDENTIAL';

const PIN_KEY: Record<MetaKind, string> = {
  FEE: 'fee',
  SLA: 'sla',
  EVIDENCE: 'evidence',
  CREDENTIAL: 'credential',
};

/**
 * Shared CMP-033 → validate → freeze → TSB pin → CMP-051 publish path for Fee / SLA / Evidence /
 * Credential designers (parity with forms/workflow/rules). Maker cannot decide.
 */
export function KindPublish({
  kind,
  title,
  documentKey,
  contentHash,
  payload,
  blocked,
  doc,
  onDoc,
  session,
  kindLabel,
}: {
  kind: MetaKind;
  title: string;
  documentKey: string;
  contentHash: string | null;
  payload: unknown | null;
  blocked: boolean;
  doc: DocState | null;
  onDoc: (doc: DocState) => void;
  session: SessionState | null;
  kindLabel: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [baseId, setBaseId] = useState('');
  const [base, setBase] = useState<Binding | null>(null);
  const [reason, setReason] = useState('');
  const [proposal, setProposal] = useState<Binding | null>(null);
  const [request, setRequest] = useState<PublicationRequest | null>(null);

  const pinKind = PIN_KEY[kind];
  const saved =
    doc !== null &&
    contentHash !== null &&
    doc.savedHash === contentHash &&
    doc.key === documentKey;
  const frozen = doc?.status === 'PUBLISHED';
  const keyChanged = doc !== null && doc.key !== documentKey;

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
    rememberDraft({
      id: next.id,
      kind,
      key: next.key,
      title,
      status: next.status,
    });
  }

  async function save() {
    if (!payload || !contentHash) return;
    const body =
      doc && !keyChanged && !frozen
        ? await run('save', () => metadataApi.patch(doc.id, payload))
        : await run('save', () => metadataApi.create(kind, documentKey, payload));
    if (body) track(body, contentHash);
  }

  async function step(label: 'validate' | 'freeze') {
    if (!doc || !contentHash) return;
    const body = await run(label, () =>
      label === 'validate' ? metadataApi.validate(doc.id) : metadataApi.publish(doc.id),
    );
    if (body) track(body, contentHash);
  }

  async function loadBase() {
    if (!UUID_RE.test(baseId.trim())) {
      setError(
        `Enter the id of the TenantServiceBinding this ${kindLabel} version should replace.`,
      );
      return;
    }
    const body = await run('base', () => bindingsApi.read(baseId.trim()));
    if (body) setBase(body);
  }

  async function propose() {
    if (!doc || !contentHash || !base) return;
    const binding = await run('propose', () =>
      bindingsApi.create({
        binding_key: base.binding_key,
        offering_ref: base.offering_ref,
        metadata_bundle_ref: base.metadata_bundle_ref,
        pins: {
          ...base.pins,
          [pinKind]: { version_ref: doc.id, content_hash: contentHash },
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

  const validated = saved && doc !== null && doc.status !== 'DRAFT';
  const s1: StepState = saved ? 'done' : 'current';
  const s2: StepState = validated ? 'done' : saved ? 'current' : 'todo';
  const s3: StepState = frozen ? 'done' : doc?.status === 'VALIDATED' && saved ? 'current' : 'todo';
  const s4: StepState = request?.status === 'SUBMITTED' ? 'done' : frozen ? 'current' : 'todo';

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
          This {kindLabel} has problems CMP-033 would refuse. See Checks.
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
            Stores the {kindLabel} payload and its content_hash as a {kind} draft.
          </p>
          {doc ? (
            <dl className="sf-dl sf-dl-compact">
              <dt>Document</dt>
              <dd>
                <code className="sf-hash" data-testid={`${kind.toLowerCase()}-document-id`}>
                  {doc.id}
                </code>
              </dd>
              <dt>Status</dt>
              <dd data-testid={`${kind.toLowerCase()}-document-status`}>
                <span className={frozen ? 'ux4g-tag-tonal-success' : 'ux4g-tag-tonal-warning'}>
                  {frozen ? 'FROZEN (CMP-033 PUBLISHED)' : doc.status}
                </span>
              </dd>
            </dl>
          ) : null}
          {keyChanged && !frozen ? (
            <p className="ux4g-body-s-default">
              The key or version changed, so saving creates a new draft document.
            </p>
          ) : null}
          <Button
            disabled={blocked || !payload || !contentHash || saved || frozen || busy !== null}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Saving…' : doc && !keyChanged ? 'Save changes' : 'Save draft'}
          </Button>
        </PublishStep>
        <PublishStep index={2} title="Validate (CMP-033)" state={s2}>
          <p className="ux4g-body-s-default">
            CMP-033 checks the structural payload and recomputes the content_hash of exactly what
            was saved.
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
            The frozen version never changes again. It is not used until a checker approves a
            service binding that pins it.
          </p>
          <Checkbox
            id={`${kind.toLowerCase()}-freeze-ack`}
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
        <PublishStep index={4} title="Request publication (maker-checker)" state={s4}>
          <p className="ux4g-body-s-default">
            A new {kindLabel} reaches cases only through a new TenantServiceBinding version. Every
            other pin is carried forward; a different Studio officer must approve.
          </p>
          <div className="sf-designer-row sf-designer-row-end">
            <TextInput
              id={`${kind.toLowerCase()}-publish-base`}
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
          {base && doc && contentHash ? (
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
                    [pinKind]: { version_ref: doc.id, content_hash: contentHash },
                  }).map(([k, pin]) => (
                    <tr key={k} aria-current={k === pinKind ? 'true' : undefined}>
                      <th scope="row">
                        {k}
                        {k === pinKind ? (
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
            id={`${kind.toLowerCase()}-publish-reason`}
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
              <span data-testid={`${kind.toLowerCase()}-publication-request`}>
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
