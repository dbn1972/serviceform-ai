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

export const metadata: Metadata = { title: 'Create account - ServiceForm AI - Citizen Portal' };

export default async function RegisterPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const { nextParam, initialMobile } = await readAuthParams(searchParams);
  const service = residenceServiceFacts();
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <AuthLayout
        context={<AuthContextPanel variant="register" service={service} />}
        sampleHint={
          <>
            OTP <strong>{SAMPLE_CITIZEN_HINT.otp}</strong>
          </>
        }
      >
        <SignInFlow mode="register" nextParam={nextParam} initialMobile={initialMobile} />
      </AuthLayout>
    </AppShell>
  );
}
