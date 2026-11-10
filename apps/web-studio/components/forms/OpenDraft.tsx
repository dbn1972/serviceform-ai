'use client';

import { Button, TextInput } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readRecent, type RecentDraft } from '../../lib/recent-drafts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reopen a saved CMP-033 designer draft by id; recent ids are remembered in this browser only. */
export function OpenDraft({
  action = '/forms/designer',
  kind = 'FORM',
}: {
  action?: string;
  kind?: NonNullable<RecentDraft['kind']>;
}) {
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<RecentDraft[]>([]);

  useEffect(() => {
    setRecent(readRecent().filter((d) => (d.kind ?? 'FORM') === kind));
  }, []);

  return (
    <div className="sf-designer-stack">
      <form
        className="sf-designer-row sf-designer-row-end"
        action={action}
        method="get"
        onSubmit={(e) => {
          if (!UUID_RE.test(id.trim())) {
            e.preventDefault();
            setError('Enter a CMP-033 document id (UUID).');
          }
        }}
      >
        <TextInput
          id="open-draft-id"
          name="document"
          label="CMP-033 document id"
          value={id}
          error={error || undefined}
          onChange={(e) => {
            setId(e.target.value);
            setError('');
          }}
        />
        <Button type="submit" variant="outline-primary">
          Open draft
        </Button>
      </form>
      {recent.length > 0 ? (
        <div>
          <h3 className="ux4g-label-l-strong">Recently saved in this browser</h3>
          <ul className="sf-designer-recent">
            {recent.map((d) => (
              <li key={d.id}>
                <Link href={`${action}?document=${d.id}`}>{d.title || d.key}</Link>
                <code className="sf-hash">{d.key}</code>
                <span className="ux4g-tag-tonal-neutral">{d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ux4g-body-s-default">
          Drafts you save are listed here (ids only, kept in this browser).
        </p>
      )}
    </div>
  );
}
