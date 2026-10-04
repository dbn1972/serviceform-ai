import { PIN_KEYS, type PinMap } from '../../src/domain/pins.js';

const HASH = `sha256:${'cd'.repeat(32)}`;

export function validPins(suffix = 'v1'): PinMap {
  const pins = {} as PinMap;
  for (const key of PIN_KEYS) {
    pins[key] = { version_ref: `${key}.${suffix}`, content_hash: HASH };
  }
  return pins;
}
