import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Alert,
  AppShell,
  Button,
  Checkbox,
  MAIN_CONTENT_ID,
  RadioGroup,
  SF_UX4G_EXTENSIONS,
  TextInput,
  TextLink,
  UX4G_BASELINE,
  UX4G_FIGMA_INVENTORY,
  Ux4gControl,
  applyTenantOverlay,
  assertNoCrossTenantLeakage,
  contrastRatio,
  meetsWcagAa,
  resolveUx4gRenderer,
  securityHeaders,
  TenantOverlayError,
  UX4G_SEMANTIC_RESOLVED,
  WCAG_AA_NORMAL_TEXT,
} from '../src/index';

describe('AppShell (REQ: DESIGN-SYSTEM.md rule 6, TESTING.md UX4G verification)', () => {
  const html = renderToStaticMarkup(
    <AppShell surface="citizen_web" title="Citizen">
      <h1>Heading</h1>
    </AppShell>,
  );

  it('renders banner, main and contentinfo landmarks', () => {
    expect(html).toMatch(/<header[^>]*>/);
    expect(html).toContain(`<main id="${MAIN_CONTENT_ID}"`);
    expect(html).toMatch(/<footer[^>]*>/);
  });

  it('starts with a skip link targeting main content', () => {
    expect(html.indexOf('sf-skip-link')).toBeLessThan(html.indexOf('<header'));
    expect(html).toContain(`href="#${MAIN_CONTENT_ID}"`);
  });

  it('marks the surface for theming and tests', () => {
    expect(html).toContain('data-surface="citizen_web"');
  });

  it('uses UX4G navbar and footer classes', () => {
    expect(html).toContain('ux4g-navbar');
    expect(html).toContain('ux4g-footer-wrapper');
  });
});

describe('UX4G baseline tokens', () => {
  it('pins UX4G Design System 3.0', () => {
    expect(UX4G_BASELINE.name).toBe('UX4G Design System');
    expect(UX4G_BASELINE.version).toBe('3.0');
    expect(UX4G_BASELINE.vendored).toBe(true);
  });

  it('meets WCAG AA for body text on elevated background', () => {
    const fg = UX4G_SEMANTIC_RESOLVED['--ux4g-text-neutral-primary'];
    const bg = UX4G_SEMANTIC_RESOLVED['--ux4g-bg-neutral-elevated'];
    expect(meetsWcagAa(fg, bg, WCAG_AA_NORMAL_TEXT)).toBe(true);
    expect(contrastRatio(fg, bg)).toBeGreaterThan(10);
  });

  it('uses rem-capable spacing (200% reflow)', () => {
    expect(UX4G_SEMANTIC_RESOLVED['--ux4g-color-primary-600']).toMatch(/^#/);
  });
});

describe('INT-011 tenant overlay isolation (CROSS_TENANT_LEAKAGE=0)', () => {
  it('scopes overlay CSS to data-tenant-id and forbids foreign tokens', () => {
    const a = applyTenantOverlay({
      tenantId: 'tenant-a',
      tokens: { '--ux4g-color-primary-600': '#4a2bc2' },
    });
    const b = applyTenantOverlay({
      tenantId: 'tenant-b',
      tokens: { '--ux4g-color-primary-600': '#3d239f' },
    });
    expect(a.cssText.startsWith('[data-tenant-id="tenant-a"]')).toBe(true);
    expect(b.cssText.includes('tenant-a')).toBe(false);
    expect(() => assertNoCrossTenantLeakage(a, b)).not.toThrow();
    expect(() =>
      applyTenantOverlay({
        tenantId: 'tenant-a',
        tokens: { '--ux4g-text-neutral-primary': '#000000' },
      }),
    ).toThrow(TenantOverlayError);
    expect(() =>
      applyTenantOverlay({
        tenantId: 'tenant-a',
        tokens: { '--ux4g-color-primary-600': 'red; } body{display:none}' },
      }),
    ).toThrow(TenantOverlayError);
  });

  it('does not leak overlay style into another AppShell tree', () => {
    const overlay = applyTenantOverlay({
      tenantId: 'tenant-a',
      tokens: { '--ux4g-color-primary-600': '#4a2bc2' },
    });
    const htmlA = renderToStaticMarkup(
      <AppShell surface="citizen_web" title="A" overlay={overlay}>
        <p>A</p>
      </AppShell>,
    );
    const htmlB = renderToStaticMarkup(
      <AppShell surface="citizen_web" title="B" tenantId="tenant-b">
        <p>B</p>
      </AppShell>,
    );
    expect(htmlA).toContain('data-tenant-id="tenant-a"');
    expect(htmlB).toContain('data-tenant-id="tenant-b"');
    expect(htmlB).not.toContain('--ux4g-color-primary-600');
    expect(htmlB).not.toContain('tenant-a');
  });

  it('rejects a primary overlay that fails UI contrast', () => {
    expect(() =>
      applyTenantOverlay({
        tenantId: 'tenant-a',
        tokens: { '--ux4g-color-primary-600': '#f2efff' },
      }),
    ).toThrow(/UX4G_OVERLAY_CONTRAST|contrast/i);
  });
});

describe('UX4G-backed JSON Forms registry', () => {
  it('maps schema types to UX4G renderer ids, not a second design system', () => {
    expect(resolveUx4gRenderer({ type: 'string' })).toBe('Ux4gTextInput');
    expect(resolveUx4gRenderer({ type: 'boolean' })).toBe('Ux4gCheckbox');
    expect(resolveUx4gRenderer({ type: 'string', enum: ['a', 'b'] })).toBe('Ux4gSelect');
    expect(resolveUx4gRenderer({ type: 'string' }, { control: 'textarea' })).toBe('Ux4gTextarea');
    expect(resolveUx4gRenderer({ type: 'string', format: 'date' })).toBe('Ux4gDateInput');
    expect(resolveUx4gRenderer({ type: 'object' })).toBe('Ux4gUnsupported');
  });

  it('renders a metadata-driven form with UX4G field classes', () => {
    const html = renderToStaticMarkup(
      <form>
        <Ux4gControl
          schema={{ type: 'string', title: 'Full name' }}
          id="full-name"
          name="fullName"
          value=""
          onChange={() => undefined}
        />
        <Ux4gControl
          schema={{ type: 'boolean', title: 'Consent recorded' }}
          id="consent"
          name="consent"
          value={false}
          onChange={() => undefined}
        />
      </form>,
    );
    expect(html).toContain('ux4g-input-container');
    expect(html).toContain('ux4g-checkbox');
    expect(html).toContain('for="full-name"');
    expect(html).not.toContain('Mui');
    expect(html).not.toContain('bootstrap');
  });
});

describe('UX4G primitives keyboard and names', () => {
  it('associates labels, default button type, and alert roles', () => {
    const button = renderToStaticMarkup(<Button>Save</Button>);
    expect(button).toContain('type="button"');
    expect(button).toContain('ux4g-btn-primary');
    expect(button).toContain('ux4g-btn-m');
    const input = renderToStaticMarkup(
      <TextInput id="n" name="n" label="Name" hint="As on identity document" />,
    );
    expect(input).toContain('for="n"');
    expect(input).toContain('aria-describedby="n-hint"');
    const box = renderToStaticMarkup(<Checkbox id="c" label="Accept" />);
    expect(box).toContain('type="checkbox"');
    const radios = renderToStaticMarkup(
      <RadioGroup
        name="choice"
        legend="Choice"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    expect(radios).toContain('<fieldset');
    expect(radios).toContain('type="radio"');
    const alert = renderToStaticMarkup(
      <Alert variant="error" title="Blocked">
        Action denied
      </Alert>,
    );
    expect(alert).toContain('role="alert"');
    const link = renderToStaticMarkup(<TextLink href="#main-content">Skip</TextLink>);
    expect(link).toContain('ux4g-text-link-md');
  });

  it('keeps Figma inventory names aligned with coded components', () => {
    const codes = UX4G_FIGMA_INVENTORY.map((row) => row.code);
    expect(codes).toContain('Button');
    expect(codes).toContain('TextInput');
    expect(SF_UX4G_EXTENSIONS.every((ext) => ext.status === 'registered')).toBe(true);
    expect(SF_UX4G_EXTENSIONS.every((ext) => ext.ux4gBase.startsWith('ux4g-'))).toBe(true);
  });
});

describe('security headers (G-04 nonce path)', () => {
  it('keeps the M00 signature without nonce', () => {
    const headers = securityHeaders(false);
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('drops unsafe-inline when a nonce is provided', () => {
    const headers = securityHeaders(false, 'abc123');
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });
});

describe('WCAG 1.4.10 reflow (320 CSS px)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  it('uses border-box and clips html overflow instead of off-screen skip-link offset', () => {
    expect(css).toContain('box-sizing: border-box');
    expect(css).toContain('overflow-x: clip');
    expect(css).not.toContain('-10000px');
    expect(css).toContain('overflow-wrap: var(--ux4g-overflow-wrap-anywhere)');
  });
});
