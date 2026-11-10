'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { shortHash } from '@serviceform/studio-designers';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  bindingsApi,
  explain,
  orderedPins,
  publicationApi,
  readSession,
  type ApiResult,
  type Binding,
  type PublicationRequest,
  type SessionState,
} from '../lib/studio-api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Checker desk for CMP-051 publication requests. The checker opens a submitted request, inspects
 * the TenantServiceBinding pins (frozen forms and rule packs open read-only in their designers),
 * records a reasoned decision and, once approved, publishes the immutable binding version through
 * CMP-052.
 * CMP-051 refuses a decision by the maker; OPA decides who may act.
 */
export function PublicationDesk({ initialRequestId = '' }: { initialRequestId?: string }) {
  const [requestId, setRequestId] = useState(initialRequestId);
  const [request, setRequest] = useState<PublicationRequest | null>(null);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

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

  const load = useCallback(async (id: string) => {
    if (!UUID_RE.test(id.trim())) {
      setError('Enter a publication request id (UUID).');
      return;
    }
    setSession(await readSession());
    const found = await run('load', () => publicationApi.read(id.trim()));
    if (!found) return;
    setRequest(found);
    const b = await run('load', () => bindingsApi.read(found.subject_id));
    if (b) setBinding(b);
  }, []);

  useEffect(() => {
    if (initialRequestId) void load(initialRequestId);
  }, [initialRequestId, load]);

  async function decide(decision: 'approve' | 'reject') {
    if (!request) return;
    const body = await run(decision, () =>
      publicationApi.decide(request.request_id, decision, reason.trim()),
    );
    if (body) setRequest(body);
  }

  async function publish() {
    if (!binding) return;
    const body = await run('publish', () => bindingsApi.publish(binding.binding_id));
    if (body) setBinding(body);
  }

  const isMaker = Boolean(
    session?.actor_id && request && session.actor_id === request.maker_principal_id,
  );
  const canDecide = request?.status === 'SUBMITTED' && !isMaker && reason.trim().length > 0;
  const formPin = binding?.pins['form'];
  const workflowPin = binding?.pins['workflow'];
  const rulesPin = binding?.pins['rules'];

  return (
    <div className="sf-designer-stack">
      <form
        className="sf-designer-row sf-designer-row-end"
        onSubmit={(e) => {
          e.preventDefault();
          void load(requestId);
        }}
      >
        <TextInput
          id="request_id"
          name="request_id"
          label="Publication request id"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
        />
        <Button type="submit" variant="outline-primary" disabled={busy !== null}>
          Open request
        </Button>
      </form>

      {error ? (
        <Alert variant="error" title="Publication desk">
          {error}
        </Alert>
      ) : null}

      {request ? (
        <section className="sf-designer-stack" aria-labelledby="request-title">
          <h2 id="request-title" className="ux4g-heading-s-strong">
            Request <code className="sf-hash">{request.request_id}</code>
          </h2>
          <dl className="sf-dl">
            <dt>Status</dt>
            <dd>
              <span
                data-testid="publication-status"
                className={
                  request.status === 'APPROVED'
                    ? 'ux4g-tag-tonal-success'
                    : request.status === 'REJECTED'
                      ? 'ux4g-tag-tonal-error'
                      : 'ux4g-tag-tonal-warning'
                }
              >
                {request.status}
              </span>
            </dd>
            <dt>Binding draft</dt>
            <dd>
              <code className="sf-hash">{request.subject_id}</code>
            </dd>
            <dt>Proposed hash</dt>
            <dd>
              <code className="sf-hash">{request.proposed_hash}</code>
            </dd>
            <dt>Maker</dt>
            <dd>
              <code className="sf-hash">{request.maker_principal_id}</code>
              {isMaker ? <span className="ux4g-tag-tonal-warning"> You</span> : null}
            </dd>
            <dt>AI review</dt>
            <dd>
              Advisory only, never blocking
              {request.ai_advisory?.codes?.length
                ? ` (${request.ai_advisory.codes.join(', ')})`
                : ''}
            </dd>
          </dl>

          {binding ? (
            <div className="sf-table-wrap">
              <table className="sf-table">
                <caption>
                  Pins in binding {binding.binding_key} · {binding.status}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Version ref</th>
                    <th scope="col">Content hash</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedPins(binding.pins).map(([kind, pin]) => (
                    <tr key={kind}>
                      <th scope="row">{kind}</th>
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
          {formPin && UUID_RE.test(formPin.version_ref) ? (
            <p className="ux4g-body-m-default">
              <Link href={`/forms/designer?document=${formPin.version_ref}`}>
                Inspect the pinned form (read-only)
              </Link>
            </p>
          ) : null}
          {rulesPin && UUID_RE.test(rulesPin.version_ref) ? (
            <p className="ux4g-body-m-default">
              <Link href={`/rules/designer?document=${rulesPin.version_ref}`}>
                Inspect the pinned rule pack and its tests (read-only)
              </Link>
            </p>
          ) : null}
          {workflowPin && UUID_RE.test(workflowPin.version_ref) ? (
            <p className="ux4g-body-m-default">
              <a href={`/api/platform/workflow-versions/${workflowPin.version_ref}/bpmn`}>
                Open the pinned workflow version as BPMN (CMP-016 view, not executable)
              </a>
            </p>
          ) : null}

          {request.status === 'SUBMITTED' ? (
            isMaker ? (
              <Alert variant="warning" title="Maker cannot decide">
                You created this request. Sign in as a different Studio officer (the checker).
              </Alert>
            ) : (
              <div className="sf-designer-stack">
                <TextInput
                  id="decision_reason"
                  name="decision_reason"
                  label="Decision reason (recorded in the audit trail)"
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="sf-actions">
                  <Button
                    disabled={!canDecide || busy !== null}
                    onClick={() => void decide('approve')}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline-danger"
                    disabled={!canDecide || busy !== null}
                    onClick={() => void decide('reject')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )
          ) : null}

          {request.status === 'APPROVED' && binding ? (
            binding.status === 'PUBLISHED' ? (
              <Alert variant="success" title="Binding version published">
                <span data-testid="binding-published">
                  Immutable artifact version{' '}
                  <code className="sf-hash">{binding.published_version_id}</code>. New applications
                  pin it; applications already started keep their pins.
                </span>
              </Alert>
            ) : (
              <Button disabled={busy !== null} onClick={() => void publish()}>
                Publish binding version
              </Button>
            )
          ) : null}
        </section>
      ) : null}

      <p className="ux4g-body-s-default sf-designer-muted">
        CMP-051 records maker and checker separately and refuses a decision by the maker. CMP-052
        publishes immutable versions. SAMPLE_LAB: the CMP-052 approval port is SIMULATED.
      </p>
    </div>
  );
}
