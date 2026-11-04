import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeNext as citizenSafeNext } from '../../../apps/web-citizen/lib/auth-client';
import { bffCitizen, CITIZEN_BFF, cookieToken, OFFICER_BFF, ROOT } from './lib/lab';

/** The officer sanitiser is module-private in a client component; evaluate its exact source. */
function officerSafeNext(): (raw: string | undefined) => string {
  const src = readFileSync(join(ROOT, 'apps/web-officer/components/OfficerSignIn.tsx'), 'utf8');
  const start = src.indexOf('function safeNext(');
  const end = src.indexOf('\n}\n', start) + 2;
  const js = ts.transpileModule(src.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${js}; return safeNext;`)() as (raw: string | undefined) => string;
}

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
];

const isProtocolRelative = (s: string) => /^[/\\]{2}/.test(s);

describe('SEC-REDIRECT next parameter sanitisers (unit)', () => {
  const officer = officerSafeNext();
  for (const raw of OFFSITE) {
    it(`both sanitisers fall back for ${JSON.stringify(raw)}`, () => {
      expect(citizenSafeNext(raw)).toBe('/services');
      expect(officer(raw)).toBe('/applications');
    });
  }
  for (const raw of NORMALISED_TO_PROTOCOL_RELATIVE) {
    it(`FINDING: dot-segment ${JSON.stringify(raw)} must not yield a protocol-relative target`, () => {
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

  it('FINDING: officer sign-in with next=/.//evil.example navigates off-site', async () => {
    const page = await browser.newPage();
    await page.route('**://evil.example/**', (r) => r.fulfill({ status: 200, body: 'OFFSITE' }));
    await page.goto(`${OFFICER_BFF}/login?next=${encodeURIComponent('/.//evil.example')}`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForTimeout(3000);
    const host = new URL(page.url()).hostname;
    await page.close();
    expect.soft(host, 'officer landed on').not.toBe('evil.example');
  });

  it('FINDING: citizen signed-in "Continue" link honours next=/.//evil.example', async () => {
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
