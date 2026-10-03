import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('publisher source guards (004-05 static, 004-06, 004-19)', () => {
  const publisherDir = join(dir, '../src/publisher');
  const files = ['publisher.ts', 'claim.ts', 'discovery.ts', 'role-guard.ts'];

  it('has no environment flag that disables the role guard', () => {
    const guard = readFileSync(join(publisherDir, 'role-guard.ts'), 'utf8');
    expect(guard).not.toMatch(/SKIP_|DISABLE_.*GUARD|process\.env\.[A-Z_]*ROLE/);
  });

  it('SQL table names are only outbox_event / outbox_event_platform plus catalogue', () => {
    const text = files.map((f) => readFileSync(join(publisherDir, f), 'utf8')).join('\n');
    expect(text).not.toMatch(/\borders\b/);
    expect(text).toMatch(/outbox_event/);
  });

  it('DELETE predicates mention PUBLISHED or DEAD_LETTERED', () => {
    const claim = readFileSync(join(publisherDir, 'claim.ts'), 'utf8');
    expect(claim).toMatch(/status = 'PUBLISHED'/);
    expect(claim).toMatch(/status = 'DEAD_LETTERED'/);
  });
});
