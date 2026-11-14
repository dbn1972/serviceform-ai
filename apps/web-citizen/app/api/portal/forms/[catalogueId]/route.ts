import {
  interpret,
  offeredForm,
  pinFor,
  sampleLab,
  studioFormPin,
  type FormPin,
} from '../../../../../lib/portal/forms';
import { crossSiteRefusal, currentCitizen, json, platform, relay } from '../../../../../lib/portal/platform';
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
  const res = await platform('GET', `/v1/lab/offerings/${catalogueId}/form-pin`, {
    token: citizen.token,
  });
  if (res.status === 200 && typeof res.body['version_id'] === 'string') {
    const versionId = res.body['version_id'] as string;
    if (versionId !== catalogue.version_id) {
      const studio =
        res.body['source'] === 'CMP-033' &&
        typeof res.body['form_key'] === 'string' &&
        typeof res.body['content_hash'] === 'string'
          ? {
              form_key: res.body['form_key'] as string,
              version_id: versionId,
              content_hash: res.body['content_hash'] as string,
            }
          : await studioFormPin(citizen, versionId);
      if (studio) return { pin: studio, source: 'CMP-033' };
    }
  }
  return { pin: catalogue, source: 'CATALOGUE' };
}

/**
 * The pinned published form of an offered service plus its CMP-009 interpretation (visibility,
 * required fields, UX4G renderer ids, labels) for the initial data. Initial data is the SAMPLE_LAB
 * sample answers overlaid with the citizen's consented CMP-005 profile claims.
 */
export async function GET(request: Request, ctx: Ctx) {
  const { catalogueId } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const offered = offeredForm(catalogueId);
  if (!offered) return json(404, NOT_OFFERED);
  const live = await livePin(citizen, catalogueId);
  if (!live) return json(404, NOT_OFFERED);
  const { template, version } = offered;
  const sample = sampleLab() ? (version.sample_data ?? {}) : {};
  const profile = await readProfile(citizen);
  const prefill = profilePrefill(version.form.json_schema, sample, profile);
  const res = await interpret(citizen, live.pin, prefill);
  if (res.status !== 200) return relay(res, 'The form engine is unavailable');
  return json(200, {
    catalogue_id: template.catalogue_id,
    service: {
      name: template.name,
      policy: template.policy,
      indicative_checks: template.indicative_checks,
    },
    form: {
      pin: live.pin,
      version: version.version,
      package: version.form,
      pin_source: live.source,
    },
    prefill,
    prefill_source: profile ? 'CMP-005' : sampleLab() ? 'SAMPLE_LAB' : null,
    interpretation: interpretation(res.body),
    engine: 'CMP-009',
    publication: live.source === 'CMP-033' ? 'STUDIO' : 'SIMULATED',
    g6_issued: false,
  });
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
