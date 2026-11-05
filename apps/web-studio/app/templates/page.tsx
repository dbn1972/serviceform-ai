import { AppShell } from '@serviceform/ui-ux4g';
import {
  TEMPLATE_CATALOGUE_VERSION,
  TEMPLATE_REGISTRY_SOURCE,
} from '@serviceform/service-templates';
import type { Metadata } from 'next';
import { StudioNav } from '../../components/StudioNav';
import { TemplateCatalogue } from '../../components/TemplateCatalogue';
import { templateSummaries } from '../../lib/templates';

export const metadata: Metadata = {
  title: 'Template catalogue - ServiceForm AI - Service Design Studio',
};

export default function TemplatesPage() {
  const templates = templateSummaries();
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Certificate template catalogue</h1>
        <p className="ux4g-body-m-default">
          Versioned service templates authored as metadata. Each version pins one form package by
          content hash; published versions are immutable. Stubs follow the national registry core
          fields and wait for statutory policy input.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">Catalogue {TEMPLATE_CATALOGUE_VERSION}</span>
          <span className="ux4g-tag-tonal-neutral">
            Registry v{TEMPLATE_REGISTRY_SOURCE.catalogue_version} · docs/catalogue
          </span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB · G6 not issued</span>
        </div>
      </section>
      <TemplateCatalogue templates={templates} />
    </AppShell>
  );
}
