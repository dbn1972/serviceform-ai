'use client';

import { Alert, Button, Ux4gControl } from '@serviceform/ui-ux4g';
import { useMemo, useState } from 'react';
import {
  METADATA_KINDS,
  defaultFieldValues,
  fieldsForKind,
  payloadFromFields,
  type MetadataKind,
} from '../lib/designer';

export function MetadataDesigner() {
  const [kind, setKind] = useState<MetadataKind>('SERVICE');
  const [documentKey, setDocumentKey] = useState('generic.service');
  const [fields, setFields] = useState<Record<string, string>>(defaultFieldValues('SERVICE'));
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const hints = useMemo(() => fieldsForKind(kind), [kind]);

  function switchKind(next: MetadataKind) {
    setKind(next);
    setFields(defaultFieldValues(next));
  }

  async function createDocument() {
    setError('');
    setResult('');
    let payload: unknown;
    try {
      payload = payloadFromFields(kind, fields);
    } catch {
      setError('SF-SYS-003');
      return;
    }
    const res = await fetch('/api/platform/metadata/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ kind, document_key: documentKey, payload }),
    });
    const body = (await res.json()) as {
      error_code?: string;
      document_id?: string;
      status?: string;
    };
    if (!res.ok) {
      setError(body.error_code ?? 'SF-SYS-004');
      return;
    }
    setResult(body.document_id ? `Created ${body.document_id}` : 'Created');
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void createDocument();
      }}
    >
      <Ux4gControl
        id="kind"
        name="kind"
        schema={{ title: 'Metadata kind', enum: [...METADATA_KINDS] }}
        value={kind}
        required
        onChange={(value) => switchKind(String(value) as MetadataKind)}
      />
      <Ux4gControl
        id="document_key"
        name="document_key"
        schema={{ title: 'Document key', type: 'string' }}
        value={documentKey}
        required
        onChange={(value) => setDocumentKey(String(value))}
      />
      {hints.map((hint) => (
        <Ux4gControl
          key={hint.name}
          id={hint.name}
          name={hint.name}
          schema={{
            title: hint.title,
            type: hint.type,
            ...(hint.enum ? { enum: hint.enum } : {}),
          }}
          {...(hint.control ? { ui: { control: hint.control } } : {})}
          value={fields[hint.name] ?? ''}
          required
          onChange={(value) => setFields((prev) => ({ ...prev, [hint.name]: String(value) }))}
        />
      ))}
      {error ? (
        <Alert variant="error" title="Metadata request failed">
          {error}
        </Alert>
      ) : null}
      {result ? (
        <Alert variant="success" title="Draft saved">
          {result}
        </Alert>
      ) : null}
      <Button type="submit">Create draft document</Button>
    </form>
  );
}
