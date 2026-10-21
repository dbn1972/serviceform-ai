import { existsSync, unlinkSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createApplication,
  getApplication,
  labStorePath,
  listApplicationsForCitizen,
  mockDigiLockerPublish,
  PUBLIC_SAMPLE_LAB_POLICY,
  updateApplication,
} from '../src/index';

const path = labStorePath();

afterEach(() => {
  if (existsSync(path)) unlinkSync(path);
});

describe('m10 SAMPLE_LAB store + DigiLocker mock', () => {
  it('creates application with public-sample eligibility rule and SIMULATED DigiLocker pending', () => {
    const app = createApplication({
      applicant_name: 'SAMPLE LAB Applicant',
      applicant_dob: '1990-01-01',
      applicant_gender: 'OTHER',
      residence_address: {
        house_no_or_name: '1',
        locality: 'Lab',
        district: 'Lab',
        state_code: 'OD',
        pincode: '751001',
      },
      residence_duration_months: 18,
      purpose_of_certificate: 'SAMPLE_LAB',
      evidence_type: 'ELECTRICITY_BILL',
    });
    expect(app.eligibility_pass).toBe(true);
    expect(app.fee_paisa).toBe(0);
    expect(app.digilocker.mode).toBe('SIMULATED');
    expect(app.digilocker.doc_type).toBe(PUBLIC_SAMPLE_LAB_POLICY.digilocker_doc_type);
    expect(PUBLIC_SAMPLE_LAB_POLICY.g6_issued).toBe(false);
  });

  it('refuses DigiLocker publish before issue; publishes SIMULATED after issue', () => {
    const app = createApplication({
      applicant_name: 'SAMPLE LAB Applicant',
      applicant_dob: '1990-01-01',
      applicant_gender: 'OTHER',
      residence_address: {
        house_no_or_name: '1',
        locality: 'Lab',
        district: 'Lab',
        state_code: 'OD',
        pincode: '751001',
      },
      residence_duration_months: 18,
      purpose_of_certificate: 'SAMPLE_LAB',
      evidence_type: 'ELECTRICITY_BILL',
    });
    expect(mockDigiLockerPublish(app.id).ok).toBe(false);
    updateApplication(app.id, { status: 'ISSUED', credential_id: 'SAMPLE_LAB_CRED_X' });
    const pub = mockDigiLockerPublish(app.id);
    expect(pub.ok).toBe(true);
    expect(getApplication(app.id)?.digilocker.status).toBe('PUBLISHED');
    expect(getApplication(app.id)?.digilocker.provider_transaction_ref).toMatch(/^sim:/);
  });

  it('lists only the signed-in citizen’s applications (citizen isolation)', () => {
    const base = {
      applicant_name: 'SAMPLE LAB Applicant',
      applicant_dob: '1990-01-01',
      applicant_gender: 'OTHER',
      residence_address: {
        house_no_or_name: '1',
        locality: 'Lab',
        district: 'Lab',
        state_code: 'OD',
        pincode: '751001',
      },
      residence_duration_months: 18,
      purpose_of_certificate: 'SAMPLE_LAB',
      evidence_type: 'ELECTRICITY_BILL',
    };
    const mine = createApplication({ ...base, citizen_id: 'citizen-a' });
    createApplication({ ...base, citizen_id: 'citizen-b' });
    createApplication(base);
    expect(listApplicationsForCitizen('citizen-a').map((a) => a.id)).toEqual([mine.id]);
    expect(listApplicationsForCitizen('citizen-c')).toEqual([]);
  });
});
