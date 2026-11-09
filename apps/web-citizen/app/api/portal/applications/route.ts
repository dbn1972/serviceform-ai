import { issueMessage, schemaAt, type FormSchemaView } from '@serviceform/ui-ux4g';
import { toPortalApplication, type PlatformApplication } from '../../../../lib/portal/applications';
import { command, readIssuance, readWorkingData } from '../../../../lib/portal/cases';
import {
  applyBody,
  offeredForm,
  sampleLab,
  syntheticNameRefusal,
  validateWithEngine,
} from '../../../../lib/portal/forms';
import {
  crossSiteRefusal,
  currentCitizen,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN_REQUIRED = 'Sign in with your mobile number to continue';

/** The signed-in citizen's applications: CMP-015 filters by owner in SQL under the portal tenant. */
export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const res = await platform('GET', '/v1/applications?limit=50', { token: citizen.token });
  if (res.status !== 200) return relay(res);
  const apps = (res.body['applications'] ?? []) as PlatformApplication[];
  const applications = await Promise.all(
    apps.map(async (a) =>
      toPortalApplication(
        a,
        await readWorkingData(citizen, a.application_id),
        await readIssuance(citizen, a),
      ),
    ),
  );
  return json(200, { source: 'PLATFORM', g6_issued: false, applications });
}

/**
 * Apply: authoritative CMP-009 validation of the data against the pinned published form, then a
 * CMP-015 draft pinned to the placement's published binding, working data, MARK_READY_TO_SUBMIT
 * and SUBMIT. Each step is OPA-authorized as the owning citizen. The draft must pin the form
 * version CMP-009 validated, and CMP-015 must store data with the hash CMP-009 validated.
 */
const SUBMISSION_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** One key per form session: a retried submit replays every CMP-015 step instead of duplicating. */
function stepKeys(raw: string | null) {
  const base = raw && SUBMISSION_KEY.test(raw) ? `apply-${raw}` : null;
  const key = (step: string) =>
    base ? { idempotencyKey: `${base}-${step}` } : { idempotent: true };
  return { key, base };
}

export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const keys = stepKeys(request.headers.get('idempotency-key'));
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const { catalogueId, data } = applyBody(await request.json().catch(() => null));
  const offered = offeredForm(catalogueId);
  if (!offered) return json(404, { error_code: 'SF-SYS-002', message: 'Service not offered here' });
  const { version, offering } = offered;
  if (sampleLab()) {
    const refusal = syntheticNameRefusal(version.form.json_schema, data);
    if (refusal) return json(400, { error_code: 'SF-SYS-003', ...refusal });
  }

  const validated = await validateWithEngine(
    citizen,
    version,
    data,
    keys.base ? { idempotencyKey: `${keys.base}-form` } : { idempotent: true },
  );
  if (!validated.ok) {
    if ('res' in validated) return relay(validated.res, 'The form engine is unavailable');
    const schema = version.form.json_schema as FormSchemaView;
    return json(422, {
      error_code: 'SF-FORM-002',
      message: 'Some answers need attention',
      field_errors: validated.issues.map((i) => ({
        ...i,
        message: issueMessage(schemaAt(schema, i.pointer), i.code, i.pointer),
      })),
    });
  }

  const draft = await platform('POST', '/v1/applications', {
    token: citizen.token,
    ...keys.key('draft'),
    body: { tenant_service_binding_id: offering.tenant_service_binding_id },
  });
  let app = draft.body['application'] as PlatformApplication | undefined;
  if (draft.status !== 201 || !app) return relay(draft);
  if (app.pins.form_version_id !== version.version_id) {
    return json(409, {
      error_code: 'SF-FORM-001',
      message: 'This service form changed. Reload the page and try again.',
    });
  }

  const wd = await platform('PUT', `/v1/applications/${app.application_id}/working-data`, {
    token: citizen.token,
    ...keys.key('data'),
    body: { form_version_id: app.pins.form_version_id, data, expected_revision: 0 },
  });
  if (wd.status !== 200) return relay(wd);
  const stored = wd.body['working_data'] as { data_hash?: string } | undefined;
  if (stored?.data_hash !== validated.execution.data_hash) {
    return json(409, {
      error_code: 'SF-FORM-001',
      message: 'The stored answers do not match the validated answers',
    });
  }

  for (const step of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
    const next = await command(
      citizen,
      app,
      step,
      keys.base ? `${keys.base}-${step.toLowerCase()}` : undefined,
    );
    if (!next.ok) return relay(next.res);
    app = next.app;
  }
  return json(201, {
    application: toPortalApplication(app, data),
    form_execution: validated.execution,
    source: 'PLATFORM',
    g6_issued: false,
  });
}
