'use client';

import { Alert, Button, Card, TextInput } from '@serviceform/ui-ux4g';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function CitizenLoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') || '/services';
  const [displayName, setDisplayName] = useState('SAMPLE LAB Citizen');
  const [mobile, setMobile] = useState('9876543210');
  const [otp, setOtp] = useState('123456');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    if (otp !== '123456') {
      setBusy(false);
      setError('SF-LAB-OTP — use SIMULATED OTP 123456');
      return;
    }
    const res = await fetch('/api/lab/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, mobile }),
    });
    const body = (await res.json()) as { error_code?: string; message?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.message ?? body.error_code ?? 'SF-LAB-SESSION');
      return;
    }
    router.push(next.startsWith('/') ? next : '/services');
    router.refresh();
  }

  return (
    <Card
      title="Sign in (SAMPLE_LAB)"
      subtitle="SIMULATED citizen identity — not Aadhaar / DigiLocker / production IAM"
      footer={
        <div className="sf-actions">
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Signing in…' : 'Continue to services'}
          </Button>
        </div>
      }
    >
      <Alert variant="warning" title="Sample lab only — G6 not issued">
        Use synthetic values only. OTP is fixed to <strong>123456</strong> in this mock. DigiLocker
        stays SIMULATED.
      </Alert>

      <div className="sf-form-grid">
        <TextInput
          id="display_name"
          name="display_name"
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          hint="Must start with SAMPLE or Lab"
        />
        <TextInput
          id="mobile"
          name="mobile"
          label="Mobile number"
          inputMode="numeric"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          hint="Synthetic 10 digits starting with 9"
        />
        <div className="sf-span-2">
          <TextInput
            id="otp"
            name="otp"
            label="One-time password (SIMULATED)"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            hint="Always 123456 in SAMPLE_LAB"
          />
        </div>
      </div>

      {error ? (
        <Alert variant="error" title="Sign-in refused">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
