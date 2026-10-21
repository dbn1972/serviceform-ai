import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { AuthContextPanel } from '../../components/auth/AuthContextPanel';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { SignInFlow } from '../../components/auth/SignInFlow';
import { CitizenNav } from '../../components/CitizenNav';
import {
  SAMPLE_CITIZEN_HINT,
  readAuthParams,
  residenceServiceFacts,
  type AuthSearchParams,
} from '../../lib/service-facts';

export const metadata: Metadata = { title: 'Sign in - ServiceForm AI - Citizen Portal' };

export default async function LoginPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const { nextParam, initialMobile } = await readAuthParams(searchParams);
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <AuthLayout
        context={<AuthContextPanel variant="sign-in" service={residenceServiceFacts()} />}
        sampleHint={
          <>
            Sample citizen <strong>{SAMPLE_CITIZEN_HINT.mobile}</strong> · OTP{' '}
            <strong>{SAMPLE_CITIZEN_HINT.otp}</strong>
          </>
        }
      >
        <SignInFlow nextParam={nextParam} initialMobile={initialMobile} />
      </AuthLayout>
    </AppShell>
  );
}
