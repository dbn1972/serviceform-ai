'use client';

import { Alert, Button, Card, TextInput, applyTenantOverlay } from '@serviceform/ui-ux4g';
import { useState } from 'react';

export function OverlayForm() {
  const [tenantId, setTenantId] = useState('11111111-1111-4111-8111-111111111111');
  const [token, setToken] = useState('--ux4g-color-primary-600');
  const [value, setValue] = useState('');
  const [cssText, setCssText] = useState('');
  const [error, setError] = useState('');

  function apply() {
    setError('');
    try {
      const overlay = applyTenantOverlay({ tenantId, tokens: { [token]: value } });
      setCssText(overlay.cssText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'overlay refused');
      setCssText('');
    }
  }

  return (
    <Card title="Tenant branding overlay">
      <p className="ux4g-body-m-default">
        Branding is a validated UX4G token overlay scoped to data-tenant-id. Arbitrary CSS is
        refused.
      </p>
      <TextInput
        id="overlay_tenant"
        name="overlay_tenant"
        label="Tenant id"
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
      />
      <TextInput
        id="overlay_token"
        name="overlay_token"
        label="Allowlisted token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <TextInput
        id="overlay_value"
        name="overlay_value"
        label="Hex value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {error ? (
        <Alert variant="error" title="Overlay refused">
          {error}
        </Alert>
      ) : null}
      {cssText ? (
        <Alert variant="success" title="Scoped CSS">
          {cssText}
        </Alert>
      ) : null}
      <Button onClick={apply}>Preview overlay</Button>
    </Card>
  );
}
