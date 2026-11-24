import { issueMessage, schemaAt, type FormSchemaView } from '@serviceform/ui-ux4g';
import { toPortalApplication, type PlatformApplication } from '../../../../lib/portal/applications';
import { catalogueIdForCase } from '../../../../lib/portal/catalogue-resolve';
import { command, readIssuance, readWorkingData } from '../../../../lib/portal/cases';
import { ownDraft, writeDraftData } from '../../../../lib/portal/drafts';
import {
  applyBody,
  liveOfferingFormPin,
  offeredForm,
  pinFor,
  sampleLab,
  serviceName,
  syntheticNameRefusal,
  validateWithEngine,
} from '../../../../lib/portal/forms';
import {
  jurisdictionRefusal,
  offeringJurisdictionScope,
} from '../../../../lib/portal/jurisdiction';
import { requireAvailableEvidenceDocument } from '../../../../lib/portal/documents';
import {
  crossSiteRefusal,
  currentCitizen,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';
import { requiresLabPayment } from '@serviceform/m10-sample-lab/fee-catalogue';

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
    apps.map(async (a) => {
      const catalogueId = catalogueIdForCase(a);
      return {
        ...toPortalApplication(
          a,
          await readWorkingData(citizen, a.application_id),
          await readIssuance(citizen, a),
          catalogueId,
        ),
        service_name: serviceName(catalogueId),
      };
    }),
  );
  return json(200, { source: 'PLATFORM', g6_issued: false, applications });
}

/**
 * Apply: authoritative CMP-009 validation of the data against the live offering / Studio pin,
 * then a CMP-015 draft pinned to the placement's published binding, working data,
 * MARK_READY_TO_SUBMIT and SUBMIT. Validate before draft so refused answers leave nothing filed.
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
  const { catalogueId, data, draftId } = applyBody(await request.json().catch(() => null));
  const offered = offeredForm(catalogueId);
  if (!offered) return json(404, { error_code: 'SF-SYS-002', message: 'Service not offered here' });
  const { version, offering } = offered;
  if (sampleLab()) {
    const refusal = syntheticNameRefusal(version.form.json_schema, data);
    if (refusal) return json(400, { error_code: 'SF-SYS-003', ...refusal });
  }

  const scope = offeringJurisdictionScope(catalogueId);
  const outOfScope = jurisdictionRefusal(version.form.json_schema, data, scope);
  if (outOfScope) {
    return json(400, { error_code: 'SF-SYS-003', ...outOfScope });
  }

  const cataloguePin = pinFor(version);
  const formPin = await liveOfferingFormPin(citizen, catalogueId, cataloguePin);

  const validated = await validateWithEngine(
    citizen,
    formPin,
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

  // SF-49: after CMP-009 validation, fail closed without a technically accepted CMP-013 document.
  if (sampleLab()) {
    const schemaProps = (version.form.json_schema as { properties?: Record<string, unknown> })
      .properties;
    if (schemaProps && Object.hasOwn(schemaProps, 'evidence_file_name')) {
      const evidenceId =
        typeof data['evidence_file_name'] === 'string' ? data['evidence_file_name'] : undefined;
      const gate = await requireAvailableEvidenceDocument(citizen, evidenceId);
      if (!gate.ok) {
        return json(422, {
          error_code: 'SF-EVD-002',
          message: gate.message,
          field_errors: [{ pointer: '/evidence_file_name', message: gate.message }],
          certified: false,
          g6_issued: false,
        });
      }
      if (gate.document.content_type && typeof data['evidence_mime'] !== 'string') {
        data['evidence_mime'] = gate.document.content_type;
      }
    }
  }

  let app: PlatformApplication;
  if (draftId) {
    // Saved application: submit that same CMP-015 draft so no orphan draft is left behind.
    const owned = await ownDraft(citizen, draftId, offering, formPin.version_id);
    if (!owned.ok) return owned.response;
    const stored = await writeDraftData(citizen, owned.app, data, {
      expectedRevision: null,
      key: keys.base,
      expectedHash: validated.execution.data_hash,
    });
    if (!stored.ok) return stored.response;
    app = stored.app;
  } else {
    const draft = await platform('POST', '/v1/applications', {
      token: citizen.token,
      ...keys.key('draft'),
      body: { tenant_service_binding_id: offering.tenant_service_binding_id },
    });
    const created = draft.body['application'] as PlatformApplication | undefined;
    if (draft.status !== 201 || !created) return relay(draft);
    app = created;
    if (app.pins.form_version_id !== formPin.version_id) {
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
  }

  const transitions =
    app.state === 'READY_TO_SUBMIT' ? ['SUBMIT'] : ['MARK_READY_TO_SUBMIT', 'SUBMIT'];
  for (const step of transitions) {
    const next = await command(
      citizen,
      app,
      step,
      keys.base ? `${keys.base}-${step.toLowerCase()}` : undefined,
    );
    if (!next.ok) return relay(next.res);
    app = next.app;
  }

  // SF-56: SAMPLE_LAB DUMMY fee>0 (e.g. IND-EDU-004) enters PAYMENT_PENDING.
  // Residence ₹0 and other zero-fee offers skip payment (unchanged MARK_RECEIVED path).
  if (sampleLab() && requiresLabPayment(catalogueId)) {
    const pay = await command(
      citizen,
      app,
      'ENTER_PAYMENT_PENDING',
      keys.base ? `${keys.base}-enter-payment` : undefined,
    );
    if (!pay.ok) return relay(pay.res);
    app = pay.app;
  }

  return json(201, {
    application: toPortalApplication(app, data, null, catalogueId),
    form_execution: validated.execution,
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
  });
}
