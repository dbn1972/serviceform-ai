import { Cmp001Error } from '../errors.js';

/** Catalogue never mutates a published pin (Constitution #8). CMP-052 owns pins. */
export function assertUnpublished(publishedPinRef: string | null | undefined): void {
  if (publishedPinRef) {
    throw new Cmp001Error('SF-APP-001', { details: [{ code: 'PUBLISHED_VERSION_IMMUTABLE' }] });
  }
}

export function rejectClientPin(body: object): void {
  if (Object.prototype.hasOwnProperty.call(body, 'published_pin_ref')) {
    throw new Cmp001Error('SF-SYS-003', { details: [{ code: 'CLIENT_PIN_FORBIDDEN' }] });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tenant_id')) {
    throw new Cmp001Error('SF-TEN-002', { details: [{ code: 'CLIENT_TENANT_FORBIDDEN' }] });
  }
}
