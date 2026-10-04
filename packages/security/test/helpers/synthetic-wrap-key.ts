/**
 * Clearly synthetic 32-byte AES-256 wrap key for local/CI tests.
 * Repeated character, not a credential, token, or production secret.
 */
export const SYNTHETIC_WRAP_KEY = 'x'.repeat(32);
