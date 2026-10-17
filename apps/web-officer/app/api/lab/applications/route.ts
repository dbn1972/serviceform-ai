import { listApplications, PUBLIC_SAMPLE_LAB_POLICY } from '@serviceform/m10-sample-lab';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({
    label: 'SAMPLE_LAB',
    g6_issued: false,
    digilocker_mode: PUBLIC_SAMPLE_LAB_POLICY.digilocker_mode,
    applications: listApplications(),
  });
}
