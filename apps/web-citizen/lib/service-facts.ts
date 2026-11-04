import { PUBLIC_SAMPLE_LAB_POLICY } from '@serviceform/m10-sample-lab';
import type { ServiceFacts } from '../components/auth/AuthContextPanel';

/** IND-SOC-002 facts for the auth context pane, read from the SAMPLE_LAB policy (server only). */
export function residenceServiceFacts(): ServiceFacts {
  const policy = PUBLIC_SAMPLE_LAB_POLICY;
  return {
    catalogueId: policy.catalogue_id,
    serviceName: 'Residence Certificate',
    fee: `₹${(policy.fee_amount_paisa / 100).toLocaleString('en-IN')}`,
    serviceTime: `${policy.sla_working_days} working days`,
    delivery: `DigiLocker (${policy.digilocker_mode})`,
    eligibility: `${policy.min_residence_months}+ months at your address`,
  };
}

/** Any synthetic mobile starting with 9 works; CMP-004 creates the citizen on first verify. */
export const SAMPLE_CITIZEN_HINT = {
  mobile: '98765 43210',
  otp: 'shown in the Simulated SMS',
};

export type AuthSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readAuthParams(searchParams: AuthSearchParams) {
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    nextParam: first('next'),
    initialMobile: first('mobile') ?? '',
    signedOut: first('signed_out') === '1',
  };
}
