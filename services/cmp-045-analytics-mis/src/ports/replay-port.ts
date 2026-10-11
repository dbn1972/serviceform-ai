import { Cmp045Error } from '../errors.js';
import type { EventEnvelope } from '../types.js';

export interface ReplayRequest {
  tenant_id: string;
  event_type: string;
  aggregate_type: string | null;
  /** Opaque, port-owned position. `null` starts from the beginning of retained history. */
  cursor: string | null;
  limit: number;
}

export interface ReplayBatch {
  events: EventEnvelope<Record<string, unknown>>[];
  /** `null` when history is exhausted. */
  next_cursor: string | null;
}

/**
 * Rebuild source (INT-010: derived stores are rebuildable from authoritative events). The host binds
 * it to the CMP-038 event history; CMP-045 never reads another component's tables to rebuild.
 * Called outside any database transaction.
 */
export interface EventReplayPort {
  readBatch(request: ReplayRequest): Promise<ReplayBatch>;
}

/** Default until the host binds CMP-038: rebuild fails explicitly rather than inventing history. */
export class UnboundReplayPort implements EventReplayPort {
  readBatch(): Promise<ReplayBatch> {
    return Promise.reject(
      new Cmp045Error('SF-INT-001', { details: [{ code: 'REPLAY_SOURCE_UNBOUND' }] }),
    );
  }
}
