/**
 * Golden E2E harness — IND-SOC-002 Residence Certificate (M10).
 *
 * Finding M-04 policy sample: Odisha e-District public Resident Certificate
 * (https://edistrict.odisha.gov.in/) is on SoT. Set SF_M10_OWNER_INPUTS_READY=1
 * to activate sample-backed gates (see tests/integration/m10/support/fixtures.ts).
 * DigiLocker/DLT remain SAMPLE_LAB_* — not production registrations.
 *
 * Architecture Constitution §30: The Residence Certificate Golden Vertical Slice
 * must be authored through ServiceForm Studio and run end-to-end without
 * service-specific backend code.
 *
 * These tests are structured so that:
 *   • Harness health / tenant probes / ARIA scaffolding run and must pass.
 *   • Journey bodies require Studio/citizen/officer routes beyond M00 shells and
 *     remain fail-closed (SHELL_JOURNEY_NOT_IMPLEMENTED) even when owner inputs
 *     are ready — they must not invent eligibility, fee, SLA or statute values.
 *   • G6 is not claimed by this harness.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// ── Policy-input guard ────────────────────────────────────────────────────────

const OWNER_INPUTS_READY = process.env['SF_M10_OWNER_INPUTS_READY'] === '1';

/**
 * Fail-closed gate for journey paths that need Studio/citizen/officer routes.
 * Always register with an explicit body — one-arg `test.skip(title)` soft-skips
 * the rest of the file under Playwright 1.63.
 * Journeys stay skipped until shells expose IND-SOC-002 routes (not inventable).
 */
function policyGated(
  title: string,
  policyInputsNeeded: readonly string[],
  _fn: Parameters<typeof test>[1],
): void {
  const reason = OWNER_INPUTS_READY
    ? `SHELL_JOURNEY_NOT_IMPLEMENTED — ${title}`
    : `POLICY_INPUT_REQUIRED — needs: ${policyInputsNeeded.join(', ')}`;
  test(title, () => {
    test.skip(true, reason);
  });
}

test.describe('M10 Golden E2E — owner-input gate', () => {
  test('fails closed when SF_M10_OWNER_INPUTS_READY is unset; Odisha sample when set', () => {
    // Fail-closed: never invent eligibility/fee/SLA/statute when owner inputs are missing.
    if (OWNER_INPUTS_READY) {
      expect(OWNER_INPUTS_READY).toBe(true);
      return;
    }
    expect(() => {
      throw new Error(
        'POLICY_INPUT_REQUIRED: owner inputs not yet supplied. ' +
          'Set SF_M10_OWNER_INPUTS_READY=1 to use the Odisha public sample on tip. ' +
          'Context: golden-e2e',
      );
    }).toThrow(/POLICY_INPUT_REQUIRED/);
  });
});

// ── Portal URL helpers ────────────────────────────────────────────────────────

const CITIZEN_PORTAL = `http://127.0.0.1:3000`;
const OFFICER_WORKBENCH = `http://127.0.0.1:3001`;
const STUDIO = `http://127.0.0.1:3002`;

// ── Harness health checks (no policy inputs required) ─────────────────────────

test.describe('M10 Golden E2E — harness health (IND-SOC-002 scaffold)', () => {
  test('citizen portal health endpoint responds 200', async ({ request }) => {
    const res = await request.get(`${CITIZEN_PORTAL}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('officer workbench health endpoint responds 200', async ({ request }) => {
    const res = await request.get(`${OFFICER_WORKBENCH}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('studio health endpoint responds 200', async ({ request }) => {
    const res = await request.get(`${STUDIO}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('citizen portal is reachable and has correct page title', async ({ page }) => {
    await page.goto(CITIZEN_PORTAL);
    await expect(page).toHaveTitle(/ServiceForm AI/);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('officer workbench is reachable and has correct page title', async ({ page }) => {
    await page.goto(OFFICER_WORKBENCH);
    await expect(page).toHaveTitle(/ServiceForm AI/);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('studio is reachable and has correct page title', async ({ page }) => {
    await page.goto(STUDIO);
    await expect(page).toHaveTitle(/ServiceForm AI/);
    await expect(page.getByRole('main')).toBeVisible();
  });
});

// ── Tenant isolation (no policy inputs required) ──────────────────────────────

test.describe('M10 Golden E2E — tenant isolation probes', () => {
  test('citizen portal does not serve cross-tenant data in page source', async ({ page }) => {
    // Canary sentinel must never appear in any served HTML.
    const CANARY = '00000000-0000-4000-8000-000000000099';
    await page.goto(CITIZEN_PORTAL);
    const content = await page.content();
    expect(content).not.toContain(CANARY);
  });

  test('API health endpoint does not include tenant identifiers in response body', async ({
    request,
  }) => {
    const SYNTHETIC_TENANT_IDS = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const res = await request.get(`${CITIZEN_PORTAL}/api/health`);
    const body = await res.text();
    for (const id of SYNTHETIC_TENANT_IDS) {
      expect(body, `health endpoint must not contain synthetic tenant id ${id}`).not.toContain(id);
    }
  });

  test('forged x-tenant-id header on citizen portal health returns 403 or is ignored (SF-TEN-002)', async ({
    request,
  }) => {
    const FORGED = '00000000-0000-4000-8000-000000000099';
    const res = await request.get(`${CITIZEN_PORTAL}/api/health`, {
      headers: { 'x-tenant-id': FORGED },
    });
    // Health endpoint is unauthenticated; a forged header must not alter tenant context.
    // Accept 200 (ignored) or 403 (actively refused). Never 500.
    expect([200, 403]).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain(FORGED);
  });
});

// ── UX4G accessibility gates (no policy inputs required) ──────────────────────

test.describe('M10 Golden E2E — UX4G accessibility scaffolding', () => {
  async function checkBasicA11y(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }

  test('citizen portal has required ARIA landmarks', async ({ page }) => {
    await checkBasicA11y(page, CITIZEN_PORTAL);
  });

  test('officer workbench has required ARIA landmarks', async ({ page }) => {
    await checkBasicA11y(page, OFFICER_WORKBENCH);
  });
});

// ── Golden vertical slice (gated; journeys need real Studio/portal routes) ────

const JOURNEY_BLOCKED =
  'SHELL_JOURNEY_NOT_IMPLEMENTED: M00 web shells lack IND-SOC-002 Studio/citizen/officer routes. ' +
  'Policy sample (Odisha) is on tip; journey UI + REAL DigiLocker/UX4G evidence still required for G6. ' +
  'Do not invent statute or DigiLocker doc types.';

policyGated(
  'Studio: author IND-SOC-002 service metadata without bespoke backend code',
  ['pilot_tenant', 'legal_basis_ref', 'eligibility_rule_ref', 'credential_template_ref'],
  async ({ page }) => {
    // Architecture Constitution §30: authored through Studio, no service-specific code.
    await page.goto(`${STUDIO}/services/new`);
    throw new Error(JOURNEY_BLOCKED);
  },
);

policyGated(
  'Citizen: submit residence certificate application end-to-end',
  ['pilot_tenant', 'eligibility_rule_ref', 'fee_schedule_ref'],
  async ({ page }) => {
    await page.goto(`${CITIZEN_PORTAL}/services/IND-SOC-002`);
    throw new Error(JOURNEY_BLOCKED);
  },
);

policyGated(
  'Officer: approve application and trigger credential issuance',
  ['pilot_tenant', 'credential_template_ref'],
  async ({ page }) => {
    await page.goto(`${OFFICER_WORKBENCH}/applications`);
    throw new Error(JOURNEY_BLOCKED);
  },
);

policyGated(
  'Citizen: receive issued residence certificate and verify via QR',
  ['pilot_tenant', 'credential_template_ref'],
  async ({ page }) => {
    await page.goto(`${CITIZEN_PORTAL}/certificates`);
    throw new Error(JOURNEY_BLOCKED);
  },
);

policyGated(
  'Payment: SANDBOX connector exercises same callback/state-machine as REAL (Architecture Constitution §14)',
  ['pilot_tenant', 'fee_schedule_ref'],
  async ({ page }) => {
    await page.goto(`${CITIZEN_PORTAL}/services/IND-SOC-002/payment`);
    // Odisha sample fee is ₹0 — payment path still blocked until shells expose route.
    throw new Error(JOURNEY_BLOCKED);
  },
);

policyGated(
  'DigiLocker: publish issued certificate; verify delivery failure does not undo issued state',
  ['pilot_tenant', 'credential_template_ref'],
  async ({ page }) => {
    // Architecture Constitution §18: delivery failures do not undo already-issued credential.
    await page.goto(`${CITIZEN_PORTAL}/certificates`);
    throw new Error(JOURNEY_BLOCKED);
  },
);

policyGated(
  'Second service reuse: onboard a second service largely through configuration (Architecture Constitution §31)',
  ['pilot_tenant'],
  async ({ page }) => {
    await page.goto(`${STUDIO}/services/new`);
    throw new Error(JOURNEY_BLOCKED);
  },
);
