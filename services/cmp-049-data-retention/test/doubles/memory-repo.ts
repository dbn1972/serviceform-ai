import { PERIOD_GATED_TARGETS } from '../../src/domain/eligibility.js';
import type { RetentionPolicyRecord } from '../../src/domain/policy.js';
import { Cmp049Error } from '../../src/errors.js';
import type {
  RetentionRepository,
  RetentionSubjectRecord,
  RetentionTx,
  StoredIdempotent,
  TransitionLogRow,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  policies: Map<string, RetentionPolicyRecord>;
  subjects: Map<string, RetentionSubjectRecord>;
  transitions: TransitionLogRow[];
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return {
    policies: new Map(),
    subjects: new Map(),
    transitions: [],
    idempotency: new Map(),
    outbox: [],
  };
}

/**
 * In-memory tenant-partitioned repository with all-or-nothing transactions. It mirrors the
 * database guards that matter to the service (one-time period binding, version steps and the
 * transition-log period CHECK) so unit tests cannot pass on behaviour the database would refuse.
 */
export class MemoryRetentionRepository implements RetentionRepository {
  private readonly stores = new Map<string, TenantStore>();
  private depth = 0;
  failNextCommit = false;
  txCount = 0;

  tenant(tenantId: string): TenantStore {
    let s = this.stores.get(tenantId);
    if (!s) {
      s = emptyStore();
      this.stores.set(tenantId, s);
    }
    return s;
  }

  inTransaction(): boolean {
    return this.depth > 0;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: RetentionTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp049Error('SF-TEN-001');
    if (this.depth > 0)
      throw new Cmp049Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    const store = this.tenant(ctx.tenant_id);
    const backup = structuredClone(store);
    this.depth += 1;
    this.txCount += 1;
    try {
      const result = await fn(new MemoryTx(store));
      if (this.failNextCommit) {
        this.failNextCommit = false;
        throw new Error('commit failed');
      }
      return result;
    } catch (err) {
      Object.assign(store, backup);
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

class MemoryTx implements RetentionTx {
  constructor(private readonly s: TenantStore) {}

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const id = `${p.principalId}|${p.endpoint}|${p.key}`;
    const existing = this.s.idempotency.get(id);
    if (!existing) {
      this.s.idempotency.set(id, { fingerprint: p.fingerprint, status: 'IN_PROGRESS' });
      return Promise.resolve('claimed');
    }
    if (existing.fingerprint !== p.fingerprint) throw new Cmp049Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(structuredClone(existing.response));
    }
    throw new Cmp049Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const row = this.s.idempotency.get(`${p.principalId}|${p.endpoint}|${p.key}`);
    if (row) {
      row.status = 'COMPLETED';
      row.response = structuredClone({ status: p.status, body: p.body });
    }
    return Promise.resolve();
  }

  insertPolicy(row: RetentionPolicyRecord): Promise<void> {
    if (this.s.policies.has(row.policy_id) || row.policy_version !== 1) {
      throw new Cmp049Error('SF-APP-002');
    }
    this.s.policies.set(row.policy_id, structuredClone(row));
    return Promise.resolve();
  }

  getPolicy(policyId: string): Promise<RetentionPolicyRecord | undefined> {
    const row = this.s.policies.get(policyId);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  bindPolicyPeriodRef(row: RetentionPolicyRecord): Promise<void> {
    const old = this.s.policies.get(row.policy_id);
    if (
      !old ||
      old.owner_supplied_period_ref !== null ||
      row.owner_supplied_period_ref === null ||
      row.policy_version !== old.policy_version + 1
    ) {
      throw new Cmp049Error('SF-APP-001');
    }
    this.s.policies.set(row.policy_id, {
      ...old,
      owner_supplied_period_ref: row.owner_supplied_period_ref,
      policy_version: row.policy_version,
      updated_at: row.updated_at,
      last_correlation_id: row.last_correlation_id,
    });
    return Promise.resolve();
  }

  insertSubject(row: RetentionSubjectRecord): Promise<void> {
    const dup = [...this.s.subjects.values()].some(
      (s) => s.resource_type === row.resource_type && s.resource_id === row.resource_id,
    );
    if (dup || row.eligibility !== 'ACTIVE' || row.subject_version !== 1) {
      throw new Cmp049Error('SF-APP-002');
    }
    this.s.subjects.set(row.subject_id, structuredClone(row));
    return Promise.resolve();
  }

  getSubject(subjectId: string): Promise<RetentionSubjectRecord | undefined> {
    const row = this.s.subjects.get(subjectId);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  findSubjectByResource(
    resourceType: string,
    resourceId: string,
  ): Promise<RetentionSubjectRecord | undefined> {
    const row = [...this.s.subjects.values()].find(
      (s) => s.resource_type === resourceType && s.resource_id === resourceId,
    );
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  updateSubjectEligibility(row: RetentionSubjectRecord): Promise<void> {
    const old = this.s.subjects.get(row.subject_id);
    if (!old || row.subject_version !== old.subject_version + 1) {
      throw new Cmp049Error('SF-APP-001');
    }
    const policy = this.s.policies.get(old.policy_id);
    if (PERIOD_GATED_TARGETS.has(row.eligibility) && !policy?.owner_supplied_period_ref) {
      throw new Cmp049Error('SF-APP-001');
    }
    this.s.subjects.set(row.subject_id, structuredClone(row));
    return Promise.resolve();
  }

  insertTransition(row: TransitionLogRow): Promise<void> {
    if (PERIOD_GATED_TARGETS.has(row.to_eligibility) && row.owner_supplied_period_ref === null) {
      throw new Cmp049Error('SF-SYS-003');
    }
    this.s.transitions.push(structuredClone(row));
    return Promise.resolve();
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
