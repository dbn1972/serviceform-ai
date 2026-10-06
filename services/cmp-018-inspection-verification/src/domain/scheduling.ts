import { Cmp018Error, detail } from '../errors.js';
import {
  assertOnlyKeys,
  optionalIso,
  optionalString,
  requireRecord,
  SLOT_REF,
  TZ,
} from './validate.js';

/** Scheduling metadata only. Not M09 CMP-056 calendars; no departmental calendar codes. */
export interface ScheduleMeta {
  window_start: Date | null;
  window_end: Date | null;
  slot_ref: string | null;
  location_ref: string | null;
  timezone_iana: string | null;
}

const FORBIDDEN_CALENDAR = /(calendar|department|holiday_pack|cmp_056|office_hours)/i;

export function parseSchedule(body: unknown): ScheduleMeta {
  const obj = requireRecord(body, '');
  if ('tenant_id' in obj) throw new Cmp018Error('SF-TEN-002');
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_CALENDAR.test(key)) {
      throw new Cmp018Error('SF-SYS-003', detail('CALENDAR_PRODUCT_FORBIDDEN', `/${key}`));
    }
  }
  assertOnlyKeys(
    obj,
    ['window_start', 'window_end', 'slot_ref', 'location_ref', 'timezone_iana'],
    '',
  );
  const window_start = optionalIso(obj, 'window_start', '');
  const window_end = optionalIso(obj, 'window_end', '');
  if (window_start && window_end && window_end < window_start) {
    throw new Cmp018Error('SF-SYS-003', detail('INVALID_WINDOW', '/window_end'));
  }
  if (
    !window_start &&
    !window_end &&
    obj['slot_ref'] === undefined &&
    obj['location_ref'] === undefined
  ) {
    throw new Cmp018Error('SF-SYS-003', detail('SCHEDULE_EMPTY', ''));
  }
  return {
    window_start,
    window_end,
    slot_ref: optionalString(obj, 'slot_ref', '', SLOT_REF),
    location_ref: optionalString(obj, 'location_ref', '', SLOT_REF),
    timezone_iana: optionalString(obj, 'timezone_iana', '', TZ),
  };
}
