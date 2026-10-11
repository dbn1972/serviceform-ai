import { Cmp045Error, detail } from '../errors.js';
import type { EventEnvelope } from '../types.js';
import { parseIsoInstant } from './timestamp.js';
import { isUuid } from './uuid.js';

const EVENT_TYPE = /^[A-Z][A-Za-z0-9]{2,79}$/;
const AGGREGATE_TYPE = /^[A-Z][A-Za-z0-9]{1,63}$/;
const CELL_ID = /^cell-[a-z0-9-]{1,40}$/;
const ACTOR_TYPES = ['CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN'];

function bad(pointer: string): never {
  throw new Cmp045Error('SF-SYS-003', detail('INVALID_EVENT_ENVELOPE', pointer));
}

/** Structural check of SF-CON-EVENT-ENVELOPE; the frozen schema stays authoritative (test/contract). */
export function parseEnvelope(raw: unknown): EventEnvelope<Record<string, unknown>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) bad('/');
  const e = raw as Record<string, unknown>;
  const str = (k: string): string => (typeof e[k] === 'string' ? (e[k] as string) : bad(`/${k}`));
  if (!isUuid(str('event_id'))) bad('/event_id');
  if (!EVENT_TYPE.test(str('event_type'))) bad('/event_type');
  if (!Number.isInteger(e['schema_version']) || (e['schema_version'] as number) < 1) {
    bad('/schema_version');
  }
  if (e['tenant_id'] === null || e['tenant_id'] === undefined) {
    throw new Cmp045Error('SF-TEN-001');
  }
  if (!isUuid(str('tenant_id'))) bad('/tenant_id');
  if (!CELL_ID.test(str('cell_id'))) bad('/cell_id');
  if (!AGGREGATE_TYPE.test(str('aggregate_type'))) bad('/aggregate_type');
  if (!isUuid(str('aggregate_id'))) bad('/aggregate_id');
  if (!Number.isInteger(e['aggregate_version']) || (e['aggregate_version'] as number) < 0) {
    bad('/aggregate_version');
  }
  const occurred = str('occurred_at');
  if (parseIsoInstant(occurred) === null) bad('/occurred_at');
  if (!isUuid(str('correlation_id'))) bad('/correlation_id');
  const actor = e['actor'];
  if (
    actor === null ||
    typeof actor !== 'object' ||
    !ACTOR_TYPES.includes((actor as { type?: string }).type ?? '') ||
    !isUuid(String((actor as { id?: unknown }).id))
  ) {
    bad('/actor');
  }
  const data = e['data'];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) bad('/data');
  return e as unknown as EventEnvelope<Record<string, unknown>>;
}
