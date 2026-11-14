import { AppShell, Card } from '@serviceform/ui-ux4g';
import { PublicationDesk } from '../../components/PublicationDesk';
import { StudioNav } from '../../components/StudioNav';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PublicationPage({ searchParams }: Props) {
  const requested = (await searchParams)['request'];
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Publication</h1>
        <p className="ux4g-body-m-default">
          Maker-checker publication desk (INT-002). Review a submitted binding change, decide with a
          reason and publish the approved version.
        </p>
      </section>
      <Card title="Maker-checker">
        <PublicationDesk initialRequestId={typeof requested === 'string' ? requested : ''} />
      </Card>
    </AppShell>
  );
}
