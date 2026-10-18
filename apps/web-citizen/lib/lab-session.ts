/** SAMPLE_LAB citizen session — SIMULATED only; not production IAM. */

export const CITIZEN_LAB_COOKIE = 'sf_citizen_lab_session';

export type CitizenLabSession = {
  surface: 'citizen_web';
  display_name: string;
  mobile: string;
  tenant_label: string;
  simulation: true;
  g6_issued: false;
  created_at: string;
};

export function encodeCitizenSession(session: CitizenLabSession): string {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
}

export function parseCitizenSession(raw: string | undefined): CitizenLabSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CitizenLabSession;
    if (parsed.surface !== 'citizen_web' || parsed.simulation !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function cookieValue(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const parts = header.split(';').map((p) => p.trim());
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

export function setCitizenCookie(token: string, maxAgeSec: number): string {
  const base = `${CITIZEN_LAB_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  return process.env.NODE_ENV === 'production' ? `${base}; Secure` : base;
}
