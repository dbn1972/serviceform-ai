import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const M06_SCHEMAS = ['sf_fee', 'sf_payment', 'sf_notification', 'sf_messaging'] as const;

describe('SF-M06-SEC static tenant isolation (migrations)', () => {
  it('M06 migrations ENABLE + FORCE RLS on tenant-scoped tables', () => {
    const migrations = readdirSync(join(ROOT, 'db/migrations'))
      .filter(
        (f) =>
          f.endsWith('.sql') &&
          (f.includes('cmp-020') ||
            f.includes('cmp-021') ||
            f.includes('cmp-025') ||
            f.includes('cmp-026')),
      )
      .map((f) => readFileSync(join(ROOT, 'db/migrations', f), 'utf8'))
      .join('\n');

    for (const schema of M06_SCHEMAS) {
      expect(migrations).toMatch(new RegExp(`CREATE SCHEMA ${schema}`));
    }
    expect(migrations).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migrations).toMatch(/FORCE ROW LEVEL SECURITY/i);
    // Payment privilege role present; no BYPASSRLS grant in CMP-021 migrations.
    const paymentSql = readdirSync(join(ROOT, 'db/migrations'))
      .filter((f) => f.includes('cmp-021') && f.endsWith('.sql'))
      .map((f) => readFileSync(join(ROOT, 'db/migrations', f), 'utf8'))
      .join('\n');
    expect(paymentSql).toMatch(/sf_cmp021_rw/);
    expect(paymentSql).toMatch(/NOBYPASSRLS/);
    expect(paymentSql).not.toMatch(/\bBYPASSRLS\b/);
    expect(paymentSql).not.toMatch(/GRANT\s+SUPERUSER/i);
    expect(paymentSql).toMatch(/NOSUPERUSER/);
  });

  it('host composition does not remount CMP-036 and documents SIMULATED boundaries', () => {
    const m06 = readFileSync(join(ROOT, 'apps/api/src/composition/m06.ts'), 'utf8');
    expect(m06).toMatch(/SIMULATED/);
    expect(m06).not.toMatch(/apiGatewayPlugin|cmp-036-api-gateway/);
    expect(m06).toMatch(/No domain logic, no cross-component SQL/);
  });
});
