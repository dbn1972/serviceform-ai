import { Cmp025Error, detail } from '../errors.js';
import type { Channel, HandleClass } from '../domain/model.js';

export interface RecipientLookup {
  tenantId: string;
  handleClass: HandleClass;
  handleRef: string;
  channel: Channel;
  signal: AbortSignal;
}

/**
 * Resolves an opaque recipient handle to a deliverable address at send time, outside any DB
 * transaction. The address is passed straight to the connector and is never persisted or logged.
 * Owned by the identity/profile components (CMP-004/CMP-005); bound by the host.
 */
export interface RecipientDirectoryPort {
  resolve(lookup: RecipientLookup): Promise<{ address: string } | null>;
}

export class UnboundRecipientDirectoryPort implements RecipientDirectoryPort {
  resolve(): Promise<{ address: string } | null> {
    return Promise.reject(
      new Cmp025Error('SF-INT-001', detail('RECIPIENT_DIRECTORY_PORT_UNBOUND')),
    );
  }
}
