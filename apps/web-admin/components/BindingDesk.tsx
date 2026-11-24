'use client';

import { Alert, Button, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

/** SAMPLE_LAB Residence placement binding used by eng seal prove (SF-60). */
const LAB_SEAL_BINDING_ID = '0d15ba00-0002-4000-8000-0d15ba0000d2';

export function BindingDesk() {
  const [bindingKey, setBindingKey] = useState('generic.binding');
  const [offeringRef, setOfferingRef] = useState('generic.offering');
  const [bundleRef, setBundleRef] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [labEngSealed, setLabEngSealed] = useState(false);
  const [sealNote, setSealNote] = useState('');

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

  async function proveLabEngSeal() {
    setError('');
    setSealNote('');
    const id = bindingId || LAB_SEAL_BINDING_ID;
    const res = await fetch(`/api/lab/tsb-seal/${id}/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogue_id: 'IND-SOC-002' }),
    });
    const body = (await res.json()) as {
      error_code?: string;
      lab_eng_sealed?: boolean;
      tsb_immutability_sealed?: boolean;
      note?: string;
    };
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-004');
      setLabEngSealed(false);
      return;
    }
    setLabEngSealed(body.lab_eng_sealed === true);
    setSealNote(
      body.note ?? 'Lab eng seal only. G6/production tsb_immutability_sealed remains false.',
    );
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
        <Alert variant="info" title="TenantServiceBinding">
          Status: {status}
          {bindingId ? (
            <>
              {' '}
              · id <code>{bindingId}</code>
            </>
          ) : null}
          . Applications pin this exact version at draft create; silent repoint is forbidden
          (Constitution #9).
        </Alert>
      ) : null}
      {labEngSealed ? (
        <Alert variant="info" title="Lab eng sealed">
          {sealNote ||
            'SAMPLE_LAB eng seal proven. CERTIFIED=false. G6=false. Owner owns G6 seal claim.'}
        </Alert>
      ) : null}
      <Alert variant="warning" title="Maker-checker required">
        Publish needs an APPROVED CMP-051 request from a different principal than the maker. Pins
        are authored in Studio and frozen at publish; empty pins here only create a draft shell.
        In-flight applications keep their pins — silent repoint is forbidden (Constitution #9). Lab
        eng seal ≠ G6 tsb_immutability_sealed (remains false until owner SF-60).
      </Alert>
      <Button onClick={() => void create()}>Create draft binding</Button>
      <Button variant="outline-primary" onClick={() => void publish()}>
        Publish (requires checker approval)
      </Button>
      <Button variant="outline-primary" onClick={() => void proveLabEngSeal()}>
        Prove lab eng seal
      </Button>
    </div>
  );
}
