import {
  getApplication,
  PUBLIC_SAMPLE_LAB_POLICY,
  updateApplication,
} from '@serviceform/m10-sample-lab';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => {
    const app = getApplication(id);
    if (!app) return NextResponse.json({ error_code: 'SF-LAB-404' }, { status: 404 });
    return NextResponse.json({ application: app, g6_issued: false });
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    action?: 'APPROVE' | 'REJECT';
    rejection_reason?: string;
  };
  const app = getApplication(id);
  if (!app) return NextResponse.json({ error_code: 'SF-LAB-404' }, { status: 404 });
  if (app.status !== 'SUBMITTED') {
    return NextResponse.json({ error_code: 'SF-LAB-INVALID_STATE' }, { status: 409 });
  }

  if (body.action === 'REJECT') {
    const updated = updateApplication(id, {
      status: 'REJECTED',
      rejection_reason: body.rejection_reason ?? 'Rejected by officer (SAMPLE_LAB)',
    });
    return NextResponse.json({ application: updated, g6_issued: false });
  }

  if (body.action === 'APPROVE') {
    if (!app.eligibility_pass) {
      return NextResponse.json(
        {
          error_code: 'SF-LAB-ELIGIBILITY',
          message: `Residence duration below public-sample minimum (${PUBLIC_SAMPLE_LAB_POLICY.min_residence_months} months)`,
        },
        { status: 400 },
      );
    }
    const credentialId = `SAMPLE_LAB_CRED_${randomUUID()}`;
    const updated = updateApplication(id, {
      status: 'ISSUED',
      credential_id: credentialId,
    });
    return NextResponse.json({
      application: updated,
      credential_template_ref: PUBLIC_SAMPLE_LAB_POLICY.credential_template_ref,
      g6_issued: false,
    });
  }

  return NextResponse.json({ error_code: 'SF-LAB-BAD_ACTION' }, { status: 400 });
}
