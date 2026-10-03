import type { SecretMaterial } from '../../../packages/connector-sdk/src/index.js';
import { signWebhook } from '../../../packages/connector-sdk/src/index.js';

export function echoSignedHeaders(
  body: Uint8Array,
  secret: SecretMaterial,
  timestamp: number,
): Record<string, string> {
  return {
    'x-sf-signature': signWebhook(body, secret, timestamp),
    'x-sf-timestamp': String(timestamp),
    'x-sf-now': String(timestamp),
    'content-type': 'application/json',
  };
}
