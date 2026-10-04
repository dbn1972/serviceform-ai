'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

const SAMPLE_TENANT = '11111111-1111-4111-8111-111111111111';
const SAMPLE_ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export function SessionForm({ defaultRole }: { defaultRole: string }) {
  const [tenantId, setTenantId] = useState(SAMPLE_TENANT);
  const [actorId, setActorId] = useState(SAMPLE_ADMIN);
  const [role, setRole] = useState(defaultRole);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    setMessage('');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, actor_id: actorId, roles: [role] }),
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
        variant="text-neutral"
        onClick={() => {
          void fetch('/api/session', { method: 'DELETE' });
          setMessage('');
          setError('');
        }}
      >
        End session
      </Button>
    </form>
  );
}
