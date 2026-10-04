'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

export function BindingDesk() {
  const [bindingKey, setBindingKey] = useState('generic.binding');
  const [offeringRef, setOfferingRef] = useState('generic.offering');
  const [bundleRef, setBundleRef] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function create() {
    setError('');
    const res = await fetch('/api/platform/tenant-service-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        binding_key: bindingKey,
        offering_ref: offeringRef,
        metadata_bundle_ref: bundleRef,
        pins: {},
      }),
    });
    const body = (await res.json()) as {
      error_code?: string;
      binding_id?: string;
      status?: string;
    };
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-004');
      return;
    }
    setBindingId(body.binding_id ?? '');
    setStatus(body.status ?? 'DRAFT');
  }

  async function publish() {
    if (!bindingId) return;
    const res = await fetch(`/api/platform/tenant-service-bindings/${bindingId}/publish`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const body = (await res.json()) as { error_code?: string; status?: string };
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-004');
      return;
    }
    setStatus(body.status ?? 'PUBLISHED');
  }

  return (
    <div>
      <TextInput
        id="binding_key"
        name="binding_key"
        label="Binding key"
        value={bindingKey}
        onChange={(e) => setBindingKey(e.target.value)}
      />
      <TextInput
        id="offering_ref"
        name="offering_ref"
        label="Offering ref"
        value={offeringRef}
        onChange={(e) => setOfferingRef(e.target.value)}
      />
      <TextInput
        id="bundle_ref"
        name="bundle_ref"
        label="Metadata bundle ref"
        value={bundleRef}
        onChange={(e) => setBundleRef(e.target.value)}
      />
      {error ? (
        <Alert variant="error" title="Binding request failed">
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="info" title="Binding">
          {status}
        </Alert>
      ) : null}
      <Button onClick={() => void create()}>Create draft binding</Button>
      <Button variant="outline-primary" onClick={() => void publish()}>
        Publish (requires checker approval)
      </Button>
    </div>
  );
}
