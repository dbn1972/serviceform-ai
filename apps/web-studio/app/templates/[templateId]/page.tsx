import { Alert, AppShell, Card } from '@serviceform/ui-ux4g';
import {
  diffVersions,
  formFields,
  listTemplates,
  stepLabels,
  templateById,
  type TemplateVersion,
} from '@serviceform/service-templates';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StudioNav } from '../../../components/StudioNav';
import { TemplateFormPreview } from '../../../components/TemplateFormPreview';
import { MATURITY_LABEL, shortHash, STATUS_TAG } from '../../../lib/templates';

type Props = {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return listTemplates().map((t) => ({ templateId: t.template_id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = templateById((await params).templateId);
  return { title: `${t?.name ?? 'Template'} - Template catalogue - Service Design Studio` };
}

const POLICY_PENDING = 'POLICY_INPUT_REQUIRED';

function PolicyValue({ value }: { value: string }) {
  return value === POLICY_PENDING ? (
    <span className="ux4g-tag-outline-warning">Policy input required</span>
  ) : (
    <>{value}</>
  );
}

function stepOf(version: TemplateVersion, pointer: string): string {
  const scope = `#/properties/${pointer.slice(1).split('/').join('/properties/')}`;
  const steps = version.form.ui_schema.elements;
  const labels = stepLabels(version);
  const has = (node: (typeof steps)[number]): boolean =>
    node.type === 'Control' ? node.scope === scope : node.elements.some(has);
  const i = steps.findIndex(has);
  return labels[i] ?? '—';
}

export default async function TemplateDetailPage({ params, searchParams }: Props) {
  const template = templateById((await params).templateId);
  if (!template) notFound();
  const requested = (await searchParams)['v'];
  const versions = template.versions;
  const selected =
    versions.find((v) => v.version === requested) ?? versions[versions.length - 1] ?? null;
  if (!selected) notFound();
  const index = versions.indexOf(selected);
  const previous = index > 0 ? versions[index - 1] : undefined;
  const diff = previous ? diffVersions(previous, selected) : null;
  const fields = formFields(selected.form.json_schema);
  const base = `/templates/${template.template_id}`;

  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <nav aria-label="Breadcrumb">
          <ol className="sf-breadcrumb sf-breadcrumb-light">
            <li>
              <Link href="/templates">Template catalogue</Link>
            </li>
            <li>
              <span aria-current="page">{template.name}</span>
            </li>
          </ol>
        </nav>
        <h1 className="ux4g-heading-2xl-strong">{template.name}</h1>
        <p className="ux4g-body-m-default">{template.summary}</p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-neutral">{template.catalogue_id}</span>
          <span
            className={
              template.maturity === 'SAMPLE_LAB_PUBLISHED'
                ? 'ux4g-tag-tonal-success'
                : 'ux4g-tag-outline-warning'
            }
          >
            {MATURITY_LABEL[template.maturity]}
          </span>
          <span className="ux4g-tag-tonal-info">{template.category}</span>
        </div>
      </section>

      {template.maturity === 'SAMPLE_LAB_STUB' ? (
        <Alert variant="warning" title="SAMPLE_LAB stub — not offered to citizens">
          Form fields follow the registry core fields. Fee, service time, eligibility and evidence
          are POLICY_INPUT_REQUIRED from the statutory owner; nothing here is invented policy.
        </Alert>
      ) : (
        <Alert variant="info" title="Published to the SAMPLE_LAB citizen portal">
          Version {versions.find((v) => v.status === 'PUBLISHED')?.version} is pinned by the lab
          tenant service binding. The citizen apply page renders it and CMP-009 validates every
          submission against this exact content hash.
        </Alert>
      )}

      <Card title="Version history" subtitle="Published versions are immutable">
        <div className="sf-table-wrap">
          <table className="sf-table">
            <caption>Select a version to inspect its form</caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col">Published</th>
                <th scope="col">Content hash</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version_id} aria-current={v === selected ? 'true' : undefined}>
                  <th scope="row">
                    <Link
                      href={`${base}?v=${v.version}`}
                      aria-label={`Inspect version ${v.version}`}
                    >
                      v{v.version}
                    </Link>
                  </th>
                  <td>
                    <span className={STATUS_TAG[v.status]}>{v.status}</span>
                  </td>
                  <td className="sf-nowrap">{v.published_at ? v.published_at.slice(0, 10) : '—'}</td>
                  <td>
                    <code className="sf-hash">{shortHash(v.content_hash)}</code>
                  </td>
                  <td>{v.change_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="sf-split">
        <div className="sf-section">
          <Card
            title={`Version ${selected.version}`}
            subtitle={`${selected.form.form_id} · ${selected.status}`}
          >
            <dl className="sf-dl">
              <dt>Version id</dt>
              <dd>
                <code className="sf-hash">{selected.version_id}</code>
              </dd>
              <dt>Content hash</dt>
              <dd>
                <code className="sf-hash">{selected.content_hash}</code>
              </dd>
              <dt>Steps</dt>
              <dd>{stepLabels(selected).join(' → ')}</dd>
            </dl>
            <h3 className="ux4g-heading-s-strong">
              {previous ? `Changes from v${previous.version}` : 'First version'}
            </h3>
            {diff ? (
              diff.added.length + diff.removed.length + diff.changed.length === 0 ? (
                <p className="ux4g-body-m-default">No field-level changes.</p>
              ) : (
                <ul className="sf-diff-list">
                  {diff.added.map((f) => (
                    <li key={`a${f.pointer}`}>
                      <span className="ux4g-tag-tonal-success">Added</span>
                      {f.title} <code className="sf-hash">{f.pointer}</code>
                      {f.required ? null : <span className="ux4g-body-s-default">(optional)</span>}
                    </li>
                  ))}
                  {diff.removed.map((f) => (
                    <li key={`r${f.pointer}`}>
                      <span className="ux4g-tag-tonal-error">Removed</span>
                      {f.title} <code className="sf-hash">{f.pointer}</code>
                    </li>
                  ))}
                  {diff.changed.map((f) => (
                    <li key={`c${f.pointer}`}>
                      <span className="ux4g-tag-tonal-info">Changed</span>
                      {f.title} <code className="sf-hash">{f.pointer}</code>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="ux4g-body-m-default">{selected.change_summary}</p>
            )}
          </Card>

          <Card title="Form preview" subtitle="Same UX4G renderer as the citizen portal">
            <TemplateFormPreview
              key={selected.version_id}
              form={selected.form}
              sample={selected.sample_data}
            />
          </Card>

        </div>

        <aside className="sf-section sf-split-aside" aria-label="Template facts">
          <Card title="Service facts" subtitle="Normalized registry entry">
            <dl className="sf-dl sf-dl-stacked">
              <dt>Definition</dt>
              <dd>{template.definition}</dd>
              <dt>Issuing authority</dt>
              <dd>{template.issuing_authority_class}</dd>
              <dt>Validity class</dt>
              <dd>{template.lifecycle_class}</dd>
              <dt>Credential</dt>
              <dd>{template.credential_form}</dd>
              <dt>DigiLocker fit</dt>
              <dd>{template.digilocker_suitability} (SIMULATED in this lab)</dd>
            </dl>
          </Card>
          <Card title="Policy" subtitle={template.policy.source}>
            <dl className="sf-dl sf-dl-stacked">
              <dt>Fee</dt>
              <dd>
                <PolicyValue value={template.policy.fee} />
              </dd>
              <dt>Service time</dt>
              <dd>
                <PolicyValue value={template.policy.service_time} />
              </dd>
              <dt>Eligibility</dt>
              <dd>
                <PolicyValue value={template.policy.eligibility} />
              </dd>
              <dt>Evidence</dt>
              <dd>
                <PolicyValue value={template.policy.evidence} />
              </dd>
            </dl>
          </Card>
          <Card title="Certificate fields" subtitle="What the issued credential carries">
            <ul className="sf-diff-list">
              {template.credential_fields.map((f) => (
                <li key={f.field_id}>
                  <span className="ux4g-label-m-default">{f.label}</span>
                  <span className="ux4g-body-s-default">
                    {f.source === 'ISSUER' ? 'set at issuance' : `from ${f.source}`}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {template.authoring_path ? (
            <p className="ux4g-body-s-default">
              Authoring source: <code className="sf-hash">{template.authoring_path}</code>
            </p>
          ) : null}
        </aside>
      </div>

      <Card title="Form fields" subtitle={`${fields.length} fields in v${selected.version}`}>
        <div className="sf-table-wrap">
          <table className="sf-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Step</th>
                <th scope="col">Type</th>
                <th scope="col">Required</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.pointer}>
                  <th scope="row">
                    {f.title}
                    <br />
                    <code className="sf-hash">{f.pointer}</code>
                  </th>
                  <td className="sf-nowrap">{stepOf(selected, f.pointer)}</td>
                  <td className="sf-nowrap">{f.type}</td>
                  <td>{f.required ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
