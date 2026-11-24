import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { resolveLightToken } from '../src/catalog';
import {
  contrastRatio,
  TextLink,
  UX4G_FIGMA_INVENTORY,
  WCAG_AA_NORMAL_TEXT,
  WCAG_AA_UI,
} from '../src/index';

// REQ: DESIGN-SYSTEM.md rules 2-3; specs/design-system.yaml required_evidence contrast_token_checks
// and figma_code_inventory. Every class the wrapper names must exist in the governed stylesheet.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const selectors = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{[^{}]*\}/g, ' ');
const defined = new Set([...selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

function token(name: string): string {
  const value = resolveLightToken(name);
  if (!value?.startsWith('#')) throw new Error(`token ${name} does not resolve to a hex colour`);
  return value;
}

describe('UX4G Figma/code inventory', () => {
  it.each(UX4G_FIGMA_INVENTORY.flatMap((c) => c.classes.map((cls) => [c.figma, cls] as const)))(
    '%s class %s is defined by styles.css',
    (_figma, cls) => {
      expect(defined.has(cls)).toBe(true);
    },
  );

  it('TextLink renders a defined UX4G text-link class', () => {
    const html = renderToStaticMarkup(
      createElement(TextLink, { href: '#x', children: 'Guidance' }),
    );
    const cls = /class="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(cls).toBe('ux4g-text-link-m');
    expect(cls.split(' ').every((c) => defined.has(c))).toBe(true);
  });
});

describe('form token contrast (WCAG 2.1 AA, light theme)', () => {
  const surfaces = ['--ux4g-bg-neutral-elevated', '--ux4g-bg-neutral'] as const;

  it.each([
    '--ux4g-text-neutral-primary',
    '--ux4g-text-neutral-secondary',
    '--ux4g-text-neutral-tertiary',
    '--ux4g-text-status-error',
    '--ux4g-text-status-success',
    '--ux4g-text-status-warning',
    '--ux4g-text-link-default-default',
  ])('text %s meets 4.5:1 on form surfaces (1.4.3)', (fg) => {
    for (const bg of surfaces) {
      expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  });

  it.each([
    ['field boundary', '--ux4g-color-neutral-500'],
    ['error boundary', '--ux4g-border-color-error-strong'],
    ['success boundary', '--ux4g-border-color-success-strong'],
    ['warning boundary', '--ux4g-color-orange-700'],
    ['focus outline', '--ux4g-border-color-neutral-focus'],
    ['selected control fill', '--ux4g-bg-primary-strong'],
  ])('%s %s meets 3:1 on the elevated surface (1.4.11)', (_role, fg) => {
    expect(contrastRatio(token(fg), token('--ux4g-bg-neutral-elevated'))).toBeGreaterThanOrEqual(
      WCAG_AA_UI,
    );
  });

  it('primary action text meets 4.5:1 on the primary fill', () => {
    expect(
      contrastRatio(token('--ux4g-text-neutral-inverse'), token('--ux4g-bg-primary-strong')),
    ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it('the vendored warning-strong border is below 3:1, so form fields override it', () => {
    expect(
      contrastRatio(
        token('--ux4g-border-color-warning-strong'),
        token('--ux4g-bg-neutral-elevated'),
      ),
    ).toBeLessThan(WCAG_AA_UI);
    expect(css).toMatch(
      /\.sf-app \.ux4g-input-warning \.ux4g-input \{\s*border-color: var\(--ux4g-color-orange-700\);/,
    );
  });
});
