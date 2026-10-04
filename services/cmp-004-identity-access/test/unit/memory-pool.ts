import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

interface Citizen {
  citizen_id: string;
  channel_hash: string;
  status: string;
}
interface Challenge {
  challenge_id: string;
  citizen_id: string;
  channel_hash: string;
  purpose: string;
  code_hash: string;
  status: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  simulation: unknown;
}
interface CitizenSession {
  session_id: string;
  citizen_id: string;
  token_hash: string;
  status: string;
  assurance: string;
  expires_at: Date;
  revoked_at: Date | null;
}
interface Lookup {
  token_hash: string;
  session_id: string;
  actor_type: string;
  subject_id: string;
  tenant_id: string | null;
  assurance: string;
  status: string;
  expires_at: Date;
}
interface Link {
  link_id: string;
  citizen_id: string;
  method: string;
  subject_hash: string;
  status: string;
}
interface Officer {
  tenant_id: string;
  officer_id: string;
  idp_subject_hash: string;
  status: string;
}
interface OfficerSession {
  tenant_id: string;
  session_id: string;
  officer_id: string;
  token_hash: string;
  status: string;
  assurance: string;
  role_codes: string[];
  expires_at: Date;
}
interface Idem {
  tenant_id: string | null;
  principal_id: string;
  endpoint: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
}
interface Outbox {
  envelope: unknown;
}

export interface MemoryIdentityStore {
  citizens: Citizen[];
  challenges: Challenge[];
  citizenSessions: CitizenSession[];
  lookups: Lookup[];
  links: Link[];
  recoveries: { recovery_id: string; citizen_id: string; challenge_id: string }[];
  officers: Officer[];
  officerSessions: OfficerSession[];
  idem: Idem[];
  outbox: Outbox[];
  tenant: string | null;
}

export function emptyIdentityStore(): MemoryIdentityStore {
  return {
    citizens: [],
    challenges: [],
    citizenSessions: [],
    lookups: [],
    links: [],
    recoveries: [],
    officers: [],
    officerSessions: [],
    idem: [],
    outbox: [],
    tenant: null,
  };
}

function result<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function execSql(store: MemoryIdentityStore, sql: string, params: unknown[]): QueryResult {
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('BEGIN') || q.startsWith('COMMIT') || q.startsWith('ROLLBACK')) {
    return result([]);
  }
  if (q.includes('set_config')) {
    const key = String(params[0]);
    if (key === 'app.tenant_id') store.tenant = String(params[1]);
    return result([]);
  }
  if (q.includes('INSERT INTO sf_identity.citizen_principal')) {
    store.citizens.push({
      citizen_id: String(params[0]),
      channel_hash: String(params[1]),
      status: 'ACTIVE',
    });
    return result([], 1);
  }
  if (q.includes('FROM sf_identity.citizen_principal WHERE channel_hash')) {
    const row = store.citizens.find((c) => c.channel_hash === params[0]);
    return result(row ? [{ citizen_id: row.citizen_id, status: row.status }] : []);
  }
  if (q.includes('INSERT INTO sf_identity.citizen_otp_challenge')) {
    store.challenges.push({
      challenge_id: String(params[0]),
      citizen_id: String(params[1]),
      channel_hash: String(params[2]),
      purpose: 'AUTH',
      code_hash: String(params[3]),
      status: 'PENDING',
      attempts: 0,
      max_attempts: Number(params[4]),
      expires_at: new Date(String(params[5])),
      simulation: JSON.parse(String(params[6])),
    });
    return result([], 1);
  }
  if (q.includes('FROM sf_identity.citizen_otp_challenge WHERE challenge_id')) {
    const row = store.challenges.find((c) => c.challenge_id === params[0]);
    return result(row ? [row] : []);
  }
  if (q.includes("UPDATE sf_identity.citizen_otp_challenge SET status = 'EXPIRED'")) {
    const row = store.challenges.find((c) => c.challenge_id === params[0]);
    if (row) row.status = 'EXPIRED';
    return result([], row ? 1 : 0);
  }
  if (q.includes('UPDATE sf_identity.citizen_otp_challenge SET attempts')) {
    const row = store.challenges.find((c) => c.challenge_id === params[2]);
    if (row) {
      row.attempts = Number(params[0]);
      row.status = String(params[1]);
    }
    return result([], row ? 1 : 0);
  }
  if (q.includes("UPDATE sf_identity.citizen_otp_challenge SET status = 'VERIFIED'")) {
    const row = store.challenges.find((c) => c.challenge_id === params[0]);
    if (row) {
      row.status = 'VERIFIED';
      row.attempts += 1;
    }
    return result([], row ? 1 : 0);
  }
  if (q.includes('INSERT INTO sf_identity.citizen_session')) {
    store.citizenSessions.push({
      session_id: String(params[0]),
      citizen_id: String(params[1]),
      token_hash: String(params[2]),
      status: 'ACTIVE',
      assurance: 'OTP',
      expires_at: new Date(String(params[3])),
      revoked_at: null,
    });
    return result([], 1);
  }
  if (q.includes('INSERT INTO sf_identity.session_lookup')) {
    store.lookups.push({
      token_hash: String(params[0]),
      session_id: String(params[1]),
      actor_type: q.includes("'OFFICER'") ? 'OFFICER' : 'CITIZEN',
      subject_id: String(params[2]),
      tenant_id: q.includes("'OFFICER'") ? String(params[3]) : null,
      assurance: q.includes("'OFFICER'") ? String(params[4]) : 'OTP',
      status: 'ACTIVE',
      expires_at: new Date(String(q.includes("'OFFICER'") ? params[5] : params[3])),
    });
    return result([], 1);
  }
  if (q.includes('INSERT INTO sf_identity.identity_link')) {
    const conflict = store.links.some(
      (l) =>
        l.citizen_id === String(params[1]) &&
        l.method === (q.includes('DIGILOCKER') ? 'DIGILOCKER' : 'OTP') &&
        l.subject_hash === String(params[2]),
    );
    if (!conflict) {
      store.links.push({
        link_id: String(params[0]),
        citizen_id: String(params[1]),
        method: q.includes('DIGILOCKER') ? 'DIGILOCKER' : 'OTP',
        subject_hash: String(params[2]),
        status: 'ACTIVE',
      });
    }
    return result([], conflict ? 0 : 1);
  }
  if (q.includes('FROM sf_identity.identity_link WHERE citizen_id')) {
    return result(
      store.links
        .filter((l) => l.citizen_id === params[0] && l.status === 'ACTIVE')
        .map((l) => ({ method: l.method })),
    );
  }
  if (q.includes('INSERT INTO sf_identity.account_recovery')) {
    store.recoveries.push({
      recovery_id: String(params[0]),
      citizen_id: String(params[1]),
      challenge_id: String(params[2]),
    });
    return result([], 1);
  }
  if (q.includes('INSERT INTO sf_identity.officer_principal')) {
    store.officers.push({
      tenant_id: String(params[0]),
      officer_id: String(params[1]),
      idp_subject_hash: String(params[2]),
      status: 'ACTIVE',
    });
    return result([], 1);
  }
  if (q.includes('INSERT INTO sf_identity.officer_session')) {
    store.officerSessions.push({
      tenant_id: String(params[0]),
      session_id: String(params[1]),
      officer_id: String(params[2]),
      token_hash: String(params[3]),
      status: 'ACTIVE',
      assurance: String(params[4]),
      role_codes: params[5] as string[],
      expires_at: new Date(String(params[6])),
    });
    return result([], 1);
  }
  if (q.includes('FROM sf_identity.officer_session')) {
    const rows = store.officerSessions.filter((s) => {
      if (store.tenant && s.tenant_id !== store.tenant) return false;
      if (q.includes('session_id') && params.length >= 2)
        return s.tenant_id === params[0] && s.session_id === params[1];
      return true;
    });
    return result(rows.map((s) => ({ ...s, role_codes: s.role_codes })));
  }
  if (q.includes("UPDATE sf_identity.citizen_session SET status = 'REVOKED'")) {
    for (const s of store.citizenSessions) {
      if (s.citizen_id === params[1] && s.status === 'ACTIVE') s.status = 'REVOKED';
    }
    return result([], 1);
  }
  if (q.includes("UPDATE sf_identity.session_lookup SET status = 'REVOKED'")) {
    for (const s of store.lookups) {
      if (s.subject_id === params[0] && s.status === 'ACTIVE') {
        if (s.actor_type === 'OFFICER' && params[1] && s.tenant_id !== params[1]) continue;
        s.status = 'REVOKED';
      }
    }
    return result([], 1);
  }
  if (q.includes("UPDATE sf_identity.officer_session SET status = 'REVOKED'")) {
    for (const s of store.officerSessions) {
      if (s.tenant_id === params[1] && s.officer_id === params[2] && s.status === 'ACTIVE')
        s.status = 'REVOKED';
    }
    return result([], 1);
  }
  if (q.includes('FROM sf_identity.session_lookup')) {
    if (q.includes('token_hash')) {
      const row = store.lookups.find((l) => l.token_hash === params[0]);
      return result(row ? [row] : []);
    }
    const row = store.lookups
      .filter(
        (l) => l.subject_id === params[0] && l.actor_type === params[1] && l.status === 'ACTIVE',
      )
      .sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime())[0];
    return result(row ? [row] : []);
  }
  if (q.includes('INSERT INTO sf_identity.idempotency_record_platform')) {
    const exists = store.idem.find(
      (i) =>
        i.principal_id === params[0] && i.endpoint === params[1] && i.idempotency_key === params[2],
    );
    if (exists) return result([], 0);
    store.idem.push({
      tenant_id: null,
      principal_id: String(params[0]),
      endpoint: String(params[1]),
      idempotency_key: String(params[2]),
      request_fingerprint: String(params[3]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return result([], 1);
  }
  if (q.includes('INSERT INTO sf_identity.idempotency_record ')) {
    const exists = store.idem.find(
      (i) =>
        i.tenant_id === params[0] &&
        i.principal_id === params[1] &&
        i.endpoint === params[2] &&
        i.idempotency_key === params[3],
    );
    if (exists) return result([], 0);
    store.idem.push({
      tenant_id: String(params[0]),
      principal_id: String(params[1]),
      endpoint: String(params[2]),
      idempotency_key: String(params[3]),
      request_fingerprint: String(params[4]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return result([], 1);
  }
  if (q.includes('FROM sf_identity.idempotency_record_platform')) {
    const row = store.idem.find(
      (i) =>
        i.principal_id === params[0] && i.endpoint === params[1] && i.idempotency_key === params[2],
    );
    return result(row ? [row] : []);
  }
  if (q.includes('FROM sf_identity.idempotency_record ')) {
    const row = store.idem.find(
      (i) =>
        i.tenant_id === params[0] &&
        i.principal_id === params[1] &&
        i.endpoint === params[2] &&
        i.idempotency_key === params[3],
    );
    return result(row ? [row] : []);
  }
  if (q.includes('UPDATE sf_identity.idempotency_record_platform')) {
    const row = store.idem.find(
      (i) =>
        i.principal_id === params[3] && i.endpoint === params[4] && i.idempotency_key === params[5],
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(params[1]);
      row.response_body = JSON.parse(String(params[2]));
    }
    return result([], 1);
  }
  if (q.includes('UPDATE sf_identity.idempotency_record')) {
    const row = store.idem.find(
      (i) =>
        i.tenant_id === params[3] &&
        i.principal_id === params[4] &&
        i.endpoint === params[5] &&
        i.idempotency_key === params[6],
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(params[1]);
      row.response_body = JSON.parse(String(params[2]));
    }
    return result([], 1);
  }
  if (q.includes('INSERT INTO sf_identity.outbox_event')) {
    store.outbox.push({ envelope: params[params.length - 1] });
    return result([], 1);
  }
  if (q.includes('UPDATE sf_identity.citizen_otp_challenge SET purpose')) {
    return result([], 1);
  }
  throw new Error(`unhandled sql: ${q.slice(0, 180)}`);
}

export function createMemoryIdentityPool(store: MemoryIdentityStore): Pool {
  const client = {
    query: (sql: string, params: unknown[] = []) => Promise.resolve(execSql(store, sql, params)),
    release: () => undefined,
  } as unknown as PoolClient;
  return {
    connect: async () => client,
  } as unknown as Pool;
}
