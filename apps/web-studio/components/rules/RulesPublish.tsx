'use client';

import { Alert, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import type { CompiledRules } from '@serviceform/studio-designers/rules';
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

/**
 * Rule pack publication: CMP-033 RULES draft → validate (content_hash recomputed) → every test
 * passes on CMP-008 → freeze → binding change pinning the frozen pack for CMP-051 maker-checker.
 * CMP-008 evaluates a pack only by that pin, after a checker approves the binding version.
 */
export function RulesPublish({
  title,
  compiled,
  blocked,
  doc,
  onDoc,
  session,
  testsPassed,
  testCount,
  running,
  onRun,
}: {
  title: string;
  compiled: CompiledRules | null;
  blocked: boolean;
  doc: DocState | null;
  onDoc: (doc: DocState) => void;
  session: SessionState | null;
  testsPassed: boolean;
  testCount: number;
  running: boolean;
  onRun: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [baseId, setBaseId] = useState('');
  const [base, setBase] = useState<Binding | null>(null);
  const [reason, setReason] = useState('');
  const [proposal, setProposal] = useState<Binding | null>(null);
  const [request, setRequest] = useState<PublicationRequest | null>(null);

  const saved = doc !== null && compiled !== null && doc.savedHash === compiled.contentHash;
  const frozen = doc?.status === 'PUBLISHED';
  const keyChanged = doc !== null && compiled !== null && doc.key !== compiled.documentKey;
  const tested = testCount > 0 && testsPassed;

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
    rememberDraft({ id: next.id, kind: 'RULES', key: next.key, title, status: next.status });
  }

  async function save() {
    if (!compiled) return;
    const body =
      doc && !keyChanged && !frozen
        ? await run('save', () => metadataApi.patch(doc.id, compiled.payload))
        : await run('save', () =>
            metadataApi.create('RULES', compiled.documentKey, compiled.payload),
          );
    if (body) track(body, compiled.contentHash);
  }

  async function step(label: 'validate' | 'freeze') {
    if (!doc || !compiled) return;
    const body = await run(label, () =>
      label === 'validate' ? metadataApi.validate(doc.id) : metadataApi.publish(doc.id),
    );
    if (body) track(body, compiled.contentHash);
  }

  async function loadBase() {
    if (!UUID_RE.test(baseId.trim())) {
      setError('Enter the id of the TenantServiceBinding this rule pack version should replace.');
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
        pins: { ...base.pins, rules: { version_ref: doc.id, content_hash: compiled.contentHash } },
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
  const s3: StepState = tested ? 'done' : validated ? 'current' : 'todo';
  const s4: StepState = frozen
    ? 'done'
    : doc?.status === 'VALIDATED' && saved && tested
      ? 'current'
      : 'todo';
  const s5: StepState = request?.status === 'SUBMITTED' ? 'done' : frozen ? 'current' : 'todo';

  return (
    <div className="sf-designer-publish">
      {session && !session.authenticated ? (
        <Alert variant="warning" title="Sign in to publish">
          Saving, testing and publishing call the platform as a SIMULATED Studio officer.{' '}
          <Link href="/session">Open the Session page</Link> and sign in as the designer (maker).
        </Alert>
      ) : null}
      {blocked ? (
        <Alert variant="error" title="Fix the checks first">
          The rule pack has problems CMP-033 or CMP-008 would refuse. See Checks.
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
            Stores the JDM pack, its content_hash, the test cases and the designer source as a RULES
            draft.
          </p>
          {doc ? (
            <dl className="sf-dl sf-dl-compact">
              <dt>Document</dt>
              <dd>
                <code className="sf-hash" data-testid="rules-document-id">
                  {doc.id}
                </code>
              </dd>
              <dt>Status</dt>
              <dd data-testid="rules-document-status">
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
            disabled={blocked || !compiled || saved || frozen || busy !== null}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Saving…' : doc && !keyChanged ? 'Save changes' : 'Save draft'}
          </Button>
        </PublishStep>
        <PublishStep index={2} title="Validate (CMP-033)" state={s2}>
          <p className="ux4g-body-s-default">
            CMP-033 checks the pack and recomputes the content_hash of exactly what was saved.
          </p>
          <Button
            variant="outline-primary"
            disabled={!saved || doc?.status !== 'DRAFT' || busy !== null}
            onClick={() => void step('validate')}
          >
            {busy === 'validate' ? 'Validating…' : 'Validate'}
          </Button>
        </PublishStep>
        <PublishStep index={3} title="Pass every test on CMP-008" state={s3}>
          <p className="ux4g-body-s-default">
            The exact pack runs on the ZEN engine against each test case. Any change to the table or
            a test input makes the results out of date.
          </p>
          <p className="ux4g-body-s-default" data-testid="rules-publish-tests">
            {testCount === 0
              ? 'No test cases yet. Add them on the Tests tab.'
              : tested
                ? `All ${testCount} tests pass for this content_hash.`
                : `${testCount} test${testCount === 1 ? '' : 's'} not yet passing for this content_hash.`}
          </p>
          <Button
            variant="outline-primary"
            disabled={testCount === 0 || running || !compiled}
            onClick={onRun}
          >
            {running ? 'Running…' : 'Run tests on CMP-008'}
          </Button>
        </PublishStep>
        <PublishStep index={4} title="Freeze this version" state={s4}>
          <p className="ux4g-body-s-default">
            The frozen pack never changes again, so the content_hash always means the same rules. It
            is not used until a checker approves a service binding that pins it.
          </p>
          <Checkbox
            id="rules-freeze-ack"
            label="I understand this version becomes immutable."
            checked={ack}
            disabled={doc?.status !== 'VALIDATED' || !saved || !tested}
            onChange={(e) => setAck(e.target.checked)}
          />
          <Button
            variant="outline-primary"
            disabled={!ack || doc?.status !== 'VALIDATED' || !saved || !tested || busy !== null}
            onClick={() => void step('freeze')}
          >
            {busy === 'freeze' ? 'Freezing…' : 'Freeze version'}
          </Button>
        </PublishStep>
        <PublishStep index={5} title="Request publication (maker-checker)" state={s5}>
          <p className="ux4g-body-s-default">
            A new rule pack reaches cases only through a new TenantServiceBinding version. Every
            other pin is carried forward; a different Studio officer must approve.
          </p>
          <div className="sf-designer-row sf-designer-row-end">
            <TextInput
              id="rules-publish-base"
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
          {base && doc && compiled ? (
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
                    rules: { version_ref: doc.id, content_hash: compiled.contentHash },
                  }).map(([kind, pin]) => (
                    <tr key={kind} aria-current={kind === 'rules' ? 'true' : undefined}>
                      <th scope="row">
                        {kind}
                        {kind === 'rules' ? (
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
            id="rules-publish-reason"
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
              <span data-testid="rules-publication-request">
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
