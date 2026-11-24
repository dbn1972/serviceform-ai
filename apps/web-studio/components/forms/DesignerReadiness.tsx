'use client';

import type { ReadinessItem } from '../../lib/form-readiness';

const TAG: Record<ReadinessItem['state'], { className: string; text: string }> = {
  ready: { className: 'ux4g-tag-tonal-success', text: 'Ready' },
  advice: { className: 'ux4g-tag-tonal-warning', text: 'Advice' },
  fix: { className: 'ux4g-tag-tonal-error', text: 'Fix' },
};

/** Publish readiness: what to confirm before freezing; only "Fix" items block. */
export function DesignerReadiness({ items }: { items: readonly ReadinessItem[] }) {
  const ready = items.filter((i) => i.state === 'ready').length;
  const blocking = items.some((i) => i.state === 'fix');
  return (
    <section className="sf-designer-checks" aria-labelledby="readiness-title">
      <h3 id="readiness-title" className="ux4g-label-l-strong">
        Ready to publish?{' '}
        <span className={blocking ? 'ux4g-tag-tonal-error' : 'ux4g-tag-tonal-success'}>
          {ready} of {items.length} ready
        </span>
      </h3>
      <ul className="sf-designer-check-list" data-testid="designer-readiness">
        {items.map((item) => (
          <li key={item.id}>
            <span className={TAG[item.state].className}>{TAG[item.state].text}</span>
            <span className="ux4g-body-s-default">
              <span className="ux4g-label-m-strong">{item.title}.</span> {item.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
