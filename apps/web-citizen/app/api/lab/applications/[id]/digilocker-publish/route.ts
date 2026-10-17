import { mockDigiLockerPublish, ODISHA_LAB_POLICY } from '@serviceform/m10-sample-lab';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * SAMPLE_LAB DigiLocker SIMULATED publish — no REAL credentials, not G6.
 */
export function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => {
    const result = mockDigiLockerPublish(id);
    if (!result.ok) {
      return NextResponse.json(
        {
          error_code: result.error ?? 'SF-LAB-DIGILOCKER',
          digilocker_mode: ODISHA_LAB_POLICY.digilocker_mode,
          g6_issued: false,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({
      application: result.application,
      digilocker_mode: 'SIMULATED',
      doc_type: ODISHA_LAB_POLICY.digilocker_doc_type,
      g6_issued: false,
      note: 'SIMULATED DigiLocker publish — SAMPLE_LAB only; not PRODUCTION/REAL',
    });
  });
}
