import {
  LAB_SEED_ACCOUNT,
  LAB_SIMULATED_OTP_CODE,
  PUBLIC_SAMPLE_LAB_POLICY,
} from '@serviceform/m10-sample-lab';
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
  };
}

export const SAMPLE_CITIZEN_HINT = {
  mobile: `${LAB_SEED_ACCOUNT.mobile.slice(0, 5)} ${LAB_SEED_ACCOUNT.mobile.slice(5)}`,
  otp: LAB_SIMULATED_OTP_CODE,
};

export type AuthSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readAuthParams(searchParams: AuthSearchParams) {
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return { nextParam: first('next'), initialMobile: first('mobile') ?? '' };
}
