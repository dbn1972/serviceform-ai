/**
 * Deterministic business-calendar arithmetic. Pure functions of (calendar version, instants).
 * A calendar version is immutable once registered, so a pinned clock never changes when a later
 * calendar version adds holidays (Eng v1.4 CMP-029 acceptance).
 */
export const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 1_440 * MS_PER_MINUTE;
const MAX_DAYS_SCANNED = 40_000;

export type DurationBasis = 'WORKING_MINUTES' | 'CALENDAR_MINUTES';

export interface CalendarSpec {
  utc_offset_minutes: number;
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. */
  working_weekdays: readonly number[];
  window_start_minute: number;
  window_end_minute: number;
  /** Calendar-local dates, YYYY-MM-DD. */
  holidays: readonly string[];
}

export class CalendarHorizonError extends Error {
  constructor() {
    super('calendar horizon exceeded');
    this.name = 'CalendarHorizonError';
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function localDayIndex(utcMs: number, cal: CalendarSpec): number {
  return Math.floor((utcMs + cal.utc_offset_minutes * MS_PER_MINUTE) / MS_PER_DAY);
}

function isoWeekday(dayIndex: number): number {
  return mod(dayIndex + 3, 7) + 1;
}

function localDate(dayIndex: number): string {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

function dayWindow(dayIndex: number, cal: CalendarSpec): [number, number] {
  const midnightUtc = dayIndex * MS_PER_DAY - cal.utc_offset_minutes * MS_PER_MINUTE;
  return [
    midnightUtc + cal.window_start_minute * MS_PER_MINUTE,
    midnightUtc + cal.window_end_minute * MS_PER_MINUTE,
  ];
}

class CalendarIndex {
  private readonly weekdays: ReadonlySet<number>;
  private readonly holidays: ReadonlySet<string>;

  constructor(readonly cal: CalendarSpec) {
    this.weekdays = new Set(cal.working_weekdays);
    this.holidays = new Set(cal.holidays);
  }

  isWorkingDay(dayIndex: number): boolean {
    return this.weekdays.has(isoWeekday(dayIndex)) && !this.holidays.has(localDate(dayIndex));
  }
}

export function validateCalendar(cal: CalendarSpec): string | null {
  if (!Number.isInteger(cal.utc_offset_minutes)) return 'UTC_OFFSET_INVALID';
  if (cal.utc_offset_minutes < -720 || cal.utc_offset_minutes > 840) return 'UTC_OFFSET_INVALID';
  if (cal.working_weekdays.length < 1 || cal.working_weekdays.length > 7) {
    return 'WORKING_WEEKDAYS_INVALID';
  }
  const days = new Set(cal.working_weekdays);
  if (days.size !== cal.working_weekdays.length) return 'WORKING_WEEKDAYS_INVALID';
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) return 'WORKING_WEEKDAYS_INVALID';
  }
  const { window_start_minute: s, window_end_minute: e } = cal;
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 1440 || s >= e) {
    return 'WORKING_WINDOW_INVALID';
  }
  if (cal.holidays.length > 3660) return 'HOLIDAYS_INVALID';
  for (const h of cal.holidays) {
    if (!isIsoDate(h)) return 'HOLIDAYS_INVALID';
  }
  return null;
}

export function isIsoDate(value: string): boolean {
  if (value.length !== 10 || value[4] !== '-' || value[7] !== '-') return false;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Instant reached after consuming `ms` of the given basis, starting at `fromMs`. */
export function addDuration(
  cal: CalendarSpec,
  basis: DurationBasis,
  fromMs: number,
  ms: number,
): number {
  if (!(ms > 0)) throw new RangeError('duration must be positive');
  if (basis === 'CALENDAR_MINUTES') return fromMs + ms;
  const index = new CalendarIndex(cal);
  let remaining = ms;
  let day = localDayIndex(fromMs, cal);
  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1, day += 1) {
    if (!index.isWorkingDay(day)) continue;
    const [windowStart, windowEnd] = dayWindow(day, cal);
    const start = Math.max(windowStart, fromMs);
    if (start >= windowEnd) continue;
    const available = windowEnd - start;
    if (remaining <= available) return start + remaining;
    remaining -= available;
  }
  throw new CalendarHorizonError();
}

/** Amount of the given basis elapsed between two instants; 0 when `toMs <= fromMs`. */
export function durationBetween(
  cal: CalendarSpec,
  basis: DurationBasis,
  fromMs: number,
  toMs: number,
): number {
  if (toMs <= fromMs) return 0;
  if (basis === 'CALENDAR_MINUTES') return toMs - fromMs;
  const index = new CalendarIndex(cal);
  const lastDay = localDayIndex(toMs, cal);
  let total = 0;
  let day = localDayIndex(fromMs, cal);
  if (lastDay - day > MAX_DAYS_SCANNED) throw new CalendarHorizonError();
  for (; day <= lastDay; day += 1) {
    if (!index.isWorkingDay(day)) continue;
    const [windowStart, windowEnd] = dayWindow(day, cal);
    const start = Math.max(windowStart, fromMs);
    const end = Math.min(windowEnd, toMs);
    if (end > start) total += end - start;
  }
  return total;
}
