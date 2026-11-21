import { describe, expect, it } from 'vitest';
import {
  DESK_LABELS,
  deskActionsForRole,
  deskHomeForRoles,
  deskRoles,
  isHelpdeskRole,
} from '../lib/portal/desk';
import { safeNext } from '../lib/safe-next';

describe('SAMPLE_LAB desk home routing (SF-50)', () => {
  it('routes single scrutiny / approving desks to applications?desk=<role_code>', () => {
    expect(deskHomeForRoles(['SAMPLE_LAB_SCRUTINY_OFFICER'])).toBe(
      '/applications?desk=SAMPLE_LAB_SCRUTINY_OFFICER',
    );
    expect(deskHomeForRoles(['SAMPLE_LAB_APPROVING_AUTHORITY'])).toBe(
      '/applications?desk=SAMPLE_LAB_APPROVING_AUTHORITY',
    );
  });

  it('routes combined case / multi-desk officers to the neutral applications queue', () => {
    expect(deskHomeForRoles(['SAMPLE_LAB_CASE_OFFICER'])).toBe('/applications');
    expect(
      deskHomeForRoles([
        'SAMPLE_LAB_CASE_OFFICER',
        'SAMPLE_LAB_SCRUTINY_OFFICER',
        'SAMPLE_LAB_APPROVING_AUTHORITY',
      ]),
    ).toBe('/applications');
    expect(
      deskHomeForRoles(['SAMPLE_LAB_SCRUTINY_OFFICER', 'SAMPLE_LAB_APPROVING_AUTHORITY']),
    ).toBe('/applications');
  });

  it('routes helpdesk-only role codes to /helpdesk', () => {
    expect(deskHomeForRoles(['SAMPLE_LAB_HELPDESK_L1'])).toBe('/helpdesk');
    expect(deskHomeForRoles(['SAMPLE_LAB_HELPDESK_L2', 'SAMPLE_LAB_HELPDESK_L3'])).toBe(
      '/helpdesk',
    );
    expect(isHelpdeskRole('SAMPLE_LAB_HELPDESK_L1')).toBe(true);
    expect(isHelpdeskRole('SAMPLE_LAB_SCRUTINY_OFFICER')).toBe(false);
  });

  it('routes inspection-only role codes to /inspection (SF-57)', () => {
    expect(deskHomeForRoles(['SAMPLE_LAB_INSPECTION_OFFICER'])).toBe('/inspection');
  });

  it('does not invent a case desk for studio-only roles', () => {
    expect(deskHomeForRoles(['STUDIO_DESIGNER'])).toBe('/');
    expect(deskHomeForRoles(['STUDIO_CHECKER', 'TENANT_ADMIN_STUDIO'])).toBe('/');
    expect(deskHomeForRoles([])).toBe('/');
  });

  it('never branches on display names or subjects (role_code matrix only)', () => {
    // Passing a subject-like string must not open a desk.
    expect(deskHomeForRoles(['sample-lab-scrutiny-officer-1'])).toBe('/');
    expect(deskHomeForRoles(['SAMPLE LAB Scrutiny Desk'])).toBe('/');
  });

  it('safeNext keeps ?next= override and rejects open redirects onto the desk home', () => {
    const scrutiny = deskHomeForRoles(['SAMPLE_LAB_SCRUTINY_OFFICER']);
    expect(safeNext('/applications/abc', scrutiny)).toBe('/applications/abc');
    expect(safeNext('//evil.example', scrutiny)).toBe(scrutiny);
    expect(safeNext('/.//evil.example', scrutiny)).toBe(scrutiny);
    expect(safeNext(undefined, scrutiny)).toBe(scrutiny);
  });

  it('keeps SF-46 desk labels and actions for HUMAN_TASK role codes', () => {
    expect(DESK_LABELS.SAMPLE_LAB_HELPDESK_L1).toBe('Helpdesk L1');
    expect(deskRoles(['SAMPLE_LAB_HELPDESK_L1', 'STUDIO_DESIGNER'])).toEqual([
      'SAMPLE_LAB_HELPDESK_L1',
    ]);
    expect(deskActionsForRole('SAMPLE_LAB_SCRUTINY_OFFICER')).toEqual(['FORWARD', 'REJECT']);
  });
});
