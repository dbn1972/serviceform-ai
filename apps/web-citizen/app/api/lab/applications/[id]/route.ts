import { getApplication } from '@serviceform/m10-sample-lab';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => {
    const app = getApplication(id);
    if (!app) return NextResponse.json({ error_code: 'SF-LAB-404' }, { status: 404 });
    return NextResponse.json({ application: app, g6_issued: false });
  });
}
