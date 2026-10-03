import { AuditError } from './errors.js';

export interface AuditQuery {
  from: Date;
  to: Date;
  actor_id?: string;
  action?: string;
  action_class?: string;
  resource_type?: string;
  resource_id?: string;
  result?: string;
  correlation_id?: string;
  limit: number;
  cursor?: { recorded_at: string; chain_seq: number };
}

function parseDate(value: string, label: string): Date {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'INVALID_RANGE', message: `${label} is not a timestamp` }],
    });
  }
  return new Date(ms);
}

export function parseAuditQuery(
  q: Record<string, unknown>,
  maxDays: number,
  maxLimit: number,
): AuditQuery {
  const fromRaw = q['from'];
  const toRaw = q['to'];
  if (typeof fromRaw !== 'string' || typeof toRaw !== 'string') {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'INVALID_RANGE', message: 'from and to are required' }],
    });
  }
  const from = parseDate(fromRaw, 'from');
  const to = parseDate(toRaw, 'to');
  if (from.getTime() > to.getTime()) {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'INVALID_RANGE', message: 'from must be <= to' }],
    });
  }
  if (to.getTime() - from.getTime() > maxDays * 24 * 60 * 60 * 1000) {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'INVALID_RANGE', message: `range exceeds ${String(maxDays)} days` }],
    });
  }
  let limit = 50;
  if (q['limit'] !== undefined) {
    const n = Number(q['limit']);
    if (!Number.isInteger(n) || n < 1 || n > maxLimit) {
      throw new AuditError('SF-SYS-003', {
        details: [{ code: 'INVALID_LIMIT', message: `limit must be 1..${String(maxLimit)}` }],
      });
    }
    limit = n;
  }
  const out: AuditQuery = { from, to, limit };
  if (typeof q['actor_id'] === 'string') out.actor_id = q['actor_id'];
  if (typeof q['action'] === 'string') {
    if (/['\\]/.test(q['action']) || q['action'].includes('%') || q['action'].includes('_')) {
      throw new AuditError('SF-SYS-003', {
        details: [{ code: 'INVALID_FILTER', pointer: '/action' }],
      });
    }
    out.action = q['action'];
  }
  if (typeof q['action_class'] === 'string') out.action_class = q['action_class'];
  if (typeof q['resource_type'] === 'string') {
    if (!/^[A-Z][A-Za-z0-9]{1,63}$/.test(q['resource_type'])) {
      throw new AuditError('SF-SYS-003', {
        details: [{ code: 'INVALID_FILTER', pointer: '/resource_type' }],
      });
    }
    out.resource_type = q['resource_type'];
  }
  if (typeof q['resource_id'] === 'string') out.resource_id = q['resource_id'];
  if (typeof q['result'] === 'string') out.result = q['result'];
  if (typeof q['correlation_id'] === 'string') out.correlation_id = q['correlation_id'];
  if (typeof q['cursor'] === 'string') {
    out.cursor = decodeCursor(q['cursor']);
  }
  return out;
}

export function encodeCursor(recordedAt: string, chainSeq: number): string {
  return Buffer.from(JSON.stringify({ t: recordedAt, s: chainSeq }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): { recorded_at: string; chain_seq: number } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      t?: unknown;
      s?: unknown;
    };
    if (typeof parsed.t !== 'string' || typeof parsed.s !== 'number') {
      throw new Error('bad');
    }
    return { recorded_at: parsed.t, chain_seq: parsed.s };
  } catch {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'INVALID_CURSOR' }],
    });
  }
}
