import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { registerLocalization } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { ctx, SIM_BINDING, T1, bearer, idem } from '../integration/helpers.js';
import { ACTOR_OFFICER } from '../integration/helpers.js';
import { mapPgError, Cmp053Error } from '../../src/errors.js';
import { authorize } from '../../src/authz.js';
import { requireContext, forwardedCarriesTenant } from '../../src/context.js';
import { isUuid } from '../../src/domain/uuid.js';

interface LocaleRow {
  tenant_id: string;
  locale_id: string;
  locale_tag: string;
  fallback_tag: string | null;
  is_default: boolean;
  status: string;
}
interface CatalogRow {
  tenant_id: string;
  catalog_id: string;
  catalog_code: string;
}
interface VersionRow {
  tenant_id: string;
  catalog_id: string;
  version_no: number;
  status: string;
  content_hash: string | null;
  published_at: string | null;
}
interface MessageRow {
  tenant_id: string;
  catalog_id: string;
  version_no: number;
  locale_id: string;
  message_key: string;
  message_text: string;
}
interface FormatRow {
  tenant_id: string;
  locale_id: string;
  date_skeleton: string;
  time_skeleton: string;
  decimal_separator: string;
  group_separator: string;
}

function memoryPool(): Pool {
  const locales: LocaleRow[] = [];
  const catalogs: CatalogRow[] = [];
  const versions: VersionRow[] = [];
  const messages: MessageRow[] = [];
  const formats: FormatRow[] = [];
  let tenant: string | null = null;

  const query = async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ');
    if (
      sql.startsWith('BEGIN') ||
      sql.startsWith('COMMIT') ||
      sql.startsWith('ROLLBACK') ||
      sql.includes('pg_advisory_xact_lock')
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('set_config')) {
      if (params[0] === 'app.tenant_id') tenant = String(params[1]);
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO sf_localization.locale')) {
      locales.push({
        tenant_id: String(params[0]),
        locale_id: String(params[1]),
        locale_tag: String(params[2]),
        fallback_tag: (params[3] as string | null) ?? null,
        is_default: Boolean(params[4]),
        status: 'ACTIVE',
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM sf_localization.locale') && sql.includes('locale_tag = $1')) {
      const rows = locales.filter((l) => l.locale_tag === params[0] && l.tenant_id === tenant);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM sf_localization.locale') && sql.includes("status = 'ACTIVE'")) {
      const rows = locales.filter((l) => l.tenant_id === tenant && l.status === 'ACTIVE');
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM sf_localization.locale')) {
      const rows = locales.filter((l) => l.tenant_id === tenant);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO sf_localization.format_profile')) {
      const row: FormatRow = {
        tenant_id: String(params[0]),
        locale_id: String(params[1]),
        date_skeleton: String(params[2]),
        time_skeleton: String(params[3]),
        decimal_separator: String(params[4]),
        group_separator: String(params[5]),
      };
      const idx = formats.findIndex(
        (f) => f.tenant_id === row.tenant_id && f.locale_id === row.locale_id,
      );
      if (idx >= 0) formats[idx] = row;
      else formats.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM sf_localization.format_profile')) {
      const rows = formats.filter((f) => f.tenant_id === tenant);
      return { rows, rowCount: rows.length };
    }
    if (
      sql.includes('INSERT INTO sf_localization.catalog ') ||
      sql.includes('INSERT INTO sf_localization.catalog (')
    ) {
      catalogs.push({
        tenant_id: String(params[0]),
        catalog_id: String(params[1]),
        catalog_code: String(params[2]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO sf_localization.catalog_version')) {
      const literal = /VALUES \(\$1,\$2,(\d+),'DRAFT'/.exec(sql);
      versions.push({
        tenant_id: String(params[0]),
        catalog_id: String(params[1]),
        version_no: literal ? Number(literal[1]) : Number(params[2]),
        status: 'DRAFT',
        content_hash: null,
        published_at: null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.includes('UPDATE sf_localization.catalog_version') &&
      sql.includes("status = 'PUBLISHED'")
    ) {
      const cat = String(params[2]);
      const ver = Number(params[3]);
      const row = versions.find(
        (v) => v.catalog_id === cat && v.version_no === ver && v.tenant_id === tenant,
      );
      if (row) {
        row.status = 'PUBLISHED';
        row.content_hash = String(params[0]);
        row.published_at = String(params[1]);
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (
      sql.includes('FROM sf_localization.catalog_version') &&
      sql.includes('ORDER BY version_no DESC')
    ) {
      const cat = String(params[0]);
      const rows = versions
        .filter((v) => v.catalog_id === cat && v.tenant_id === tenant)
        .sort((a, b) => b.version_no - a.version_no)
        .slice(0, 1)
        .map((v) => ({ ...v, version_no: String(v.version_no) }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM sf_localization.catalog_version')) {
      const rows = versions.filter(
        (v) =>
          v.tenant_id === tenant &&
          v.catalog_id === params[0] &&
          (params[1] === undefined || v.version_no === Number(params[1])),
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM sf_localization.catalog WHERE catalog_code')) {
      const rows = catalogs.filter((c) => c.tenant_id === tenant && c.catalog_code === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (
      sql.includes('FROM sf_localization.catalog c') ||
      sql.includes('FROM sf_localization.catalog')
    ) {
      const rows = catalogs.filter((c) => c.tenant_id === tenant);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO sf_localization.message')) {
      const row: MessageRow = {
        tenant_id: String(params[0]),
        catalog_id: String(params[1]),
        version_no: Number(params[2]),
        locale_id: String(params[3]),
        message_key: String(params[4]),
        message_text: String(params[5]),
      };
      const idx = messages.findIndex(
        (m) =>
          m.catalog_id === row.catalog_id &&
          m.version_no === row.version_no &&
          m.locale_id === row.locale_id &&
          m.message_key === row.message_key,
      );
      if (idx >= 0) messages[idx] = row;
      else messages.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM sf_localization.message')) {
      const rows = messages.filter(
        (m) =>
          m.tenant_id === tenant &&
          m.catalog_id === params[0] &&
          m.version_no === Number(params[1]),
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO sf_localization.idempotency_record')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE sf_localization.idempotency_record')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO sf_localization.outbox_event')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT 1 FROM sf_localization.locale WHERE locale_id')) {
      const rows = locales.filter((l) => l.locale_id === params[0] && l.tenant_id === tenant);
      return { rows, rowCount: rows.length };
    }
    throw new Error(`unhandled sql: ${sql}`);
  };

  const client = {
    query: (text: string, params?: unknown[]) => query(text, params ?? []),
    release: () => undefined,
  } as unknown as PoolClient;

  return {
    connect: async () => client,
  } as unknown as Pool;
}

describe('CMP-053 plugin + memory store', () => {
  it('maps postgres errors fail-closed', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError(new Cmp053Error('SF-SYS-002')).code).toBe('SF-SYS-002');
  });

  it('authorize and context fail closed', async () => {
    await expect(
      authorize(new ContractAuthorizer(), { bogus: true } as never),
    ).rejects.toBeInstanceOf(Cmp053Error);
    expect(() => requireContext(null, true)).toThrow(Cmp053Error);
    expect(forwardedCarriesTenant('for=1.1.1.1;tenant=abc')).toBe(true);
    expect(isUuid(T1)).toBe(true);
  });

  it('creates locale, catalog, messages, publish, resolve, format, assist', async () => {
    const app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    fixtures.clear();
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
    await registerLocalization(app, {
      prefix: '/v1',
      pool: memoryPool(),
      resolveContext: fixtureResolver,
      authorizer: new ContractAuthorizer(),
      clock: () => new Date('2026-10-04T12:00:00.000Z'),
      deploymentEnvironment: 'CI',
      assistBinding: SIM_BINDING,
    });

    const loc = await app.inject({
      method: 'POST',
      url: '/v1/locales',
      headers: { ...bearer('t1'), ...idem('idem-mem-loc') },
      payload: { locale_tag: 'aa', is_default: true },
    });
    expect(loc.statusCode).toBe(201);
    const localeId = (loc.json() as { locale_id: string }).locale_id;

    const fmt = await app.inject({
      method: 'PUT',
      url: `/v1/locales/${localeId}/format-profile`,
      headers: { ...bearer('t1'), ...idem('idem-mem-fmt') },
      payload: {
        date_skeleton: 'yyyyMMdd',
        time_skeleton: 'HHmm',
        decimal_separator: '.',
        group_separator: ',',
      },
    });
    expect(fmt.statusCode).toBe(200);

    const cat = await app.inject({
      method: 'POST',
      url: '/v1/catalogs',
      headers: { ...bearer('t1'), ...idem('idem-mem-cat') },
      payload: { catalog_code: 'UI_BUNDLE' },
    });
    expect(cat.statusCode).toBe(201);
    const catalogId = (cat.json() as { catalog_id: string }).catalog_id;

    const msgs = await app.inject({
      method: 'PUT',
      url: `/v1/catalogs/${catalogId}/versions/1/messages`,
      headers: { ...bearer('t1'), ...idem('idem-mem-msg') },
      payload: { locale_tag: 'aa', messages: [{ key: 'greeting', text: 'hello-generic' }] },
    });
    expect(msgs.statusCode).toBe(200);

    const pub = await app.inject({
      method: 'POST',
      url: `/v1/catalogs/${catalogId}/versions/1/publish`,
      headers: { ...bearer('t1'), ...idem('idem-mem-pub') },
      payload: {},
    });
    expect(pub.statusCode).toBe(200);

    const resolved = await app.inject({
      method: 'POST',
      url: '/v1/localization/resolve',
      headers: bearer('t1'),
      payload: { locale_tag: 'aa', catalog_code: 'UI_BUNDLE', keys: ['greeting'] },
    });
    expect(resolved.statusCode).toBe(200);

    const formatted = await app.inject({
      method: 'POST',
      url: '/v1/format/resolve',
      headers: bearer('t1'),
      payload: { locale_tag: 'aa', iso_date: '2026-10-04', number: '12.5' },
    });
    expect(formatted.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/v1/locales', headers: bearer('t1') });
    expect(list.statusCode).toBe(200);

    const catalogs = await app.inject({
      method: 'GET',
      url: '/v1/catalogs',
      headers: bearer('t1'),
    });
    expect(catalogs.statusCode).toBe(200);

    const assist = await app.inject({
      method: 'POST',
      url: '/v1/localization/assist',
      headers: bearer('t1'),
      payload: {
        source_locale_tag: 'aa',
        target_locale_tag: 'aa',
        message_key: 'greeting',
        source_text: 'hello-generic',
        test_run_id: 'ci-run-0001',
      },
    });
    expect(assist.statusCode).toBe(200);

    const forged = await app.inject({
      method: 'GET',
      url: '/v1/locales',
      headers: { ...bearer('t1'), 'x-tenant-id': randomUUID() },
    });
    expect(forged.statusCode).toBe(403);

    await app.close();
  });
});
