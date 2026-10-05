import { describe, expect, it } from 'vitest';
import {
  addDuration,
  CalendarHorizonError,
  durationBetween,
  isIsoDate,
  MS_PER_MINUTE,
  validateCalendar,
  type CalendarSpec,
} from '../../src/domain/calendar.js';

const cal: CalendarSpec = {
  utc_offset_minutes: 0,
  working_weekdays: [1, 2, 3, 4, 5],
  window_start_minute: 540,
  window_end_minute: 1020,
  holidays: ['2026-10-12'],
};
const at = (iso: string): number => Date.parse(iso);
const min = (n: number): number => n * MS_PER_MINUTE;

describe('working-calendar arithmetic (deterministic)', () => {
  it('spans windows and weekends for working minutes', () => {
    // Fri 2026-10-09 16:00 + 120 working minutes -> 60 left today, then Mon 09:00 + 60
    const noHolidays: CalendarSpec = { ...cal, holidays: [] };
    const d = addDuration(noHolidays, 'WORKING_MINUTES', at('2026-10-09T16:00:00Z'), min(120));
    expect(new Date(d).toISOString()).toBe('2026-10-12T10:00:00.000Z');
  });

  it('skips a published holiday (Mon 2026-10-12)', () => {
    const d = addDuration(cal, 'WORKING_MINUTES', at('2026-10-09T16:00:00Z'), min(120));
    expect(new Date(d).toISOString()).toBe('2026-10-13T10:00:00.000Z');
  });

  it('lands exactly on the window end when the duration fits exactly', () => {
    const d = addDuration(cal, 'WORKING_MINUTES', at('2026-10-05T09:00:00Z'), min(480));
    expect(new Date(d).toISOString()).toBe('2026-10-05T17:00:00.000Z');
  });

  it('starts counting at the next window when started outside working time', () => {
    const d = addDuration(cal, 'WORKING_MINUTES', at('2026-10-10T12:00:00Z'), min(30));
    expect(new Date(d).toISOString()).toBe('2026-10-13T09:30:00.000Z');
  });

  it('calendar-minute basis ignores the working calendar', () => {
    const d = addDuration(cal, 'CALENDAR_MINUTES', at('2026-10-10T12:00:00Z'), min(90));
    expect(new Date(d).toISOString()).toBe('2026-10-10T13:30:00.000Z');
  });

  it('applies the calendar UTC offset to local windows and holidays', () => {
    const ist: CalendarSpec = { ...cal, utc_offset_minutes: 330, holidays: [] };
    // 09:00 local = 03:30Z
    const d = addDuration(ist, 'WORKING_MINUTES', at('2026-10-05T00:00:00Z'), min(60));
    expect(new Date(d).toISOString()).toBe('2026-10-05T04:30:00.000Z');
  });

  it('rejects non-positive durations and exhausted horizons', () => {
    expect(() => addDuration(cal, 'WORKING_MINUTES', 0, 0)).toThrow(RangeError);
    const allHolidays: CalendarSpec = {
      ...cal,
      working_weekdays: [1],
      holidays: Array.from(
        { length: 3 },
        (_, i) => `2026-10-${String(5 + 7 * i).padStart(2, '0')}`,
      ),
    };
    expect(() =>
      addDuration(allHolidays, 'WORKING_MINUTES', at('2026-10-05T00:00:00Z'), min(1) * 100_000_000),
    ).toThrow(CalendarHorizonError);
  });

  it('measures elapsed working time and is the inverse of addDuration', () => {
    const start = at('2026-10-09T16:00:00Z');
    const end = addDuration(cal, 'WORKING_MINUTES', start, min(600));
    expect(durationBetween(cal, 'WORKING_MINUTES', start, end)).toBe(min(600));
    expect(durationBetween(cal, 'WORKING_MINUTES', end, start)).toBe(0);
    expect(durationBetween(cal, 'CALENDAR_MINUTES', start, start + 5000)).toBe(5000);
  });

  it('is reproducible and unaffected by a later calendar version', () => {
    const first = addDuration(cal, 'WORKING_MINUTES', at('2026-10-05T10:00:00Z'), min(960));
    const laterVersion: CalendarSpec = { ...cal, holidays: ['2026-10-05', '2026-10-06'] };
    expect(addDuration(cal, 'WORKING_MINUTES', at('2026-10-05T10:00:00Z'), min(960))).toBe(first);
    expect(
      addDuration(laterVersion, 'WORKING_MINUTES', at('2026-10-05T10:00:00Z'), min(960)),
    ).not.toBe(first);
  });
});

describe('calendar validation', () => {
  it('accepts a well-formed calendar', () => {
    expect(validateCalendar(cal)).toBeNull();
  });
  it.each([
    [{ utc_offset_minutes: 9999 }, 'UTC_OFFSET_INVALID'],
    [{ working_weekdays: [] }, 'WORKING_WEEKDAYS_INVALID'],
    [{ working_weekdays: [1, 1] }, 'WORKING_WEEKDAYS_INVALID'],
    [{ working_weekdays: [8] }, 'WORKING_WEEKDAYS_INVALID'],
    [{ window_start_minute: 600, window_end_minute: 600 }, 'WORKING_WINDOW_INVALID'],
    [{ holidays: ['2026-02-30'] }, 'HOLIDAYS_INVALID'],
  ])('rejects %j', (patch, code) => {
    expect(validateCalendar({ ...cal, ...patch })).toBe(code);
  });
  it('checks ISO dates strictly', () => {
    expect(isIsoDate('2026-10-12')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('12-10-2026')).toBe(false);
  });
});
