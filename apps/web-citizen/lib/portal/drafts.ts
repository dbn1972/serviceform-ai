import type { CaseState, PlatformApplication } from './applications';
import { catalogueIdForCase } from './catalogue-resolve';
import { command } from './cases';
import { isUuid, json, platform, relay, type Citizen, type PortalOffering } from './platform';

/**
 * Save and resume on the platform path. A citizen's unfinished answers live in a CMP-015 DRAFT
 * pinned to the offering's published binding, as working data (editable only while DRAFT,
 * CCR-M10-001). Drafts are never validated or submitted here: CMP-009 stays authoritative at
 * submit, and the officer workbench never lists DRAFT cases.
 */

export const NOT_FOUND = {
  error_code: 'SF-SYS-002',
  message: 'We could not find this saved application.',
} as const;
export const ALREADY_SUBMITTED = 'This application has already been submitted.';
export const FORM_CHANGED =
  'This service form was updated after you saved. Start a new application to use the new form.';
export const SAVED_ELSEWHERE =
  'Your saved application changed in another window. Reload the page to continue from the latest save.';

/** Form-session key supplied by the browser; per-step platform keys are derived from it. */
const SESSION_KEY = /^[A-Za-z0-9_-]{16,64}$/;

const RESUMABLE: ReadonlySet<CaseState> = new Set(['DRAFT', 'READY_TO_SUBMIT']);

export function isResumable(state: CaseState): boolean {
  return RESUMABLE.has(state);
}

export function sessionKey(raw: string | null): string | null {
  return raw && SESSION_KEY.test(raw) ? raw : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface DraftSaveInput {
  catalogueId: string;
  data: Record<string, unknown>;
  expectedRevision: number | null;
}

/** `{ catalogue_id, data, expected_revision? }`; anything else is refused before the platform. */
export function parseDraftSave(raw: unknown): DraftSaveInput | null {
  if (!isRecord(raw) || typeof raw['catalogue_id'] !== 'string' || !isRecord(raw['data'])) {
    return null;
  }
  const rev = raw['expected_revision'];
  if (rev !== undefined && !(typeof rev === 'number' && Number.isInteger(rev) && rev >= 0)) {
    return null;
  }
  return {
    catalogueId: raw['catalogue_id'],
    data: raw['data'],
    expectedRevision: rev === undefined ? null : rev,
  };
}

export interface WorkingDataMeta {
  revision: number;
  data_hash: string;
  form_version_id: string;
  updated_at: string;
  data: Record<string, unknown>;
}

/** CMP-015 working data with its revision, or null when none has been stored yet. */
export async function readWorkingDataMeta(
  citizen: Citizen,
  applicationId: string,
): Promise<WorkingDataMeta | null> {
  const res = await platform('GET', `/v1/applications/${applicationId}/working-data`, {
    token: citizen.token,
  });
  const wd = res.body['working_data'];
  if (res.status !== 200 || !isRecord(wd) || typeof wd['revision'] !== 'number') return null;
  return {
    revision: wd['revision'],
    data_hash: String(wd['data_hash'] ?? ''),
    form_version_id: String(wd['form_version_id'] ?? ''),
    updated_at: String(wd['updated_at'] ?? ''),
    data: isRecord(wd['data']) ? wd['data'] : {},
  };
}

export interface DraftView {
  application_id: string;
  catalogue_id: string;
  state: CaseState;
  revision: number;
  form_version_id: string;
  saved_at: string;
}

export function draftView(app: PlatformApplication, meta: WorkingDataMeta | null): DraftView {
  return {
    application_id: app.application_id,
    catalogue_id: catalogueIdForCase(app),
    state: app.state,
    revision: meta?.revision ?? 0,
    form_version_id: app.pins.form_version_id,
    saved_at: meta?.updated_at || app.updated_at,
  };
}

type Refusal = { ok: false; response: Response };

/** The citizen's own case, if CMP-015/OPA allow it; other owners read as "not found". */
export async function readOwnCase(
  citizen: Citizen,
  applicationId: string,
): Promise<{ ok: true; app: PlatformApplication } | Refusal> {
  if (!isUuid(applicationId)) return { ok: false, response: json(404, NOT_FOUND) };
  const res = await platform('GET', `/v1/applications/${applicationId}`, { token: citizen.token });
  const app = res.body['application'] as PlatformApplication | undefined;
  if (res.status === 403 || res.status === 404) {
    return { ok: false, response: json(404, NOT_FOUND) };
  }
  if (res.status !== 200 || !app) return { ok: false, response: relay(res) };
  return { ok: true, app };
}

/**
 * A draft this citizen may still change for this offering and form version. A case for another
 * service reads as not found; a submitted case or a republished form is a conflict the browser
 * can explain (Constitution §35: never silently repoint to a new version).
 */
export async function ownDraft(
  citizen: Citizen,
  applicationId: string,
  offering: PortalOffering,
  formVersionId: string,
): Promise<{ ok: true; app: PlatformApplication } | Refusal> {
  const own = await readOwnCase(citizen, applicationId);
  if (!own.ok) return own;
  const { app } = own;
  if (app.pins.tenant_service_binding_id !== offering.tenant_service_binding_id) {
    return { ok: false, response: json(404, NOT_FOUND) };
  }
  if (!isResumable(app.state)) {
    return {
      ok: false,
      response: json(409, {
        error_code: 'SF-APP-001',
        message: ALREADY_SUBMITTED,
        application_id: app.application_id,
      }),
    };
  }
  if (app.pins.form_version_id !== formVersionId) {
    return { ok: false, response: json(409, { error_code: 'SF-FORM-001', message: FORM_CHANGED }) };
  }
  return { ok: true, app };
}

function platformKey(key: string | null, step: string) {
  return key ? { idempotencyKey: `${key}-${step}` } : { idempotent: true as const };
}

/**
 * Writes working data on a resumable draft (returning READY_TO_SUBMIT to DRAFT first, since
 * working data is only editable while DRAFT). Skips the write when the stored hash already matches.
 */
export async function writeDraftData(
  citizen: Citizen,
  draft: PlatformApplication,
  data: Record<string, unknown>,
  opts: { expectedRevision: number | null; key: string | null; expectedHash?: string },
): Promise<{ ok: true; app: PlatformApplication; meta: WorkingDataMeta } | Refusal> {
  let app = draft;
  const current = await readWorkingDataMeta(citizen, app.application_id);
  if (opts.expectedHash && current?.data_hash === opts.expectedHash) {
    return { ok: true, app, meta: current };
  }
  // CMP-015 replays a retried save under the same key and refuses a stale revision.
  const revision = opts.expectedRevision ?? current?.revision ?? 0;
  if (app.state === 'READY_TO_SUBMIT') {
    const back = await command(
      citizen,
      app,
      'RETURN_TO_DRAFT',
      opts.key ? `${opts.key}-return-to-draft` : undefined,
    );
    if (!back.ok) return { ok: false, response: relay(back.res) };
    app = back.app;
  }
  const res = await platform('PUT', `/v1/applications/${app.application_id}/working-data`, {
    token: citizen.token,
    ...platformKey(opts.key, `data-r${revision}`),
    body: { form_version_id: app.pins.form_version_id, data, expected_revision: revision },
  });
  if (res.status === 409) {
    return {
      ok: false,
      response: json(409, { error_code: 'SF-APP-001', message: SAVED_ELSEWHERE }),
    };
  }
  const wd = res.body['working_data'];
  if (res.status !== 200 || !isRecord(wd)) return { ok: false, response: relay(res) };
  const meta: WorkingDataMeta = {
    revision: Number(wd['revision']),
    data_hash: String(wd['data_hash'] ?? ''),
    form_version_id: String(wd['form_version_id'] ?? ''),
    updated_at: String(wd['updated_at'] ?? ''),
    data,
  };
  if (opts.expectedHash && meta.data_hash !== opts.expectedHash) {
    return {
      ok: false,
      response: json(409, {
        error_code: 'SF-FORM-001',
        message: 'The stored answers do not match the validated answers',
      }),
    };
  }
  return { ok: true, app, meta };
}

/** New CMP-015 draft on the offering's published binding (one per browser form session). */
export async function createDraft(
  citizen: Citizen,
  offering: PortalOffering,
  formVersionId: string,
  key: string | null,
): Promise<{ ok: true; app: PlatformApplication } | Refusal> {
  const res = await platform('POST', '/v1/applications', {
    token: citizen.token,
    ...platformKey(key, 'create'),
    body: { tenant_service_binding_id: offering.tenant_service_binding_id },
  });
  const app = res.body['application'] as PlatformApplication | undefined;
  if (res.status !== 201 || !app) return { ok: false, response: relay(res) };
  if (app.pins.form_version_id !== formVersionId) {
    return { ok: false, response: json(409, { error_code: 'SF-FORM-001', message: FORM_CHANGED }) };
  }
  return { ok: true, app };
}
