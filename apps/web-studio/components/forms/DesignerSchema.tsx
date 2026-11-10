'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import type { CompiledForm } from '@serviceform/studio-designers/forms';
import { useState } from 'react';

function Block({ id, title, value }: { id: string; title: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);
  return (
    <section className="sf-designer-code" aria-labelledby={`${id}-title`}>
      <div className="sf-designer-code-head">
        <h3 id={`${id}-title`} className="ux4g-label-l-strong">
          {title}
        </h3>
        <Button
          variant="text-primary"
          size="xs"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre tabIndex={0} aria-label={title}>
        {text}
      </pre>
    </section>
  );
}

/** Read-only view of exactly what will be stored in CMP-033 and executed by CMP-009. */
export function DesignerSchema({ compiled }: { compiled: CompiledForm | null }) {
  if (!compiled) return <p className="ux4g-body-m-default">Compiling…</p>;
  return (
    <div className="sf-designer-schema">
      <dl className="sf-dl">
        <dt>CMP-033 document key</dt>
        <dd>
          <code className="sf-hash">{compiled.documentKey}</code>
        </dd>
        <dt>Content hash (pin)</dt>
        <dd>
          <code className="sf-hash" data-testid="designer-content-hash">
            {compiled.contentHash}
          </code>
        </dd>
      </dl>
      <div className="sf-designer-code-grid">
        <Block
          id="json-schema"
          title="JSON Schema (validation)"
          value={compiled.formPackage.json_schema}
        />
        <Block
          id="ui-schema"
          title="UI schema (UX4G layout)"
          value={compiled.formPackage.ui_schema}
        />
        <Block id="pages" title="CMP-033 pages summary" value={compiled.payload.pages} />
      </div>
    </div>
  );
}
