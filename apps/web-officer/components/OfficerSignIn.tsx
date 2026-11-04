'use client';

import { Alert, Button, Card, RadioGroup } from '@serviceform/ui-ux4g';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { safeNext } from '../lib/safe-next';

type LabOfficer = { subject: string; display_name: string; roles: string[] };

/** SAMPLE_LAB sign-in through the SIMULATED IdP; the session itself is issued by CMP-004. */
export function OfficerSignIn({ nextParam }: { nextParam?: string | undefined }) {
  const router = useRouter();
  const [officers, setOfficers] = useState<LabOfficer[]>([]);
  const [subject, setSubject] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/portal/officers')
      .then((r) => r.json() as Promise<{ officers?: LabOfficer[] }>)
      .then((body) => {
        const list = body.officers ?? [];
        setOfficers(list);
        if (list[0]) setSubject(list[0].subject);
      })
      .catch(() => setError('The sign-in service is unavailable.'));
  }, []);

  async function signIn() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/portal/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? 'Sign in failed');
      return;
    }
    router.push(safeNext(nextParam));
    router.refresh();
  }

  return (
    <Card
      title="Officer sign in"
      subtitle="SAMPLE_LAB · SIMULATED identity provider · session issued by CMP-004"
      footer={
        <Button onClick={() => void signIn()} disabled={busy || !subject}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      }
    >
      {officers.length > 0 ? (
        <RadioGroup
          name="officer"
          legend="Sign in as"
          value={subject}
          onChange={setSubject}
          options={officers.map((o) => ({
            value: o.subject,
            label: `${o.display_name} (${o.roles.join(', ')})`,
          }))}
        />
      ) : (
        <p className="ux4g-body-m-default">No SAMPLE_LAB officers are available.</p>
      )}
      {error ? (
        <Alert variant="error" title="Sign in failed">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
