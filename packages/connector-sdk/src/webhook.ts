import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SecretMaterial } from './secrets.js';

export const SIGNATURE_HEADER = 'x-sf-signature';
export const TIMESTAMP_HEADER = 'x-sf-timestamp';
export const DEFAULT_REPLAY_WINDOW_SECONDS = 300;

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return undefined;
  return raw;
}

function asBuffer(body: Uint8Array): Buffer {
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

export function signWebhook(body: Uint8Array, secret: SecretMaterial, timestamp: number): string {
  const hmac = createHmac('sha256', secret.reveal());
  hmac.update(`${timestamp}.`);
  hmac.update(asBuffer(body));
  return hmac.digest('hex');
}

export function verifyWebhookSignature(
  body: Uint8Array,
  headers: Record<string, string | string[] | undefined>,
  secret: SecretMaterial,
  nowSeconds: number,
  windowSeconds = DEFAULT_REPLAY_WINDOW_SECONDS,
): boolean {
  const signature = headerValue(headers, SIGNATURE_HEADER);
  const timestampRaw = headerValue(headers, TIMESTAMP_HEADER);
  if (!signature || !timestampRaw) return false;
  if (!/^[0-9a-f]+$/i.test(signature) || signature.length !== 64) return false;
  const timestamp = Number(timestampRaw);
  if (!Number.isInteger(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > windowSeconds) return false;
  const expected = Buffer.from(signWebhook(body, secret, timestamp), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
