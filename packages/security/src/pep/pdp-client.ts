import { randomUUID } from 'node:crypto';
import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
} from '@serviceform/contracts';
import { CircuitBreaker } from './circuit-breaker.js';

export interface PdpClient {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export type PdpFailureKind =
  | 'PDP_UNAVAILABLE'
  | 'PDP_TIMEOUT'
  | 'PDP_ERROR'
  | 'POLICY_UNDEFINED'
  | 'PDP_INVALID_RESPONSE'
  | 'CIRCUIT_OPEN';

const MAX_BODY = 65_536;

export function assertOpaUrl(raw: string): URL {
  if (!raw) throw new Error('SF_OPA_URL is empty');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('SF_OPA_URL is not a URL');
  }
  if (url.username || url.password) throw new Error('SF_OPA_URL must not contain userinfo');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SF_OPA_URL scheme must be http or https');
  }
  return url;
}

function deny(reason: PdpFailureKind): AuthzDecisionOutput {
  return {
    allow: false,
    reason_code: reason,
    policy_revision: 'none',
    decision_id: randomUUID(),
  };
}

export class OpaPdpClient implements PdpClient {
  readonly breaker = new CircuitBreaker();
  private readonly url: URL;
  readonly timeoutMs: number;
  private readonly token: string | undefined;
  readonly expectedRevision: string | undefined;
  lastCalls = 0;

  constructor(opts: {
    opaUrl: string;
    timeoutMs?: number;
    token?: string;
    expectedRevision?: string;
  }) {
    this.url = assertOpaUrl(opts.opaUrl);
    this.timeoutMs = opts.timeoutMs ?? 100;
    this.token = opts.token;
    this.expectedRevision = opts.expectedRevision;
  }

  async decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    if (!this.breaker.tryEnter()) return deny('CIRCUIT_OPEN');
    const endpoint = new URL('/v1/data/sf/authz/decision', this.url);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    this.lastCalls += 1;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BODY) {
        this.breaker.onFailure();
        return deny('PDP_INVALID_RESPONSE');
      }
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        this.breaker.onFailure();
        return deny('PDP_INVALID_RESPONSE');
      }
      if (!res.ok) {
        this.breaker.onFailure();
        return deny(res.status >= 500 ? 'PDP_ERROR' : 'PDP_INVALID_RESPONSE');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(buf));
      } catch {
        this.breaker.onFailure();
        return deny('PDP_INVALID_RESPONSE');
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.breaker.onFailure();
        return deny('PDP_INVALID_RESPONSE');
      }
      const result = (parsed as { result?: unknown }).result;
      if (result === undefined) {
        this.breaker.onFailure();
        return deny('POLICY_UNDEFINED');
      }
      if (result === null || typeof result !== 'object' || Array.isArray(result)) {
        this.breaker.onFailure();
        return deny('PDP_INVALID_RESPONSE');
      }
      const rec = result as Record<string, unknown>;
      const decision_id = randomUUID();
      const candidate = {
        allow: rec.allow,
        reason_code: rec.reason_code,
        policy_revision: rec.policy_revision,
        decision_id,
      };
      const check = validate('authz-decision-output', candidate);
      if (!check.valid || rec.allow !== true) {
        this.breaker.onSuccess();
        return {
          allow: false,
          reason_code:
            typeof rec.reason_code === 'string' && rec.reason_code.length > 0
              ? rec.reason_code
              : 'PDP_INVALID_RESPONSE',
          policy_revision:
            typeof rec.policy_revision === 'string' && rec.policy_revision.length > 0
              ? rec.policy_revision
              : 'none',
          decision_id,
        };
      }
      if (
        this.expectedRevision &&
        typeof rec.policy_revision === 'string' &&
        rec.policy_revision !== this.expectedRevision
      ) {
        this.breaker.onSuccess();
        return deny('PDP_INVALID_RESPONSE');
      }
      this.breaker.onSuccess();
      return candidate as AuthzDecisionOutput;
    } catch (err) {
      this.breaker.onFailure();
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') return deny('PDP_TIMEOUT');
      return deny('PDP_UNAVAILABLE');
    }
  }
}
