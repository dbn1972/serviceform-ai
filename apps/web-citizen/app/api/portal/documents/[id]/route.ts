import { getDocument, isTechnicallyAccepted } from '../../../../../lib/portal/documents';
import { currentCitizen, isUuid, json, relay } from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CMP-013 document metadata for the signed-in owner (no object bytes). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) {
    return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  }
  if (!isUuid(id)) {
    return json(404, { error_code: 'SF-SYS-002', message: 'Document not found' });
  }
  const got = await getDocument(citizen, id);
  if (!got.ok) {
    if (got.res.status === 403 || got.res.status === 404) {
      return json(404, { error_code: 'SF-SYS-002', message: 'Document not found' });
    }
    return relay(got.res);
  }
  return json(200, {
    document: got.document,
    technically_accepted: isTechnicallyAccepted(got.document),
    business_verified: false,
    certified: false,
    g6_issued: false,
  });
}
