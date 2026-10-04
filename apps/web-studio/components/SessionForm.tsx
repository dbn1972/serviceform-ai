'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

const SAMPLE_TENANT = '11111111-1111-4111-8111-111111111111';
const SAMPLE_MAKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SAMPLE_CHECKER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function SessionForm({ defaultRole }: { defaultRole: string }) {
  const [tenantId, setTenantId] = useState(SAMPLE_TENANT);
  const [actorId, setActorId] = useState(SAMPLE_MAKER);
  const [role, setRole] = useState(defaultRole);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(nextActor = actorId) {
    setError('');
    setMessage('');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, actor_id: nextActor, roles: [role] }),
    });
    const body = (await res.json()) as { error_code?: string; tenant_id?: string };
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-001');
      return;
    }
    setMessage(`Session bound to tenant ${body.tenant_id}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextInput
        id="tenant_id"
        name="tenant_id"
        label="Tenant id"
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
        required
      />
      <TextInput
        id="actor_id"
        name="actor_id"
        label="Principal id"
        value={actorId}
        onChange={(e) => setActorId(e.target.value)}
        required
      />
      <TextInput
        id="role"
        name="role"
        label="Role code"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        required
      />
      {error ? (
        <Alert variant="error" title="Session refused">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="success" title="Signed in">
          {message}
        </Alert>
      ) : null}
      <Button type="submit">Start SIMULATED session</Button>
      <Button
        variant="outline-primary"
        onClick={() => {
          setActorId(SAMPLE_CHECKER);
          setRole('STUDIO_CHECKER');
          void submit(SAMPLE_CHECKER);
        }}
      >
        Sign in as checker
      </Button>
      <Button
        variant="text-neutral"
        onClick={() => {
          void fetch('/api/session', { method: 'DELETE' }).then(() => {
            setMessage('');
            setError('');
          });
        }}
      >
        End session
      </Button>
    </form>
  );
}
