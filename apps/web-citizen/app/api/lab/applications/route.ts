import {
  createApplication,
  listApplications,
  PUBLIC_SAMPLE_LAB_POLICY,
} from '@serviceform/m10-sample-lab';
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

export async function POST(req: Request) {
  const body = (await req.json()) as {
    applicant_name?: string;
    applicant_dob?: string;
    applicant_gender?: string;
    applicant_mobile?: string;
    applicant_aadhaar_last4?: string;
    residence_address?: {
      house_no_or_name?: string;
      locality?: string;
      post_office?: string;
      district?: string;
      state_code?: string;
      pincode?: string;
    };
    residence_duration_months?: number;
    purpose_of_certificate?: string;
    evidence_type?: string;
    evidence_file_name?: string;
    evidence_mime?: string;
  };

  const addr = body.residence_address;
  if (
    !body.applicant_name ||
    !body.applicant_dob ||
    !body.applicant_gender ||
    !addr?.house_no_or_name ||
    !addr.locality ||
    !addr.district ||
    !addr.state_code ||
    !addr.pincode ||
    body.residence_duration_months === undefined ||
    !body.purpose_of_certificate ||
    !body.evidence_type
  ) {
    return NextResponse.json({ error_code: 'SF-LAB-VALIDATION' }, { status: 400 });
  }

  const app = createApplication({
    applicant_name: body.applicant_name,
    applicant_dob: body.applicant_dob,
    applicant_gender: body.applicant_gender,
    ...(body.applicant_mobile ? { applicant_mobile: body.applicant_mobile } : {}),
    ...(body.applicant_aadhaar_last4
      ? { applicant_aadhaar_last4: body.applicant_aadhaar_last4 }
      : {}),
    residence_address: {
      house_no_or_name: addr.house_no_or_name,
      locality: addr.locality,
      ...(addr.post_office ? { post_office: addr.post_office } : {}),
      district: addr.district,
      state_code: addr.state_code,
      pincode: addr.pincode,
    },
    residence_duration_months: Number(body.residence_duration_months),
    purpose_of_certificate: body.purpose_of_certificate,
    evidence_type: body.evidence_type,
    ...(body.evidence_file_name ? { evidence_file_name: body.evidence_file_name } : {}),
    ...(body.evidence_mime ? { evidence_mime: body.evidence_mime } : {}),
  });

  return NextResponse.json({ application: app, g6_issued: false }, { status: 201 });
}
