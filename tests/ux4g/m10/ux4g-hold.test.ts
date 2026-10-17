/**
 * SF-M10-005 UX4G hold — fail-closed until Design System evidence is authorized.
 * Does not invent a11y thresholds or visual baselines. Does not claim UX4G PASS.
 * Set SF_M10_UX4G_READY=1 only when human-authorized UX4G evidence pack exists.
 */
import { describe, expect, it } from 'vitest';

const UX4G_READY = process.env['SF_M10_UX4G_READY'] === '1';

describe('M10 UX4G golden evidence hold (fail-closed)', () => {
  it('refuses to claim UX4G PASS when SF_M10_UX4G_READY is unset', () => {
    expect(UX4G_READY).toBe(false);
  });

  it('documents required UX4G artifacts before golden UI evidence may run', () => {
    const required = [
      'tests/ux4g/m10/** Playwright a11y/keyboard/responsive suites',
      'evidence/SF-M10-005 with executed axe/keyboard/responsive/visual logs',
      'DESIGN-SYSTEM.md / specs/design-system.yaml compliance (no second design system)',
    ] as const;
    expect(required.length).toBe(3);
  });

  it.skipIf(!UX4G_READY)(
    'UX4G golden execution placeholder — only runs when SF_M10_UX4G_READY=1',
    () => {
      expect(UX4G_READY).toBe(true);
    },
  );

  it.todo(
    'Citizen golden journey UX4G a11y/keyboard/responsive/visual — blocked until SF-M10-005 READY + shells',
  );
});
