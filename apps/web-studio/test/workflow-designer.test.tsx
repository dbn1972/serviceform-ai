import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WorkflowsPage from '../app/workflows/page';
import { StudioNav } from '../components/StudioNav';
import { WorkflowDesigner } from '../components/workflows/WorkflowDesigner';
import { WorkflowOutline } from '../components/workflows/WorkflowViews';
import { assertPlatformPath } from '../lib/bff';
import { workflowSource } from '../lib/designer-source';
import { caseSequencingGraph, importWorkflow } from '@serviceform/studio-designers/workflow';

const DOC = '0d15ba00-00c1-4000-8000-0d15ba0000c1';

// REQ: Phase C-2 Studio workflow designer (UX4G, canonical CMP-016 model, BPMN through CMP-016).
describe('Studio workflow designer', () => {
  it('offers blank, saved-draft and template starting points', () => {
    const html = renderToStaticMarkup(<WorkflowsPage />);
    expect(html).toContain('>Workflow designer</h1>');
    expect(html).toContain('href="/workflows/designer"');
    expect(html).toContain('href="/workflows/designer?template=case-sequencing"');
    expect(html).toContain('action="/workflows/designer"');
    expect(html).toContain('Temporal runtime · BPMN interop only');
    expect(renderToStaticMarkup(<StudioNav />)).toContain('href="/workflows"');
  });

  it('renders the template on an accessible SVG canvas with palette and inspector', () => {
    const html = renderToStaticMarkup(
      <WorkflowDesigner source={{ kind: 'template', id: 'case-sequencing' }} />,
    );
    expect(html).toContain('>Application case sequencing (commit-wait)</h1>');
    expect(html).toContain('aria-label="Workflow canvas"');
    expect(html).toContain('aria-label="Start: Start (START)"');
    expect(html).toContain('aria-label="Wait for case step: Wait draft (WAIT_DRAFT)"');
    expect(html).toContain('16 steps · 22 paths');
    expect(html).toContain('aria-label="Add Officer task"');
    expect(html).toContain('NOT SAVED');
    expect(html).toContain('>MARK_READY_TO_SUBMIT</text>');
  });

  it('lists every step and path in the outline (screen-reader alternative)', () => {
    const design = importWorkflow(caseSequencingGraph(), {
      key: 'lab.case-flow',
      title: 'Case',
      version: '1.0.0',
    });
    const html = renderToStaticMarkup(<WorkflowOutline design={design} select={() => undefined} />);
    expect(html).toContain('16 steps and 22 paths, in published order');
    expect(html.match(/<tr>/g)).toHaveLength(17);
    expect(html).toContain('RECORD_APPROVED');
  });

  it('resolves workflow sources and allowlists only the CMP-016 Studio routes', () => {
    expect(workflowSource({ document: DOC })).toEqual({ kind: 'document', id: DOC });
    expect(workflowSource({ template: 'case-sequencing' })).toEqual({
      kind: 'template',
      id: 'case-sequencing',
    });
    expect(workflowSource({ template: '../x' })).toEqual({ kind: 'blank' });
    expect(assertPlatformPath('workflow-graphs/check')).toBe('/v1/workflow-graphs/check');
    expect(assertPlatformPath('workflow-drafts')).toBe('/v1/workflow-drafts');
    expect(assertPlatformPath(`workflow-versions/${DOC}/bpmn`)).toBe(
      `/v1/workflow-versions/${DOC}/bpmn`,
    );
    expect(() => assertPlatformPath('workflow-instances')).toThrow('SF-AUTH-002');
  });
});
