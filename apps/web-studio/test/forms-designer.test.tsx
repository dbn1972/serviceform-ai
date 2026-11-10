import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FormsPage from '../app/forms/page';
import { DesignerPreview } from '../components/forms/DesignerPreview';
import { FormDesigner } from '../components/forms/FormDesigner';
import { PublicationDesk } from '../components/PublicationDesk';
import { StudioNav } from '../components/StudioNav';
import { assertPlatformPath } from '../lib/bff';
import { historyReducer, type History } from '../lib/designer-history';
import { designerSource, nextMinor } from '../lib/designer-source';
import { handleReadSession, SESSION_COOKIE } from '../lib/handlers';
import { explain } from '../lib/studio-api';
import { templateById } from '@serviceform/service-templates';

const DOC = '0d15ba00-00c1-4000-8000-0d15ba0000c1';

// REQ: Phase C-1 Studio forms designer (UX4G, metadata-driven, CMP-009/033/051/052 path).
describe('Studio forms designer pages', () => {
  it('lists blank, saved-draft and template starting points', () => {
    const html = renderToStaticMarkup(<FormsPage />);
    expect(html).toContain('>Forms designer</h1>');
    expect(html).toContain('href="/forms/designer"');
    expect(html).toContain(
      'href="/forms/designer?template=ind-soc-002.residence-certificate&amp;v=1.1.0"',
    );
    expect(html).toContain('CMP-033 document id');
    expect(renderToStaticMarkup(<StudioNav />)).toContain('href="/forms"');
  });

  it('opens a template as the next version with palette, canvas and inspector', () => {
    const source = designerSource({ template: 'ind-soc-002.residence-certificate', v: '1.0.0' });
    expect(source).toMatchObject({ kind: 'template', version: '1.1.0' });
    const html = renderToStaticMarkup(<FormDesigner source={source} />);
    expect(html).toContain('>Residence Certificate application</h1>');
    expect(html).toContain('From Residence Certificate v1.0.0');
    expect(html).toContain('aria-label="Add to the form"');
    expect(html).toContain('aria-label="Add Full name"');
    expect(html).toContain('role="tablist" aria-label="Steps"');
    expect(html).toContain('aria-label="Form canvas"');
    expect(html).toContain('aria-label="Properties"');
    expect(html).toContain('NOT SAVED');
    expect(html).toContain('SAMPLE_LAB · not CERTIFIED');
    expect(html).toMatch(/Applicant name|Full name \(as per official record\)/);
  });

  it('resolves designer sources safely', () => {
    expect(designerSource({ document: DOC })).toEqual({ kind: 'document', id: DOC });
    expect(designerSource({ document: 'not-a-uuid' })).toEqual({ kind: 'blank' });
    expect(designerSource({ template: 'missing' })).toEqual({ kind: 'blank' });
    expect(designerSource({})).toEqual({ kind: 'blank' });
    expect(nextMinor('1.9.3')).toBe('1.10.0');
    expect(nextMinor('x')).toBe('1.0.0');
  });

  it('previews through the citizen UX4G renderer', () => {
    const form = templateById('ind-soc-002.residence-certificate')?.versions[0]?.form;
    if (!form) throw new Error('missing form');
    const html = renderToStaticMarkup(<DesignerPreview form={form} />);
    expect(html).toContain('for="designer-preview-applicant_name"');
    expect(html).toContain('aria-label="Preview width"');
    expect(html).toContain('Preview only');
  });

  it('renders the checker desk with an id lookup', () => {
    const html = renderToStaticMarkup(<PublicationDesk />);
    expect(html).toContain('Publication request id');
    expect(html).toContain('CMP-051 records maker and checker separately');
  });
});

describe('designer history', () => {
  const start: History<number> = { past: [], present: 0, future: [], lastKey: null };

  it('coalesces typing into one undo step and supports redo', () => {
    let s = historyReducer(start, { type: 'apply', next: 1, coalesce: 'label' });
    s = historyReducer(s, { type: 'apply', next: 2, coalesce: 'label' });
    s = historyReducer(s, { type: 'apply', next: 3 });
    expect(s.past).toEqual([0, 2]);
    s = historyReducer(s, { type: 'undo' });
    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe(0);
    s = historyReducer(s, { type: 'redo' });
    expect(s.present).toBe(2);
    expect(historyReducer(start, { type: 'undo' })).toBe(start);
    expect(historyReducer(s, { type: 'reset', next: 9 })).toEqual({
      past: [],
      present: 9,
      future: [],
      lastKey: null,
    });
  });
});

describe('Studio BFF additions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['SF_API_BASE_URL'];
  });

  it('allows CMP-009 interpretations through the allowlisted proxy', () => {
    expect(assertPlatformPath('interpretations')).toBe('/v1/interpretations');
    expect(() => assertPlatformPath('executions')).toThrow('SF-AUTH-002');
  });

  it('returns the officer actor id (no roles or PII) from the CMP-004 session', async () => {
    process.env['SF_API_BASE_URL'] = 'http://api.local';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ actor_type: 'OFFICER', subject_id: DOC, tenant_id: DOC, methods: ['IDP'] }),
      ),
    );
    const res = await (handleReadSession(
      new Request('http://studio.local/api/session', {
        headers: { cookie: `${SESSION_COOKIE}=${'a'.repeat(40)}` },
      }),
      ['service_studio'],
    ) as unknown as Promise<Response>);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      actor_id: DOC,
      simulation: true,
      g6_issued: false,
    });
  });

  it('explains platform errors in plain language with the stable code', () => {
    expect(
      explain({
        status: 400,
        code: 'SF-SYS-003',
        details: [{ code: 'SCHEMA_INVALID', pointer: '/payload/content_hash' }],
      }),
    ).toBe(
      'The platform refused the content. (SF-SYS-003 · SCHEMA_INVALID at /payload/content_hash)',
    );
    expect(explain({ status: 500, code: 'SF-X', details: [] })).toBe(
      'The platform returned an error. (SF-X)',
    );
  });
});
