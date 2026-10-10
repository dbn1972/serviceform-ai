export const PERIOD_GRANULARITIES = ['HOUR', 'DAY', 'WEEK', 'MONTH'] as const;
export type PeriodGranularity = (typeof PERIOD_GRANULARITIES)[number];

export interface Period {
  start: string;
  /** Exclusive upper bound of the bucket. */
  end: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** 1970-01-05T00:00:00Z, the first Monday after the epoch: ISO weeks start on Monday (UTC). */
const FIRST_MONDAY_MS = 4 * DAY_MS;

/** Buckets are UTC; tenant-local reporting calendars belong to a later, metadata-defined layer. */
export function periodFor(occurredAtIso: string, granularity: PeriodGranularity): Period {
  const t = Date.parse(occurredAtIso);
  if (Number.isNaN(t)) throw new RangeError('INVALID_TIMESTAMP');
  let start: number;
  let end: number;
  switch (granularity) {
    case 'HOUR':
      start = Math.floor(t / HOUR_MS) * HOUR_MS;
      end = start + HOUR_MS;
      break;
    case 'DAY':
      start = Math.floor(t / DAY_MS) * DAY_MS;
      end = start + DAY_MS;
      break;
    case 'WEEK':
      start = Math.floor((t - FIRST_MONDAY_MS) / WEEK_MS) * WEEK_MS + FIRST_MONDAY_MS;
      end = start + WEEK_MS;
      break;
    case 'MONTH': {
      const d = new Date(t);
      start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      break;
    }
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
