import { AppShell } from '@serviceform/ui-ux4g';
import { OfficerNav } from '../../components/OfficerNav';
import { SearchDesk } from '../../components/SearchDesk';

export default function SearchPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Case search"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Case search</h1>
        <p className="ux4g-body-m-default">
          Find sample lab case projections by catalogue, state, or opaque application ref.
        </p>
      </section>
      <SearchDesk />
    </AppShell>
  );
}
