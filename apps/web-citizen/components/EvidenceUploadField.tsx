'use client';

import { Button } from '@serviceform/ui-ux4g';
import { useId, useState } from 'react';
import { FormAlert } from './FormFeedback';

export type EvidenceUploadValue = {
  document_id: string;
  file_name: string;
  content_type: string;
  status: string;
  technically_accepted: boolean;
};

type Props = {
  label?: string;
  hint?: string;
  applicationId?: string;
  value: EvidenceUploadValue | null;
  onChange: (next: EvidenceUploadValue | null) => void;
  disabled?: boolean;
};

/**
 * SAMPLE_LAB evidence upload (SF-49 / CMP-013). Shows technical-accept state only.
 * Never claims business verification. Uses UX4G input container patterns.
 */
export function EvidenceUploadField({
  label = 'Supporting document',
  hint = 'PDF, PNG or JPEG up to 1 MB. Technical acceptance only — an officer still verifies the content.',
  applicationId,
  value,
  onChange,
  disabled,
}: Props) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onFile(file: File | null) {
    setError('');
    if (!file) {
      onChange(null);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      if (applicationId) body.set('application_id', applicationId);
      const res = await fetch('/api/portal/documents', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': `ui-${crypto.randomUUID()}` },
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string;
        document?: {
          document_id: string;
          status: string;
          technically_accepted?: boolean;
          content_type?: string;
        };
        file_name?: string;
        content_type?: string;
      };
      if (!res.ok || !json.document?.document_id) {
        onChange(null);
        setError(json.message ?? 'We could not upload this file. Try a clean PDF, PNG or JPEG.');
        return;
      }
      onChange({
        document_id: json.document.document_id,
        file_name: json.file_name ?? file.name,
        content_type: json.content_type ?? json.document.content_type ?? file.type,
        status: json.document.status,
        technically_accepted: Boolean(json.document.technically_accepted),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-section" data-testid="evidence-upload-field">
      <div className="ux4g-input-container ux4g-input-m ux4g-input-default">
        <label className="ux4g-label-m-default" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          className="ux4g-input-input"
          type="file"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          disabled={disabled || busy}
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        <p className="ux4g-input-helper ux4g-input-helper-text">{hint}</p>
      </div>
      {busy ? (
        <p className="ux4g-body-s-default" role="status">
          Uploading and scanning (SIMULATED)…
        </p>
      ) : null}
      {error ? (
        <FormAlert tone="error" title="Upload refused">
          {error}
        </FormAlert>
      ) : null}
      {value?.technically_accepted ? (
        <FormAlert tone="success" title="Technically accepted (CMP-013)">
          {value.file_name} · {value.content_type} · status {value.status}. This is not business
          verification — the officer still decides. CERTIFIED=false · G6=false.
        </FormAlert>
      ) : null}
      {value && !value.technically_accepted ? (
        <FormAlert tone="warning" title="Not yet usable as evidence">
          Status {value.status}. Upload a clean file to reach AVAILABLE.
        </FormAlert>
      ) : null}
      {value ? (
        <div className="sf-actions">
          <Button
            variant="outline-neutral"
            disabled={disabled || busy}
            onClick={() => {
              onChange(null);
              setError('');
            }}
          >
            Remove upload
          </Button>
        </div>
      ) : null}
    </div>
  );
}
