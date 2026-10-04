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

export function ReviewDesk() {
  const [requestId, setRequestId] = useState('');
  const [request, setRequest] = useState<RequestView>({});
  const [actorId, setActorId] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const sessionRes = await fetch('/api/session');
    if (sessionRes.ok) {
      const session = (await sessionRes.json()) as { actor_id: string; roles: string[] };
      setActorId(session.actor_id);
      setRoles(session.roles);
    }
    const res = await fetch(`/api/platform/publication-requests/${requestId}`);
    const body = (await res.json()) as RequestView;
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-004');
      return;
    }
    setRequest(body);
  }

  async function decide(path: 'approve' | 'reject') {
    if (!request.request_id) return;
    const res = await fetch(`/api/platform/publication-requests/${request.request_id}/${path}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
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
        id="request_id"
        name="request_id"
        label="Publication request id"
        value={requestId}
        onChange={(e) => setRequestId(e.target.value)}
      />
      {error ? (
        <Alert variant="error" title="Review failed">
          {error}
        </Alert>
      ) : null}
      {request.status ? (
        <Alert variant="info" title="Status">
          {request.status}
        </Alert>
      ) : null}
      <Button onClick={() => void load()}>Load request</Button>
      <Button
        variant="outline-primary"
        disabled={!ux.canApprove}
        onClick={() => void decide('approve')}
      >
        Approve
      </Button>
      <Button
        variant="outline-danger"
        disabled={!ux.canReject}
        onClick={() => void decide('reject')}
      >
        Reject
      </Button>
    </div>
  );
}
