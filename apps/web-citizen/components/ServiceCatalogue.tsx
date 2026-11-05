'use client';

import { Icon, TextInput } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { CatalogueEntry } from '../lib/catalogue';

const ALL = 'ALL';

/** Citizen service catalogue: offered services first, then services not yet offered here. */
export function ServiceCatalogue({ entries }: { entries: readonly CatalogueEntry[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const categories = useMemo(() => [...new Set(entries.map((e) => e.category))].sort(), [entries]);
  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      (!q || `${e.name} ${e.summary} ${e.catalogue_id}`.toLowerCase().includes(q)) &&
      (category === ALL || e.category === category),
  );
  const offered = shown.filter((e) => e.offered);
  const upcoming = shown.filter((e) => !e.offered);

  return (
    <div className="sf-section">
      <div role="search" className="sf-catalogue-toolbar" aria-label="Find a service">
        <TextInput
          id="service-search"
          label="Search services"
          type="search"
          value={query}
          hint="For example: income, birth, residence"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ux4g-input-container ux4g-input-m ux4g-input-default">
          <label className="ux4g-label-m-default" htmlFor="service-category">
            Category
          </label>
          <div className="ux4g-input">
            <select
              id="service-category"
              className="ux4g-input-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value={ALL}>All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="sf-result-count" role="status" aria-live="polite">
          {shown.length} of {entries.length} services
        </p>
      </div>

      <section className="sf-section" aria-labelledby="services-online">
        <h2 id="services-online" className="ux4g-heading-m-strong">
          Apply online
        </h2>
        {offered.length === 0 ? (
          <p className="ux4g-body-m-default">No online service matches your search.</p>
        ) : (
          <ul className="sf-catalogue-grid" aria-label="Services you can apply for">
            {offered.map((e) => (
              <li key={e.catalogue_id}>
                <article className="sf-template-card" aria-labelledby={`svc-${e.catalogue_id}`}>
                  <div className="sf-template-card-head">
                    <span className="sf-service-mark">
                      <Icon name="document" />
                    </span>
                    <div>
                      <p className="sf-service-code">{e.catalogue_id}</p>
                      <h3 id={`svc-${e.catalogue_id}`} className="ux4g-heading-s-strong">
                        {e.name}
                      </h3>
                    </div>
                  </div>
                  <p className="ux4g-body-s-default">{e.summary}</p>
                  <dl className="sf-mini-stats">
                    <div>
                      <dt>Fee</dt>
                      <dd>{e.fee}</dd>
                    </div>
                    <div>
                      <dt>Service time</dt>
                      <dd>{e.service_time}</dd>
                    </div>
                    <div>
                      <dt>Steps</dt>
                      <dd>{e.steps}</dd>
                    </div>
                  </dl>
                  <div className="sf-template-card-foot">
                    <Link
                      className="ux4g-btn-outline-neutral ux4g-btn-s"
                      href={`/services/${e.catalogue_id}`}
                      aria-label={`View details of ${e.name}`}
                    >
                      View details
                    </Link>
                    <Link
                      className="ux4g-btn-primary ux4g-btn-s"
                      href={`/services/${e.catalogue_id}/apply`}
                      aria-label={`Apply now for ${e.name}`}
                    >
                      Apply now
                      <Icon name="arrow-right" size={16} />
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sf-section" aria-labelledby="services-upcoming">
        <h2 id="services-upcoming" className="ux4g-heading-m-strong">
          Not yet available in this portal
        </h2>
        <p className="ux4g-body-m-default">
          These certificates are in the national catalogue. The department has not published them
          here yet, so you cannot apply online for them in this portal.
        </p>
        {upcoming.length === 0 ? (
          <p className="ux4g-body-m-default">No upcoming service matches your search.</p>
        ) : (
          <ul className="sf-catalogue-grid" aria-label="Services not yet available">
            {upcoming.map((e) => (
              <li key={e.catalogue_id}>
                <article className="sf-template-card" aria-labelledby={`svc-${e.catalogue_id}`}>
                  <div className="sf-template-card-head">
                    <span className="sf-service-mark">
                      <Icon name="clock" />
                    </span>
                    <div>
                      <p className="sf-service-code">{e.catalogue_id}</p>
                      <h3 id={`svc-${e.catalogue_id}`} className="ux4g-heading-s-strong">
                        {e.name}
                      </h3>
                    </div>
                  </div>
                  <p className="ux4g-body-s-default">{e.summary}</p>
                  <div className="sf-tag-row">
                    <span className="ux4g-tag-outline-warning">Not yet offered here</span>
                    <span className="ux4g-tag-tonal-neutral">{e.output_type}</span>
                  </div>
                  <div className="sf-template-card-foot">
                    <span className="ux4g-body-s-default">{e.category}</span>
                    <Link
                      className="ux4g-btn-outline-neutral ux4g-btn-s"
                      href={`/services/${e.catalogue_id}`}
                      aria-label={`View details of ${e.name}`}
                    >
                      View details
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
