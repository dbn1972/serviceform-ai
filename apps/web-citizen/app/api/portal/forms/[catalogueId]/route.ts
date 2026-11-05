import { formPin } from '@serviceform/service-templates';
import { interpret, offeredForm, sampleLab } from '../../../../../lib/portal/forms';
import { crossSiteRefusal, currentCitizen, json, relay } from '../../../../../lib/portal/platform';

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

/**
 * The pinned published form of an offered service plus its CMP-009 interpretation (visibility,
 * required fields, UX4G renderer ids, labels) for the initial data.
 */
export async function GET(request: Request, ctx: Ctx) {
  const { catalogueId } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const offered = offeredForm(catalogueId);
  if (!offered) return json(404, NOT_OFFERED);
  const { template, version } = offered;
  const prefill = sampleLab() ? (version.sample_data ?? {}) : {};
  const res = await interpret(citizen, version, prefill);
  if (res.status !== 200) return relay(res, 'The form engine is unavailable');
  return json(200, {
    catalogue_id: template.catalogue_id,
    service: {
      name: template.name,
      policy: template.policy,
      indicative_checks: template.indicative_checks,
    },
    form: {
      pin: formPin(version),
      version: version.version,
      package: version.form,
    },
    prefill,
    interpretation: interpretation(res.body),
    engine: 'CMP-009',
    publication: 'SIMULATED',
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
  const offered = offeredForm(catalogueId);
  if (!offered) return json(404, NOT_OFFERED);
  const raw = (await request.json().catch(() => null)) as { data?: unknown } | null;
  const data = raw?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Send the form data as an object' });
  }
  const res = await interpret(citizen, offered.version, data as Record<string, unknown>);
  if (res.status !== 200) return relay(res, 'The form engine is unavailable');
  return json(200, { interpretation: interpretation(res.body), engine: 'CMP-009' });
}
