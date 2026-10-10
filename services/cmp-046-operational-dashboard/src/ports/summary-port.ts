import type { PortSample, ViewCode } from '../domain/model.js';
import type { TenantContext } from '../types.js';

/**
 * Read-only aggregate ports. CMP-046 never imports peer source or touches peer tables: each
 * owner (CMP-029 SLA, CMP-017 queues, CMP-037 integration hub, CMP-038 event bus, CMP-047
 * observability) exposes tenant-scoped aggregates through its own adapter. Ports are called
 * outside any database transaction. An adapter returns aggregates only; the service validates
 * the sample and refuses anything that looks like an individual record.
 */
export interface SummaryPort {
  fetchSummary(ctx: TenantContext): Promise<PortSample>;
}

export type SlaSummaryPort = SummaryPort;
export type WorkQueueSummaryPort = SummaryPort;
export type IntegrationHealthPort = SummaryPort;
export type EventHealthPort = SummaryPort;
export type PlatformHealthPort = SummaryPort;

export type SummaryPorts = Readonly<Record<ViewCode, SummaryPort>>;

export class PortUnboundError extends Error {
  readonly code = 'PORT_UNBOUND';
  constructor(readonly viewCode: ViewCode) {
    super(`no adapter bound for ${viewCode}`);
    this.name = 'PortUnboundError';
  }
}

/** Fails visibly: an unbound source is reported UNAVAILABLE, never fabricated as healthy. */
export class UnboundSummaryPort implements SummaryPort {
  constructor(private readonly viewCode: ViewCode) {}
  fetchSummary(): Promise<PortSample> {
    return Promise.reject(new PortUnboundError(this.viewCode));
  }
}
