import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SimulationMarker } from '@serviceform/contracts';
import { StoragePortError } from './errors.js';
import type { PresignedAccess, StorageSecretsPort } from './ports.js';

export async function createSimulatedPresign(input: {
  secrets: StorageSecretsPort;
  secretName: string;
  objectId: string;
  objectKey: string;
  expiresAt: Date;
  simulation?: SimulationMarker;
}): Promise<PresignedAccess> {
  let key: Uint8Array;
  try {
    key = await input.secrets.getHmacKey(input.secretName);
  } catch (err) {
    throw new StoragePortError('SECRET_UNAVAILABLE', 'presign secret unavailable', { cause: err });
  }
  const exp = Math.floor(input.expiresAt.getTime() / 1000);
  const payload = `${input.objectId}:${input.objectKey}:${exp}`;
  const token = createHmac('sha256', Buffer.from(key)).update(payload).digest('hex');
  const url = `sim://storage/${input.objectId}?key=${encodeURIComponent(input.objectKey)}&exp=${exp}&sig=${token}`;
  const out: PresignedAccess = {
    url,
    expiresAt: input.expiresAt.toISOString(),
    method: 'GET',
  };
  if (input.simulation) out.simulation = input.simulation;
  return out;
}

export async function verifySimulatedPresign(input: {
  secrets: StorageSecretsPort;
  secretName: string;
  objectId: string;
  objectKey: string;
  exp: number;
  sig: string;
  now?: Date;
}): Promise<boolean> {
  if ((input.now ?? new Date()).getTime() / 1000 > input.exp) return false;
  let key: Uint8Array;
  try {
    key = await input.secrets.getHmacKey(input.secretName);
  } catch {
    return false;
  }
  const payload = `${input.objectId}:${input.objectKey}:${input.exp}`;
  const expected = createHmac('sha256', Buffer.from(key)).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(input.sig));
  } catch {
    return false;
  }
}
