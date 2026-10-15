import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const HANDOFF_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const TOKEN_HASH = /^sha256:[0-9a-f]{64}$/;

export function hashHandoffToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

/** The plaintext token leaves CMP-057 exactly once; only its hash is stored. */
export function issueHandoffToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashHandoffToken(token) };
}

export function handoffTokenMatches(token: string, storedHash: string | null): boolean {
  if (storedHash === null || !HANDOFF_TOKEN.test(token)) return false;
  const a = Buffer.from(hashHandoffToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
