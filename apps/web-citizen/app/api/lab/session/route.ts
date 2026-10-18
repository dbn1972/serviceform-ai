import { NextResponse } from 'next/server';
import {
  CITIZEN_LAB_COOKIE,
  cookieValue,
  encodeCitizenSession,
  parseCitizenSession,
  setCitizenCookie,
  type CitizenLabSession,
} from '../../../../lib/lab-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const session = parseCitizenSession(
    cookieValue(request.headers.get('cookie'), CITIZEN_LAB_COOKIE),
  );
  if (!session) {
    return NextResponse.json({ authenticated: false, g6_issued: false, simulation: true });
  }
  return NextResponse.json({ authenticated: true, ...session });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    display_name?: string;
    mobile?: string;
  };
  const display_name = (body.display_name ?? '').trim();
  const mobile = (body.mobile ?? '').trim();
  if (!display_name || !mobile) {
    return NextResponse.json(
      { error_code: 'SF-LAB-SESSION-INPUT', message: 'display_name and mobile are required' },
      { status: 400 },
    );
  }
  if (!/^SAMPLE/i.test(display_name) && !/^Lab /i.test(display_name)) {
    // Keep fixtures synthetic: require SAMPLE/Lab prefix so real PII is not encouraged.
    return NextResponse.json(
      {
        error_code: 'SF-LAB-SESSION-SYNTHETIC',
        message: 'SAMPLE_LAB requires a synthetic display name starting with SAMPLE or Lab',
      },
      { status: 400 },
    );
  }
  if (!/^9\d{9}$/.test(mobile)) {
    return NextResponse.json(
      {
        error_code: 'SF-LAB-SESSION-MOBILE',
        message: 'Use a synthetic 10-digit mobile starting with 9 (SAMPLE_LAB)',
      },
      { status: 400 },
    );
  }

  const session: CitizenLabSession = {
    surface: 'citizen_web',
    display_name,
    mobile,
    tenant_label: 'SAMPLE_LAB',
    simulation: true,
    g6_issued: false,
    created_at: new Date().toISOString(),
  };
  const token = encodeCitizenSession(session);
  return new NextResponse(JSON.stringify({ authenticated: true, ...session }), {
    status: 201,
    headers: {
      'content-type': 'application/json',
      'set-cookie': setCitizenCookie(token, 28800),
    },
  });
}

export function DELETE() {
  return new NextResponse(null, {
    status: 204,
    headers: { 'set-cookie': setCitizenCookie('', 0) },
  });
}
