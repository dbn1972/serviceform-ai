'use client';

import { Icon, TextInput } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MATURITY_LABEL, STATUS_TAG, type TemplateSummary } from '../lib/templates';

const ALL = 'ALL';

function Select({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="ux4g-input-container ux4g-input-m ux4g-input-default">
      <label className="ux4g-label-m-default" htmlFor={id}>
        {label}
      </label>
      <div className="ux4g-input">
        <select
          id={id}
          className="ux4g-input-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Browse and filter the certificate template catalogue (Studio). */
export function TemplateCatalogue({ templates }: { templates: readonly TemplateSummary[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [maturity, setMaturity] = useState(ALL);
  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.category))].sort(),
    [templates],
  );
  const shown = templates.filter((t) => {
    const q = query.trim().toLowerCase();
    const text = `${t.name} ${t.catalogue_id} ${t.summary}`.toLowerCase();
    return (
      (!q || text.includes(q)) &&
      (category === ALL || t.category === category) &&
      (maturity === ALL || t.maturity === maturity)
    );
  });

  return (
    <div className="sf-section">
      <div role="search" className="sf-catalogue-toolbar" aria-label="Filter templates">
        <TextInput
          id="template-search"
          label="Search templates"
          type="search"
          value={query}
          hint="Name, catalogue id or summary"
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          id="template-category"
          label="Category"
          value={category}
          options={[
            { value: ALL, label: 'All categories' },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
          onChange={setCategory}
        />
        <Select
          id="template-maturity"
          label="Maturity"
          value={maturity}
          options={[
            { value: ALL, label: 'All' },
            { value: 'SAMPLE_LAB_PUBLISHED', label: 'Published (SAMPLE_LAB)' },
            { value: 'SAMPLE_LAB_STUB', label: 'Stubs' },
          ]}
          onChange={setMaturity}
        />
      </div>

      <p className="sf-result-count" role="status" aria-live="polite">
        {shown.length} of {templates.length} templates
      </p>

      {shown.length === 0 ? (
        <p className="ux4g-body-m-default">No template matches these filters.</p>
      ) : (
        <ul className="sf-catalogue-grid" aria-label="Certificate templates">
          {shown.map((t) => (
            <li key={t.template_id}>
              <article className="sf-template-card" aria-labelledby={`tpl-${t.template_id}`}>
                <div className="sf-template-card-head">
                  <span className="sf-service-mark">
                    <Icon name={t.maturity === 'SAMPLE_LAB_PUBLISHED' ? 'document' : 'layers'} />
                  </span>
                  <div>
                    <p className="sf-service-code">{t.catalogue_id}</p>
                    <h2 id={`tpl-${t.template_id}`} className="ux4g-heading-s-strong">
                      {t.name}
                    </h2>
                  </div>
                </div>
                <p className="ux4g-body-s-default">{t.summary}</p>
                <div className="sf-tag-row">
                  <span
                    className={
                      t.maturity === 'SAMPLE_LAB_PUBLISHED'
                        ? 'ux4g-tag-tonal-success'
                        : 'ux4g-tag-outline-warning'
                    }
                  >
                    {MATURITY_LABEL[t.maturity]}
                  </span>
                  <span className="ux4g-tag-tonal-neutral">{t.output_type}</span>
                  <span className={STATUS_TAG[t.latest.status]}>
                    Latest v{t.latest.version} · {t.latest.status}
                  </span>
                </div>
                <dl className="sf-mini-stats">
                  <div>
                    <dt>Versions</dt>
                    <dd>{t.versions}</dd>
                  </div>
                  <div>
                    <dt>Steps</dt>
                    <dd>{t.steps}</dd>
                  </div>
                  <div>
                    <dt>Fields</dt>
                    <dd>{t.fields}</dd>
                  </div>
                  <div>
                    <dt>DigiLocker fit</dt>
                    <dd>{t.digilocker_suitability}</dd>
                  </div>
                </dl>
                <div className="sf-template-card-foot">
                  <span className="ux4g-body-s-default">{t.category}</span>
                  <Link
                    className="ux4g-btn-outline-primary ux4g-btn-s"
                    href={`/templates/${t.template_id}`}
                    aria-label={`Open ${t.name} template`}
                  >
                    Open template
                    <Icon name="arrow-right" size={16} />
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
