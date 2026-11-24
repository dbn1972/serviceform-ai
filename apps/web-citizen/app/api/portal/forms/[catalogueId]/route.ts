import {
  recordBffLatency,
  serverTimingHeader,
} from '@serviceform/observability/server-product-metrics';
import { buildSampleLabFormData } from '@serviceform/service-templates';
import {
  interpret,
  liveOfferingFormPin,
  offeredForm,
  pinFor,
  sampleLab,
  type FormPin,
} from '../../../../../lib/portal/forms';
import {
  formPackageWithJurisdictionScope,
  offeringJurisdictionScope,
} from '../../../../../lib/portal/jurisdiction';
import { crossSiteRefusal, currentCitizen, json, relay } from '../../../../../lib/portal/platform';
import { profilePrefill, readProfile } from '../../../../../lib/portal/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ catalogueId: string }> };

const SIGN_IN_REQUIRED = 'Sign in with your mobile number to continue';
const NOT_OFFERED = { error_code: 'SF-SYS-002', message: 'Service not offered here' };

function interpretation(body: Record<string, unknown>) {
  return {
    controls: body['controls'] ?? [],
    visible_fields: body['visible_fields'] ?? [],
    required_fields: body['required_fields'] ?? [],
    renderer_ids: body['renderer_ids'] ?? [],
    client_validation_authoritative: false,
  };
}

async function livePin(
  citizen: NonNullable<Awaited<ReturnType<typeof currentCitizen>>>,
  catalogueId: string,
): Promise<{ pin: FormPin; source: 'CMP-033' | 'CATALOGUE' } | null> {
  const offered = offeredForm(catalogueId);
  if (!offered) return null;
  const catalogue = pinFor(offered.version);
  const pin = await liveOfferingFormPin(citizen, catalogueId, catalogue);
  return {
    pin,
    source: pin.version_id === catalogue.version_id ? 'CATALOGUE' : 'CMP-033',
  };
}

/**
 * The pinned published form of an offered service plus its CMP-009 interpretation (visibility,
 * required fields, UX4G renderer ids, labels) for the initial data. Initial data is the SAMPLE_LAB
 * sample answers overlaid with the citizen's consented CMP-005 profile claims.
 */
export async function GET(request: Request, ctx: Ctx) {
  const started = performance.now();
  const { catalogueId } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) {
    recordBffLatency('CITIZEN_FORM_LOAD_MS', performance.now() - started, 'UNAUTHORIZED');
    return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  }
  const offered = offeredForm(catalogueId);
  if (!offered) {
    recordBffLatency('CITIZEN_FORM_LOAD_MS', performance.now() - started, 'NOT_FOUND');
    return json(404, NOT_OFFERED);
  }
  const live = await livePin(citizen, catalogueId);
  if (!live) {
    recordBffLatency('CITIZEN_FORM_LOAD_MS', performance.now() - started, 'NOT_FOUND');
    return json(404, NOT_OFFERED);
  }
  const { template, version } = offered;
  const scope = offeringJurisdictionScope(catalogueId);
  const scopedForm = formPackageWithJurisdictionScope(version.form, scope);
  const sample = sampleLab()
    ? (version.sample_data ?? buildSampleLabFormData(scopedForm.json_schema))
    : {};
  const profile = await readProfile(citizen);
  const prefill = profilePrefill(scopedForm.json_schema, sample, profile);
  const res = await interpret(citizen, live.pin, prefill);
  const elapsed = performance.now() - started;
  if (res.status !== 200) {
    recordBffLatency('CITIZEN_FORM_LOAD_MS', elapsed, 'ERROR', { pin_source: live.source });
    return relay(res, 'The form engine is unavailable');
  }
  recordBffLatency('CITIZEN_FORM_LOAD_MS', elapsed, 'OK', {
    pin_source: live.source,
    catalogue_class: 'CERTIFICATE',
  });
  return json(
    200,
    {
      catalogue_id: template.catalogue_id,
      service: {
        name: template.name,
        policy: template.policy,
        indicative_checks: template.indicative_checks,
      },
      form: {
        pin: live.pin,
        version: version.version,
        package: scopedForm,
        pin_source: live.source,
      },
      jurisdiction_scope: {
        allowed_states: scope.allowed_states,
        allowed_districts: scope.allowed_districts,
        allowed_municipalities: scope.allowed_municipalities,
      },
      prefill,
      prefill_source: profile ? 'CMP-005' : sampleLab() ? 'SAMPLE_LAB' : null,
      interpretation: interpretation(res.body),
      engine: 'CMP-009',
      publication: live.source === 'CMP-033' ? 'STUDIO' : 'SIMULATED',
      g6_issued: false,
      certified: false,
    },
    { 'Server-Timing': serverTimingHeader('form_load', elapsed) },
  );
}

/** Re-interpret with the citizen's current data (only rule-condition changes need this). */
export async function POST(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { catalogueId } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const live = await livePin(citizen, catalogueId);
  if (!live) return json(404, NOT_OFFERED);
  const raw = (await request.json().catch(() => null)) as { data?: unknown } | null;
  const data = raw?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Send the form data as an object' });
  }
  const res = await interpret(citizen, live.pin, data as Record<string, unknown>);
  if (res.status !== 200) return relay(res, 'The form engine is unavailable');
  return json(200, { interpretation: interpretation(res.body), engine: 'CMP-009' });
}
