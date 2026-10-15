import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** base64url(32 bytes) is always 43 chars; charset walk avoids regex DoS scanners. */
const HANDOFF_TOKEN_LEN = 43;
const HANDOFF_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function isHandoffChar(ch: string): boolean {
  return HANDOFF_CHARS.includes(ch);
}

export function isHandoffTokenShape(token: string): boolean {
  if (token.length !== HANDOFF_TOKEN_LEN) return false;
  for (let i = 0; i < token.length; i += 1) {
    if (!isHandoffChar(token.charAt(i))) return false;
  }
  return true;
}

export function isTokenHashShape(hash: string): boolean {
  if (!hash.startsWith('sha256:') || hash.length !== 7 + 64) return false;
  for (let i = 7; i < hash.length; i += 1) {
    const c = hash.charCodeAt(i);
    const isHex = (c >= 48 && c <= 57) || (c >= 97 && c <= 102);
    if (!isHex) return false;
  }
  return true;
}

/** @deprecated use isHandoffTokenShape — call-site compatibility during Wave A. */
export const HANDOFF_TOKEN = {
  test: isHandoffTokenShape,
};

/** @deprecated use isTokenHashShape */
export const TOKEN_HASH = {
  test: isTokenHashShape,
};

export function hashHandoffToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

/** The plaintext token leaves CMP-057 exactly once; only its hash is stored. */
export function issueHandoffToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashHandoffToken(token) };
}

export function handoffTokenMatches(token: string, storedHash: string | null): boolean {
  if (storedHash === null || !isHandoffTokenShape(token)) return false;
  const a = Buffer.from(hashHandoffToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
