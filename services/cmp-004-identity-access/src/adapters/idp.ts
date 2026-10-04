import type { AuthAssurance, ConnectorBinding, SimulationMarker } from '@serviceform/contracts';
import { Cmp004Error } from '../errors.js';
import { hmacHex } from '../hashing.js';
import { requireSimulationMarker } from '../bindings.js';

export interface IdpClaims {
  subject: string;
  tenant_id: string;
  officer_id: string;
  roles: string[];
  assurance: AuthAssurance;
  simulation: SimulationMarker;
}

export interface IdpAdapter {
  verifyAssertion(assertion: string, testRunId: string): IdpClaims;
}

const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SimulatedIdpAdapter implements IdpAdapter {
  constructor(
    private readonly binding: ConnectorBinding,
    private readonly pepper: string,
  ) {}

  verifyAssertion(assertion: string, testRunId: string): IdpClaims {
    const parts = assertion.split('.');
    if (parts.length !== 3 || parts[0] !== 'simidp') {
      throw new Cmp004Error('SF-AUTH-001');
    }
    const message = parts[1] ?? '';
    const sig = parts[2] ?? '';
    const expected = hmacHex(this.pepper, message);
    if (sig.length !== expected.length) throw new Cmp004Error('SF-AUTH-001');
    let mismatch = 0;
    for (let i = 0; i < expected.length; i += 1) {
      mismatch |= (sig.charCodeAt(i) ?? 0) ^ (expected.charCodeAt(i) ?? 0);
    }
    if (mismatch !== 0) throw new Cmp004Error('SF-AUTH-001');
    let payload: {
      sub?: string;
      tenant_id?: string;
      officer_id?: string;
      roles?: string[];
      assurance?: AuthAssurance;
      exp?: number;
    };
    try {
      payload = JSON.parse(Buffer.from(message, 'base64url').toString('utf8')) as typeof payload;
    } catch {
      throw new Cmp004Error('SF-AUTH-001');
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tenant_id !== 'string' ||
      typeof payload.officer_id !== 'string' ||
      !UUID_RE.test(payload.tenant_id) ||
      !UUID_RE.test(payload.officer_id) ||
      !Array.isArray(payload.roles) ||
      !payload.roles.every((r) => ROLE_RE.test(r))
    ) {
      throw new Cmp004Error('SF-AUTH-001');
    }
    const exp = payload.exp ?? 0;
    if (exp < Math.floor(Date.now() / 1000)) throw new Cmp004Error('SF-AUTH-001');
    const assurance = payload.assurance === 'MFA' ? 'MFA' : 'PASSWORD';
    const simulation = requireSimulationMarker({
      simulation: true,
      scenario: 'idp_assertion',
      test_run_id: testRunId,
      connector_binding_id: this.binding.connector_binding_id,
      environment: this.binding.environment,
    });
    return {
      subject: payload.sub,
      tenant_id: payload.tenant_id,
      officer_id: payload.officer_id,
      roles: payload.roles,
      assurance,
      simulation,
    };
  }
}

export function mintSimulatedIdpAssertion(
  pepper: string,
  claims: {
    sub: string;
    tenant_id: string;
    officer_id: string;
    roles: string[];
    assurance?: AuthAssurance;
    exp?: number;
  },
): string {
  const payload = {
    sub: claims.sub,
    tenant_id: claims.tenant_id,
    officer_id: claims.officer_id,
    roles: claims.roles,
    assurance: claims.assurance ?? 'MFA',
    exp: claims.exp ?? Math.floor(Date.now() / 1000) + 3600,
  };
  const message = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `simidp.${message}.${hmacHex(pepper, message)}`;
}
