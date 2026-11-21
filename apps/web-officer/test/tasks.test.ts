import { describe, expect, it } from 'vitest';
import { DESK_LABELS, deskActionsForRole, deskRoles } from '../lib/portal/desk';

describe('SAMPLE_LAB multi-desk helpers (SF-46)', () => {
  it('maps desk role codes to labels without inventing statutory titles', () => {
    expect(DESK_LABELS.SAMPLE_LAB_SCRUTINY_OFFICER).toBe('Scrutiny desk');
    expect(DESK_LABELS.SAMPLE_LAB_APPROVING_AUTHORITY).toBe('Approving desk');
  });

  it('filters session roles to SAMPLE_LAB desk codes', () => {
    expect(
      deskRoles([
        'SAMPLE_LAB_SCRUTINY_OFFICER',
        'STUDIO_DESIGNER',
        'SAMPLE_LAB_APPROVING_AUTHORITY',
      ]),
    ).toEqual(['SAMPLE_LAB_SCRUTINY_OFFICER', 'SAMPLE_LAB_APPROVING_AUTHORITY']);
  });

  it('scrutiny desk forwards; approving desk approves; never invents a named officer action', () => {
    expect(deskActionsForRole('SAMPLE_LAB_SCRUTINY_OFFICER')).toEqual(['FORWARD', 'REJECT']);
    expect(deskActionsForRole('SAMPLE_LAB_APPROVING_AUTHORITY')).toEqual(['APPROVE', 'REJECT']);
    expect(deskActionsForRole('SAMPLE_LAB_CASE_OFFICER')).toEqual(['APPROVE', 'REJECT']);
  });
});
