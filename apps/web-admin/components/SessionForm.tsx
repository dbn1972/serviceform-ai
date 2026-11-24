'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

/** SAMPLE_LAB tenant admin subject from fixtures/lab/platform/officers.json */
const ADMIN_SUBJECT = 'sample-lab-tenant-admin-1';

export function SessionForm({ defaultRole: _defaultRole }: { defaultRole: string }) {
  const [subject, setSubject] = useState(ADMIN_SUBJECT);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(nextSubject = subject) {
    setError('');
    setMessage('');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: nextSubject }),
    });
    const body = (await res.json()) as { error_code?: string; display_name?: string };
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-001');
      return;
    }
    setMessage(`Signed in as ${body.display_name ?? nextSubject}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextInput
        id="subject"
        name="subject"
        label="Officer subject (from officers.json)"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
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
          setSubject(ADMIN_SUBJECT);
          void submit(ADMIN_SUBJECT);
        }}
      >
        Sign in as tenant admin
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
