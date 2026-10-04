import type { FastifyInstance } from 'fastify';
import { formatDecimal, formatIsoDate } from '../domain/format.js';
import { fallbackChain, isLocaleTag, isMessageKey } from '../domain/locale.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { Cmp053Error } from '../errors.js';
import { ASSIST_BODY, FORMAT_RESOLVE_BODY, RESOLVE_BODY } from '../schemas/http.js';
import { decide, sendPrivate, subjectOf, type RouteDeps } from './helpers.js';

export function registerResolveRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{
    Body: {
      locale_tag: string;
      catalog_code: string;
      version_no?: number;
      keys: string[];
    };
  }>('/localization/resolve', { schema: { body: RESOLVE_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subjectOf(ctx),
      resource: {
        resource_type: 'LocalizationCatalog',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'LOCALIZATION_RESOLVE',
    });
    if (!isLocaleTag(request.body.locale_tag)) {
      throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'LOCALE_TAG' }] });
    }
    for (const key of request.body.keys) {
      if (!isMessageKey(key)) {
        throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'MESSAGE_KEY' }] });
      }
    }
    const resolved = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const catalog = await client.query<{ catalog_id: string }>(
        `SELECT catalog_id FROM sf_localization.catalog WHERE catalog_code = $1`,
        [request.body.catalog_code],
      );
      const catalogId = catalog.rows[0]?.catalog_id;
      if (!catalogId) throw new Cmp053Error('SF-SYS-002', { details: [{ code: 'CATALOG' }] });
      let versionNo = request.body.version_no;
      if (versionNo !== undefined) {
        const pinned = await client.query<{ status: string }>(
          `SELECT status FROM sf_localization.catalog_version
            WHERE catalog_id = $1 AND version_no = $2`,
          [catalogId, versionNo],
        );
        if (!pinned.rows[0] || pinned.rows[0].status !== 'PUBLISHED') {
          throw new Cmp053Error('SF-SYS-002', { details: [{ code: 'VERSION_NOT_PUBLISHED' }] });
        }
      } else {
        const latest = await client.query<{ version_no: string }>(
          `SELECT version_no::text FROM sf_localization.catalog_version
            WHERE catalog_id = $1 AND status = 'PUBLISHED'
            ORDER BY version_no DESC LIMIT 1`,
          [catalogId],
        );
        if (!latest.rows[0]) {
          throw new Cmp053Error('SF-SYS-002', { details: [{ code: 'VERSION_NOT_PUBLISHED' }] });
        }
        versionNo = Number(latest.rows[0].version_no);
      }
      const locales = await client.query<{
        locale_id: string;
        locale_tag: string;
        fallback_tag: string | null;
        is_default: boolean;
      }>(`SELECT locale_id, locale_tag, fallback_tag, is_default FROM sf_localization.locale`);
      const byTag = new Map(locales.rows.map((r) => [r.locale_tag, r]));
      const requested = byTag.get(request.body.locale_tag);
      const defaultTag = locales.rows.find((r) => r.is_default)?.locale_tag ?? null;
      const chain = fallbackChain({
        requested: request.body.locale_tag,
        configuredFallback: requested?.fallback_tag ?? null,
        defaultTag,
      });
      const messages = await client.query<{
        locale_id: string;
        message_key: string;
        message_text: string;
      }>(
        `SELECT locale_id, message_key, message_text
           FROM sf_localization.message
          WHERE catalog_id = $1 AND version_no = $2`,
        [catalogId, versionNo],
      );
      const byLocaleKey = new Map<string, string>();
      const localeIdToTag = new Map(locales.rows.map((r) => [r.locale_id, r.locale_tag]));
      for (const row of messages.rows) {
        const tag = localeIdToTag.get(row.locale_id);
        if (tag) byLocaleKey.set(`${tag}\0${row.message_key}`, row.message_text);
      }
      const items: { key: string; text: string; locale_tag: string }[] = [];
      for (const key of request.body.keys) {
        let found: { text: string; locale_tag: string } | undefined;
        for (const tag of chain) {
          const text = byLocaleKey.get(`${tag}\0${key}`);
          if (text !== undefined) {
            found = { text, locale_tag: tag };
            break;
          }
        }
        if (!found) {
          throw new Cmp053Error('SF-SYS-002', { details: [{ code: 'MISSING_MESSAGE' }] });
        }
        items.push({ key, text: found.text, locale_tag: found.locale_tag });
      }
      return { catalog_id: catalogId, version_no: versionNo, items };
    });
    sendPrivate(reply);
    return resolved;
  });

  app.post<{
    Body: { locale_tag: string; iso_date?: string; number?: string };
  }>('/format/resolve', { schema: { body: FORMAT_RESOLVE_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subjectOf(ctx),
      resource: {
        resource_type: 'FormatProfile',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'LOCALIZATION_RESOLVE',
    });
    if (!isLocaleTag(request.body.locale_tag)) {
      throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'LOCALE_TAG' }] });
    }
    const out = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const locales = await client.query<{
        locale_id: string;
        locale_tag: string;
        fallback_tag: string | null;
        is_default: boolean;
      }>(`SELECT locale_id, locale_tag, fallback_tag, is_default FROM sf_localization.locale`);
      const defaultTag = locales.rows.find((r) => r.is_default)?.locale_tag ?? null;
      const requested = locales.rows.find((r) => r.locale_tag === request.body.locale_tag);
      const chain = fallbackChain({
        requested: request.body.locale_tag,
        configuredFallback: requested?.fallback_tag ?? null,
        defaultTag,
      });
      const profiles = await client.query<{
        locale_id: string;
        date_skeleton: string;
        time_skeleton: string;
        decimal_separator: string;
        group_separator: string;
      }>(
        `SELECT locale_id, date_skeleton, time_skeleton, decimal_separator, group_separator
           FROM sf_localization.format_profile`,
      );
      const byLocale = new Map(profiles.rows.map((p) => [p.locale_id, p]));
      const tagToId = new Map(locales.rows.map((r) => [r.locale_tag, r.locale_id]));
      let profile: (typeof profiles.rows)[0] | undefined;
      let usedTag: string | undefined;
      for (const tag of chain) {
        const id = tagToId.get(tag);
        if (!id) continue;
        const found = byLocale.get(id);
        if (found) {
          profile = found;
          usedTag = tag;
          break;
        }
      }
      if (!profile || !usedTag) {
        throw new Cmp053Error('SF-SYS-002', { details: [{ code: 'MISSING_FORMAT' }] });
      }
      const body: {
        locale_tag: string;
        date_skeleton: string;
        time_skeleton: string;
        formatted_date?: string;
        formatted_number?: string;
      } = {
        locale_tag: usedTag,
        date_skeleton: profile.date_skeleton,
        time_skeleton: profile.time_skeleton,
      };
      if (request.body.iso_date)
        body.formatted_date = formatIsoDate(profile, request.body.iso_date);
      if (request.body.number) body.formatted_number = formatDecimal(profile, request.body.number);
      return body;
    });
    sendPrivate(reply);
    return out;
  });

  app.post<{
    Body: {
      source_locale_tag: string;
      target_locale_tag: string;
      message_key: string;
      source_text: string;
      test_run_id?: string;
    };
  }>('/localization/assist', { schema: { body: ASSIST_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subjectOf(ctx),
      resource: {
        resource_type: 'LocalizationCatalog',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'LOCALIZATION_ASSIST',
    });
    const suggestion = await deps.assist.suggest({
      source_locale_tag: request.body.source_locale_tag,
      target_locale_tag: request.body.target_locale_tag,
      message_key: request.body.message_key,
      source_text: request.body.source_text,
      ...(request.body.test_run_id ? { test_run_id: request.body.test_run_id } : {}),
    });
    sendPrivate(reply);
    return suggestion;
  });
}
