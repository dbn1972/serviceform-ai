import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('SF-CON-OUTBOX copy (ADR-0006 #9, PB-14)', () => {
  it('migration outbox/inbox block matches rendered template', () => {
    const template = readFileSync(join(root, 'contracts/shared/sql/outbox.template.sql'), 'utf8')
      .replaceAll('{schema}', 'sf_security')
      .replaceAll('{cmp}', 'CMP-048');
    const body = template.split('-- sf:isolation sf_security.outbox_event')[1];
    expect(body).toBeTruthy();
    const migration = readFileSync(
      join(root, 'db/migrations/1759500200000_cmp-048-security-platform.sql'),
      'utf8',
    );
    const rendered = `-- sf:isolation sf_security.outbox_event${body}`;
    expect(migration).toContain(rendered.trim());
  });
});
