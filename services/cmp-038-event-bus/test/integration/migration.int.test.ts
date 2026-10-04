import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrate } from '../helpers/db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('migration / frozen template (I16, 004-30)', () => {
  it('does not use CREATE ROLE IF NOT EXISTS', () => {
    const sql = readFileSync(
      join(root, 'db/migrations/1759500400000_cmp-038-event-bus.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/CREATE ROLE IF NOT EXISTS/i);
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator'\)/);
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp038_rw'\)/);
  });

  it('copies SF-CON-OUTBOX tables byte-identical after placeholder substitution', () => {
    const template = readFileSync(join(root, 'contracts/shared/sql/outbox.template.sql'), 'utf8')
      .replaceAll('{schema}', 'sf_event_bus')
      .replaceAll('{cmp}', 'CMP-038');
    const migration = readFileSync(
      join(root, 'db/migrations/1759500400000_cmp-038-event-bus.sql'),
      'utf8',
    );
    const begin = migration.indexOf('-- BEGIN SF-CON-OUTBOX');
    const end = migration.indexOf('-- END SF-CON-OUTBOX');
    expect(begin).toBeGreaterThan(0);
    const start = migration.indexOf('\n', begin) + 1;
    const copied = migration.slice(start, end);
    expect(copied.trimEnd()).toBe(template.trimEnd());
  });

  it('round-trips down then up for this migration', () => {
    migrate('up');
    migrate('down');
    migrate('up');
  });
});
