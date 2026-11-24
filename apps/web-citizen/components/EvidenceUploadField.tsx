'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import { useId, useRef, useState, type DragEvent } from 'react';
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
  /** Id of the file input, so an error summary can link to it. */
  inputId?: string;
  /** Validation message from the surrounding form. */
  error?: string | undefined;
};

const KIND: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
};

export function fileKind(contentType: string): string {
  return KIND[contentType] ?? contentType;
}

/**
 * SAMPLE_LAB evidence upload (SF-49 / CMP-013), registered UX4G extension `evidence-upload`.
 * Shows technical-accept state only; never claims business verification.
 */
export function EvidenceUploadField({
  label = 'Supporting document',
  hint = 'PDF, PNG or JPEG up to 1 MB. Technical acceptance only — an officer still verifies the content.',
  applicationId,
  value,
  onChange,
  disabled,
  inputId: givenId,
  error: fieldError,
}: Props) {
  const autoId = useId();
  const inputId = givenId ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const accepted = value?.technically_accepted === true;

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

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled || busy || accepted) return;
    void onFile(event.dataTransfer.files?.[0] ?? null);
  }

  const shownError = fieldError && !accepted ? fieldError : '';
  const zoneState = accepted ? 'done' : shownError || error ? 'error' : dragging ? 'drag' : '';
  return (
    <div className="sf-stack" data-testid="evidence-upload-field">
      <div
        className={`sf-upload-zone${zoneState ? ` sf-upload-zone-${zoneState}` : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!accepted) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="sf-upload-icon" aria-hidden="true">
          <Icon name={accepted ? 'check-circle' : 'document'} size={22} />
        </span>
        <div className="sf-upload-body">
          <label className="ux4g-label-l-strong" htmlFor={inputId}>
            {label}
          </label>
          {accepted && value ? (
            <div className="sf-upload-file">
              <span className="ux4g-body-m-strong">{value.file_name}</span>
              <span className="ux4g-tag-tonal-success ux4g-tag-s">
                {fileKind(value.content_type)}
              </span>
              <span className="ux4g-tag-tonal-neutral ux4g-tag-s">{value.status}</span>
            </div>
          ) : (
            <p id={hintId} className="ux4g-body-s-default ux4g-text-neutral-secondary">
              {hint} You can also drop a file here.
            </p>
          )}
          <input
            ref={inputRef}
            id={inputId}
            className="sf-upload-input"
            type="file"
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            hidden={accepted}
            disabled={disabled || busy}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={[hintId, shownError ? errorId : null].filter(Boolean).join(' ')}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          {busy ? (
            <p className="ux4g-body-s-default" role="status">
              Uploading and checking the file (SIMULATED)…
            </p>
          ) : null}
          {shownError ? (
            <p id={errorId} className="ux4g-input-helper-text sf-form-error">
              <span className="ux4g-sr-only">Error: </span>
              {shownError}
            </p>
          ) : null}
          {accepted ? (
            <div className="sf-actions">
              <Button
                variant="outline-neutral"
                size="s"
                disabled={disabled || busy}
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = '';
                  onChange(null);
                  setError('');
                }}
              >
                Remove upload
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {error ? (
        <FormAlert tone="error" title="Upload refused">
          {error}
        </FormAlert>
      ) : null}
      {accepted && value ? (
        <FormAlert tone="success" title="Technically accepted (CMP-013)">
          This is not business verification — the officer still decides. CERTIFIED=false · G6=false.
        </FormAlert>
      ) : null}
      {value && !accepted ? (
        <FormAlert tone="warning" title="Not yet usable as evidence">
          Status {value.status}. Upload a clean file to reach AVAILABLE.
        </FormAlert>
      ) : null}
    </div>
  );
}
