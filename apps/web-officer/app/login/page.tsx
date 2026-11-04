import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { OfficerNav } from '../../components/OfficerNav';
import { OfficerSignIn } from '../../components/OfficerSignIn';

export const metadata: Metadata = { title: 'Sign in - ServiceForm AI - Officer Workbench' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <AppShell
      surface="officer_workbench"
      title="Officer Workbench"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Sign in</h1>
        <p className="ux4g-body-m-default">Sign in to review and decide applications.</p>
      </section>
      <OfficerSignIn nextParam={typeof next === 'string' ? next : undefined} />
    </AppShell>
  );
}
