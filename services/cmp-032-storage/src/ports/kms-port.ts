import { randomBytes } from 'node:crypto';
import type { StorageKmsPort } from '@serviceform/storage';
import { Cmp032Error } from '../errors.js';

export type { StorageKmsPort };

/** Fail-closed local DEK wrap for unit tests / SIMULATED mode without CMP-048. */
export class LocalWrapKms implements StorageKmsPort {
  constructor(private readonly fail = false) {}

  async wrapDek(
    keyRef: string,
    dek: Uint8Array,
    _context: Record<string, string>,
  ): Promise<{ wrappedDek: string; keyVersion: string }> {
    if (this.fail) throw new Error('kms unavailable');
    if (keyRef.length === 0) throw new Error('key ref empty');
    return {
      wrappedDek: Buffer.from(dek).toString('base64'),
      keyVersion: '1',
    };
  }
}

export async function wrapContentDek(
  kms: StorageKmsPort,
  keyRef: string,
  context: Record<string, string>,
): Promise<{ dek: Uint8Array; wrappedDek: string; keyVersion: string }> {
  const dek = randomBytes(32);
  try {
    const wrapped = await kms.wrapDek(keyRef, dek, context);
    return { dek, wrappedDek: wrapped.wrappedDek, keyVersion: wrapped.keyVersion };
  } catch (err) {
    dek.fill(0);
    throw new Cmp032Error('SF-SYS-004', { details: [{ code: 'KMS_UNAVAILABLE' }], cause: err });
  }
}
