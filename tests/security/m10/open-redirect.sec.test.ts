import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeNext as citizenSafeNext } from '../../../apps/web-citizen/lib/auth-client';
import { safeNext as officerSafeNext } from '../../../apps/web-officer/lib/safe-next';
import { bffCitizen, CITIZEN_BFF, cookieToken, OFFICER_BFF, ROOT } from './lib/lab';

const OFFSITE = [
  'https://evil.example/x',
  '//evil.example',
  '/\\evil.example',
  '/\t/evil.example',
  'javascript:alert(1)',
  ' /x',
];
const NORMALISED_TO_PROTOCOL_RELATIVE = [
  '/.//evil.example',
  '/..//evil.example',
  '/%2e//evil.example',
  '/a/..//evil.example',
  '/./\\evil.example',
  '/.\\/evil.example',
  '/%2e%2e//evil.example',
  '/%2E/%2E%2E//evil.example',
  '/.//evil.example?next=/x#y',
  '/.\t//evil.example',
  '/.\n//evil.example',
  '/a/b/../..//evil.example',
  '/.///evil.example',
];

const isProtocolRelative = (s: string) => /^[/\\]{2}/.test(s);

describe('SEC-REDIRECT next parameter sanitisers (unit)', () => {
  const officer = (raw: string | undefined) => officerSafeNext(raw);

  it('the officer sign-in component uses the tested lib helper (no private copy)', () => {
    const src = readFileSync(join(ROOT, 'apps/web-officer/components/OfficerSignIn.tsx'), 'utf8');
    expect(src).toMatch(/from '..\/lib\/safe-next'/);
    expect(src).not.toMatch(/function safeNext\(/);
  });

  it('same-origin targets are preserved (control)', () => {
    expect(citizenSafeNext('/applications/x?y=1')).toBe('/applications/x?y=1');
    expect(officer('/applications/x?y=1')).toBe('/applications/x?y=1');
  });
  for (const raw of OFFSITE) {
    it(`both sanitisers fall back for ${JSON.stringify(raw)}`, () => {
      expect(citizenSafeNext(raw)).toBe('/services');
      expect(officer(raw)).toBe('/applications');
    });
  }
  for (const raw of NORMALISED_TO_PROTOCOL_RELATIVE) {
    it(`F-04: ${JSON.stringify(raw)} must not yield a protocol-relative target`, () => {
      expect
        .soft(isProtocolRelative(citizenSafeNext(raw)), `citizen -> ${citizenSafeNext(raw)}`)
        .toBe(false);
      expect.soft(isProtocolRelative(officer(raw)), `officer -> ${officer(raw)}`).toBe(false);
    });
  }
});

describe('SEC-REDIRECT runtime (headless Chromium against the built BFFs)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it('F-04: officer sign-in with next=/.//evil.example stays on the workbench', async () => {
    const page = await browser.newPage();
    await page.route('**://evil.example/**', (r) => r.fulfill({ status: 200, body: 'OFFSITE' }));
    await page.goto(`${OFFICER_BFF}/login?next=${encodeURIComponent('/.//evil.example')}`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForTimeout(3000);
    const host = new URL(page.url()).hostname;
    await page.close();
    expect.soft(host, 'officer landed on').not.toBe('evil.example');
  });

  it('F-04: citizen signed-in "Continue" link ignores next=/.//evil.example', async () => {
    const { cookie } = await bffCitizen();
    const ctx = await browser.newContext();
    const url = new URL(CITIZEN_BFF);
    await ctx.addCookies([
      {
        name: 'sf_citizen_session',
        value: cookieToken(cookie),
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await ctx.newPage();
    await page.route('**://evil.example/**', (r) => r.fulfill({ status: 200, body: 'OFFSITE' }));
    await page.goto(`${CITIZEN_BFF}/login?next=${encodeURIComponent('/.//evil.example')}`);
    const link = page.getByRole('link', { name: /Continue/ });
    await link.waitFor({ timeout: 15_000 });
    const href = await link.getAttribute('href');
    await link.click();
    await page.waitForTimeout(3000);
    const host = new URL(page.url()).hostname;
    await ctx.close();
    expect.soft(href, 'Continue href').not.toMatch(/^\/\//);
    expect.soft(host, 'citizen landed on').not.toBe('evil.example');
  });
});
