'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';
import { makerCheckerUx } from '../lib/designer';

type RequestView = {
  request_id?: string;
  status?: string;
  maker_principal_id?: string;
  error_code?: string;
};

export function PublicationDesk() {
  const [subjectId, setSubjectId] = useState('');
  const [hash, setHash] = useState('');
  const [request, setRequest] = useState<RequestView>({});
  const [actorId, setActorId] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState('');

  async function refreshSession() {
    const res = await fetch('/api/session');
    if (!res.ok) return;
    const body = (await res.json()) as { actor_id: string; roles: string[] };
    setActorId(body.actor_id);
    setRoles(body.roles);
  }

  async function create() {
    setError('');
    await refreshSession();
    const res = await fetch('/api/platform/publication-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ subject_id: subjectId, proposed_hash: hash }),
    });
    const body = (await res.json()) as RequestView;
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-004');
      return;
    }
    setRequest(body);
  }

  async function act(path: string) {
    if (!request.request_id) return;
    const res = await fetch(`/api/platform/publication-requests/${request.request_id}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: '{}',
    });
    const body = (await res.json()) as RequestView;
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-004');
      return;
    }
    setRequest(body);
  }

  const ux = makerCheckerUx(actorId, request.maker_principal_id ?? '', request.status ?? '', roles);

  return (
    <div>
      <TextInput
        id="subject_id"
        name="subject_id"
        label="TenantServiceBinding id"
        value={subjectId}
        onChange={(e) => setSubjectId(e.target.value)}
      />
      <TextInput
        id="proposed_hash"
        name="proposed_hash"
        label="Proposed artifact hash"
        value={hash}
        onChange={(e) => setHash(e.target.value)}
      />
      {error ? (
        <Alert variant="error" title="Publication request failed">
          {error}
        </Alert>
      ) : null}
      {request.status ? (
        <Alert variant="info" title="Request status">
          {request.status}
        </Alert>
      ) : null}
      <Button onClick={() => void create()}>Create request as maker</Button>
      <Button variant="outline-primary" disabled={!ux.canSubmit} onClick={() => void act('submit')}>
        Submit for checker
      </Button>
      <Button
        variant="outline-primary"
        disabled={!ux.canApprove}
        onClick={() => void act('approve')}
      >
        Approve as checker
      </Button>
      <Button variant="outline-danger" disabled={!ux.canReject} onClick={() => void act('reject')}>
        Reject as checker
      </Button>
      <p className="ux4g-body-m-default">
        Maker-checker decisions are enforced by CMP-051. This portal only enables the matching
        actions.
      </p>
    </div>
  );
}
