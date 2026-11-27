import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import InteropPage from '../app/interop/page';
import { InteropHygieneDesk } from '../components/InteropHygieneDesk';
import { StudioNav } from '../components/StudioNav';

describe('Studio interop hygiene desk', () => {
  it('surfaces BPMN / .sfpackage lab demo with Temporal-only stamp', () => {
    const html = renderToStaticMarkup(<InteropPage />);
    expect(html).toContain('>BPMN / .sfpackage lab demo</h1>');
    expect(html).toContain('Temporal runtime · BPMN interop only');
    expect(html).toContain('No Camunda second runtime');
    expect(renderToStaticMarkup(<StudioNav />)).toContain('href="/interop"');
  });

  it('offers prove action without importing m10 into the client bundle', () => {
    const html = renderToStaticMarkup(<InteropHygieneDesk />);
    expect(html).toContain('Prove interop hygiene');
    expect(html).toContain('Lab interop hygiene only');
    expect(html).toContain('Sample lab — not production');
    expect(html).toContain('certified');
    expect(html).toContain('.sfpackage');
    expect(html).toContain('Loading SAMPLE_LAB catalogue');
  });
});
