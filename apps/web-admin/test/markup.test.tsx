import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BindingsPage from '../app/bindings/page';
import HomePage from '../app/page';
import UsersPage from '../app/users/page';
import { AdminNav } from '../components/AdminNav';

describe('web-admin markup (UX4G)', () => {
  it('mounts AdminNav in AppShell header with SAMPLE_LAB env tag', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('data-surface="tenant_admin"');
    expect(html).toContain('>Administration</h1>');
    expect(html).toContain('sf-skip-link');
    expect(html).toContain('sf-env-tag');
    expect(html).toContain('SAMPLE_LAB');
    expect(html).toContain('sf-header-nav');
    expect(html).toContain('ux4g-navbar-links');
    expect(html).toContain('Open bindings');
    expect(html).toContain('Sample lab — not production certified');
  });

  it('exposes binding and review destinations in horizontal nav', () => {
    const html = renderToStaticMarkup(<AdminNav />);
    expect(html).toContain('ux4g-navbar-links');
    expect(html).not.toContain('ux4g-text-link-m');
    expect(html).toContain('href="/bindings"');
    expect(html).toContain('href="/reviews"');
    expect(html).toContain('href="/branding"');
    expect(html).toContain('href="/analytics"');
    expect(html).toContain('href="/discovery"');
    expect(html).toContain('href="/users"');
  });

  it('users page is UX4G tenant workforce desk', () => {
    const html = renderToStaticMarkup(<UsersPage />);
    expect(html).toContain('>Tenant users</h1>');
    expect(html).toContain('Workforce directory (Keycloak Admin REST or SIMULATED)');
    expect(html).toContain('data-surface="tenant_admin"');
    expect(html).toContain('sf-header-nav');
    expect(html).toContain('SAMPLE_LAB');
  });

  it('bindings page includes reusable jurisdiction scope desk for any offering', () => {
    const html = renderToStaticMarkup(<BindingsPage />);
    expect(html).toContain('Jurisdiction scope (states / districts / municipalities)');
    expect(html).toContain('Allowed states (LGD codes, one per line)');
    expect(html).toContain('Allowed districts (LGD codes, one per line)');
    expect(html).toContain('Allowed municipalities / ULBs (LGD local-body codes, one per line)');
    expect(html).toContain('Catalogue id (e.g. IND-CIV-001, IND-ULB-007)');
  });

  it('bindings page exposes SAMPLE_LAB eng seal prove control (SF-60)', () => {
    const html = renderToStaticMarkup(<BindingsPage />);
    expect(html).toContain('Prove lab eng seal');
  });

  it('bindings page states maker-checker and TSB pin immutability (WS6 ops depth)', () => {
    const html = renderToStaticMarkup(<BindingsPage />);
    expect(html).toContain('Maker-checker required');
    expect(html).toContain('CMP-051');
    expect(html).toContain('Publish (requires checker approval)');
    expect(html).toContain('silent repoint is forbidden');
  });

  it('bindings page states lab eng seal ≠ G6 seal (P8-5)', () => {
    const html = renderToStaticMarkup(<BindingsPage />);
    expect(html).toContain('tsb_immutability_sealed');
    expect(html).toContain('SF-60');
  });
});

describe('web-admin reviews markup (P8-5 maker≠checker)', () => {
  it('checker reviews page stresses maker ≠ checker without CERTIFIED chrome dump', async () => {
    const { default: ReviewsPage } = await import('../app/reviews/page');
    const html = renderToStaticMarkup(<ReviewsPage />);
    expect(html).toContain('Maker ≠ checker');
    expect(html).toContain('CMP-051');
    expect(html).toContain('Constitution #9');
    expect(html).toContain('sf-header-nav');
    expect(html).toContain('SAMPLE_LAB');
    expect(html).not.toContain('CERTIFIED=false');
  });
});

describe('web-admin discovery / analytics UX4G controls', () => {
  it('discovery desk uses TextInput, Select, and Button composites', async () => {
    const { DiscoveryDesk } = await import('../components/DiscoveryDesk');
    const html = renderToStaticMarkup(<DiscoveryDesk />);
    expect(html).toContain('ux4g-input-container');
    expect(html).toContain('discovery-keywords');
    expect(html).toContain('discovery-jurisdiction');
    expect(html).toContain('ux4g-btn-primary');
    expect(html).toContain('Run a search');
    expect(html).not.toContain('CERTIFIED=false');
    expect(html).not.toContain('CMP-006');
  });

  it('analytics desk uses Button and empty-state pattern', async () => {
    const { AnalyticsDesk } = await import('../components/AnalyticsDesk');
    const html = renderToStaticMarkup(<AnalyticsDesk />);
    expect(html).toContain('ux4g-btn-outline-primary');
    expect(html).toContain('Refresh definitions');
    expect(html).not.toContain('CERTIFIED=false');
    expect(html).not.toContain('CMP-045');
  });
});
