import { describe, expect, it } from 'vitest';
import { deskLabelsForRoles } from '../lib/portal/desk';
import { humanStatusLabel, statusChrome, statusTagClass } from '../lib/portal/status-view';

describe('officer status chrome (Wave 1 UX)', () => {
  it('dedupes identical status and platform_state tags', () => {
    const chrome = statusChrome('SUBMITTED', 'SUBMITTED');
    expect(chrome.primary.label).toBe('SUBMITTED');
    expect(chrome.primary.title).toBe('Submitted');
    expect(chrome.platformDiff).toBeUndefined();
  });

  it('shows platformDiff only when platform_state differs', () => {
    const chrome = statusChrome('SUBMITTED', 'UNDER_SCRUTINY');
    expect(chrome.primary.label).toBe('SUBMITTED');
    expect(chrome.platformDiff?.label).toBe('UNDER_SCRUTINY');
    expect(chrome.platformDiff?.title).toBe('Under scrutiny');
    expect(chrome.platformDiff?.code).toBe('UNDER_SCRUTINY');
  });

  it('maps enums to human titles and tonal classes', () => {
    expect(humanStatusLabel('ISSUED')).toBe('Issued');
    expect(humanStatusLabel('DEFICIENCY_RAISED')).toBe('Deficiency raised');
    expect(statusTagClass('REJECTED')).toBe('ux4g-tag-tonal-error');
    expect(statusTagClass('SUBMITTED')).toBe('ux4g-tag-tonal-info');
    expect(statusTagClass('ISSUED')).toBe('ux4g-tag-tonal-success');
  });

  it('formats login desk labels without raw ROLE_CODE dumps', () => {
    expect(
      deskLabelsForRoles(['SAMPLE_LAB_SCRUTINY_OFFICER', 'SAMPLE_LAB_APPROVING_AUTHORITY']),
    ).toEqual(['Scrutiny desk', 'Approving desk']);
    const joined = deskLabelsForRoles(['SAMPLE_LAB_CASE_OFFICER']).join(', ');
    expect(joined).not.toContain('SAMPLE_LAB_');
    expect(joined).not.toMatch(/ROLE_CODE/i);
  });
});
