import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR_A,
  ACTOR_OFFICER,
  CANARY,
  T1,
  T2,
  asTenant,
  bearer,
  buildApp,
  closeHarness,
  ctx,
  idem,
  setupHarness,
  type Harness,
} from './helpers.js';
import { fixtures } from '../doubles/context-resolver.js';

describe('CMP-053 API + tenant negatives', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('publish, fallback resolve, immutability, assist SIMULATED, zero cross-tenant leakage', async () => {
    const { app, authorizer } = await buildApp(h);
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
    fixtures.set('t2', ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_A } }));

    const defaultLocale = await app.inject({
      method: 'POST',
      url: '/v1/locales',
      headers: { ...bearer('t1'), ...idem('idem-loc-1') },
      payload: { locale_tag: 'aa', is_default: true },
    });
    expect(defaultLocale.statusCode).toBe(201);
    const defaultId = (defaultLocale.json() as { locale_id: string }).locale_id;

    const childLocale = await app.inject({
      method: 'POST',
      url: '/v1/locales',
      headers: { ...bearer('t1'), ...idem('idem-loc-2') },
      payload: { locale_tag: 'aa-BB', fallback_tag: 'aa', is_default: false },
    });
    expect(childLocale.statusCode).toBe(201);

    const fmt = await app.inject({
      method: 'PUT',
      url: `/v1/locales/${defaultId}/format-profile`,
      headers: { ...bearer('t1'), ...idem('idem-fmt-1') },
      payload: {
        date_skeleton: 'yyyyMMdd',
        time_skeleton: 'HHmm',
        decimal_separator: '.',
        group_separator: ',',
      },
    });
    expect(fmt.statusCode).toBe(200);

    const catalog = await app.inject({
      method: 'POST',
      url: '/v1/catalogs',
      headers: { ...bearer('t1'), ...idem('idem-cat-1') },
      payload: { catalog_code: 'UI_BUNDLE' },
    });
    expect(catalog.statusCode).toBe(201);
    const catalogId = (catalog.json() as { catalog_id: string }).catalog_id;

    const msgsDefault = await app.inject({
      method: 'PUT',
      url: `/v1/catalogs/${catalogId}/versions/1/messages`,
      headers: { ...bearer('t1'), ...idem('idem-msg-1') },
      payload: {
        locale_tag: 'aa',
        messages: [{ key: 'greeting', text: 'hello-generic' }],
      },
    });
    expect(msgsDefault.statusCode).toBe(200);

    const published = await app.inject({
      method: 'POST',
      url: `/v1/catalogs/${catalogId}/versions/1/publish`,
      headers: { ...bearer('t1'), ...idem('idem-pub-1') },
      payload: { reason: 'release-1' },
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as { status: string }).status).toBe('PUBLISHED');

    const mutatePublished = await app.inject({
      method: 'PUT',
      url: `/v1/catalogs/${catalogId}/versions/1/messages`,
      headers: { ...bearer('t1'), ...idem('idem-msg-mut') },
      payload: {
        locale_tag: 'aa',
        messages: [{ key: 'greeting', text: 'mutated' }],
      },
    });
    expect(mutatePublished.statusCode).toBe(400);
    expect(JSON.stringify(mutatePublished.json())).toContain('PUBLISHED_IMMUTABLE');

    const resolved = await app.inject({
      method: 'POST',
      url: '/v1/localization/resolve',
      headers: bearer('t1'),
      payload: { locale_tag: 'aa-BB', catalog_code: 'UI_BUNDLE', keys: ['greeting'] },
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedBody = resolved.json() as {
      items: { key: string; text: string; locale_tag: string }[];
    };
    expect(resolvedBody.items[0]).toMatchObject({
      key: 'greeting',
      text: 'hello-generic',
      locale_tag: 'aa',
    });

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/localization/resolve',
      headers: bearer('t1'),
      payload: { locale_tag: 'aa', catalog_code: 'UI_BUNDLE', keys: ['absent.key'] },
    });
    expect(missing.statusCode).toBe(404);
    expect(JSON.stringify(missing.json())).toContain('MISSING_MESSAGE');

    const formatted = await app.inject({
      method: 'POST',
      url: '/v1/format/resolve',
      headers: bearer('t1'),
      payload: { locale_tag: 'aa-BB', iso_date: '2026-10-04', number: '1234.5' },
    });
    expect(formatted.statusCode).toBe(200);
    expect(formatted.json()).toMatchObject({
      formatted_date: '20261004',
      formatted_number: '1,234.5',
    });

    const assist = await app.inject({
      method: 'POST',
      url: '/v1/localization/assist',
      headers: bearer('t1'),
      payload: {
        source_locale_tag: 'aa',
        target_locale_tag: 'aa-BB',
        message_key: 'greeting',
        source_text: 'hello-generic',
        test_run_id: 'ci-run-0001',
      },
    });
    expect(assist.statusCode).toBe(200);
    const assistBody = assist.json() as {
      authoritative: boolean;
      label: string;
      simulation: { simulation: boolean };
    };
    expect(assistBody.authoritative).toBe(false);
    expect(assistBody.label).toBe('TEST/SIMULATED');
    expect(assistBody.simulation.simulation).toBe(true);

    authorizer.denies.add('LOCALIZATION_RESOLVE');
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/localization/resolve',
      headers: bearer('t1'),
      payload: { locale_tag: 'aa', catalog_code: 'UI_BUNDLE', keys: ['greeting'] },
    });
    expect(denied.statusCode).toBe(403);
    expect(JSON.stringify(denied.json())).not.toContain(CANARY);
    authorizer.denies.clear();

    await asTenant(h.rt, T2, ACTOR_A, async (c) => {
      await c.query(
        `INSERT INTO sf_localization.locale (
           tenant_id, locale_id, locale_tag, is_default, status, created_by
         ) VALUES ($1,$2,'ww',true,'ACTIVE',$3)`,
        [T2, randomUUID(), ACTOR_A],
      );
    });
    const list = await app.inject({
      method: 'GET',
      url: '/v1/locales',
      headers: bearer('t1'),
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain('ww');
    expect(JSON.stringify(list.json())).not.toContain(CANARY);
    expect(JSON.stringify(list.json())).not.toContain(T2);

    const forged = await app.inject({
      method: 'GET',
      url: '/v1/locales',
      headers: { ...bearer('t1'), 'x-tenant-id': T2 },
    });
    expect(forged.statusCode).toBe(403);

    const unauth = await app.inject({ method: 'GET', url: '/v1/locales' });
    expect(unauth.statusCode).toBe(401);

    const events = await h.admin.query(
      `SELECT event_type FROM sf_localization.outbox_event
        WHERE tenant_id = $1 ORDER BY seq`,
      [T1],
    );
    const types = events.rows.map((r) => r.event_type as string);
    expect(types).toContain('LocalizationCatalogPublished');
    expect(types).toContain('AuditEventSubmitted');

    await app.close();
  }, 120_000);
});
