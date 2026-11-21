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
          M08 CMP-035 thin desk — find SAMPLE_LAB case projections by catalogue, state, or opaque
          application ref.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">CMP-035</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
          <span className="ux4g-tag-outline-neutral">CERTIFIED=false</span>
        </div>
      </section>
      <SearchDesk />
    </AppShell>
  );
}
