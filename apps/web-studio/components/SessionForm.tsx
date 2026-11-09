'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

const DESIGNER_SUBJECT = 'sample-lab-studio-designer-1';
const CHECKER_SUBJECT = 'sample-lab-studio-checker-1';

export function SessionForm({ defaultRole }: { defaultRole: string }) {
  const [subject, setSubject] = useState(
    defaultRole === 'STUDIO_CHECKER' ? CHECKER_SUBJECT : DESIGNER_SUBJECT,
  );
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
          setSubject(CHECKER_SUBJECT);
          void submit(CHECKER_SUBJECT);
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
