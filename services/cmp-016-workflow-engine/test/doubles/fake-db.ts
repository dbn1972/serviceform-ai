import type { SqlClient, SqlPool, SqlPoolClient, SqlResult } from '../../src/index.js';

type Row = Record<string, unknown>;

function pgError(message: string, code: string): Error {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/**
 * Scripted in-memory stand-in for the sf_workflow schema (unit tests only). It emulates
 * tenant scoping from the transaction-local app.tenant_id and records BEGIN/COMMIT/ROLLBACK
 * plus every statement in a shared log, so tests can assert "domain commit before Temporal".
 * Real RLS, grants and triggers are proven by the PostgreSQL integration suite.
 */
export class FakeDb implements SqlPool {
  readonly log: string[];
  readonly statements: string[] = [];
  definitions: Row[] = [];
  versions: Row[] = [];
  instances: Row[] = [];
  requests: Row[] = [];
  plans: Row[] = [];
  outbox: Row[] = [];
  inbox: Row[] = [];
  connects = 0;
  failOn?: RegExp;

  constructor(log: string[] = []) {
    this.log = log;
  }

  async connect(): Promise<SqlPoolClient> {
    this.connects += 1;
    let tenant: string | undefined;
    let snapshot: string | undefined;
    const tables = [
      'definitions',
      'versions',
      'instances',
      'requests',
      'plans',
      'outbox',
      'inbox',
    ] as const;
    const save = () => JSON.stringify(tables.map((t) => this[t]));
    const restore = (s: string) => {
      const parsed = JSON.parse(s) as Row[][];
      tables.forEach((t, i) => {
        this[t] = parsed[i] as Row[];
      });
    };
    const scoped = (rows: Row[]) => rows.filter((r) => r['tenant_id'] === tenant);
    const result = (rows: Row[], rowCount = rows.length): SqlResult<never> => ({
      rows: rows as never[],
      rowCount,
    });

    const client: SqlClient & { release(): void } = {
      release: () => undefined,
      query: async (text: string, params: unknown[] = []) => {
        const sql = text.replace(/\s+/g, ' ').trim();
        this.statements.push(sql);
        if (this.failOn?.test(sql)) throw pgError('injected failure', '40001');
        const p = params as string[];
        if (sql === 'BEGIN') {
          this.log.push('BEGIN');
          snapshot = save();
          return result([]);
        }
        if (sql === 'COMMIT') {
          this.log.push('COMMIT');
          return result([]);
        }
        if (sql === 'ROLLBACK') {
          this.log.push('ROLLBACK');
          if (snapshot) restore(snapshot);
          return result([]);
        }
        if (sql.startsWith('SELECT set_config')) {
          if (p[0] === 'app.tenant_id') tenant = p[1];
          return result([]);
        }
        if (sql.startsWith('INSERT INTO sf_workflow.workflow_definition')) {
          if (
            this.definitions.some((d) => d['tenant_id'] === p[1] && d['definition_key'] === p[3])
          ) {
            throw pgError('dup', '23505');
          }
          this.definitions.push({ definition_id: p[0], tenant_id: p[1], definition_key: p[3] });
          return result([], 1);
        }
        if (sql.startsWith('SELECT 1 FROM sf_workflow.workflow_definition')) {
          return result(scoped(this.definitions).filter((d) => d['definition_id'] === p[0]));
        }
        if (sql.startsWith('SELECT COALESCE(MAX(version_no)')) {
          const nos = scoped(this.versions)
            .filter((v) => v['definition_id'] === p[0])
            .map((v) => v['version_no'] as number);
          return result([{ n: Math.max(0, ...nos) + 1 }]);
        }
        if (sql.startsWith('INSERT INTO sf_workflow.workflow_version')) {
          this.versions.push({
            version_id: p[0],
            tenant_id: p[1],
            definition_id: p[2],
            version_no: p[3],
            status: p[4],
            origin: p[5],
            model: JSON.parse(p[6] as string),
            authored_by: p[8],
            published_by: null,
            publication_approval_ref: null,
            published_at: null,
            retired_at: null,
          });
          return result([], 1);
        }
        if (sql.startsWith('SELECT tenant_id, definition_id, version_id')) {
          return result(scoped(this.versions).filter((v) => v['version_id'] === p[0]));
        }
        if (sql.startsWith('UPDATE sf_workflow.workflow_version SET model')) {
          const v = scoped(this.versions).find(
            (x) => x['version_id'] === p[0] && x['status'] === 'DRAFT',
          );
          if (v) v['model'] = JSON.parse(p[1] as string);
          return result([], v ? 1 : 0);
        }
        if (sql.startsWith("UPDATE sf_workflow.workflow_version SET status = 'PUBLISHED'")) {
          const v = scoped(this.versions).find(
            (x) => x['version_id'] === p[0] && x['status'] === 'DRAFT',
          );
          if (v) {
            v['status'] = 'PUBLISHED';
            v['model'] = JSON.parse(p[1] as string);
            v['published_by'] = p[3];
            v['publication_approval_ref'] = p[4];
            v['published_at'] = p[5];
          }
          return result([], v ? 1 : 0);
        }
        if (sql.startsWith("UPDATE sf_workflow.workflow_version SET status = 'RETIRED'")) {
          const v = scoped(this.versions).find(
            (x) => x['version_id'] === p[0] && x['status'] === 'PUBLISHED',
          );
          if (v) {
            v['status'] = 'RETIRED';
            v['retired_at'] = p[1];
          }
          return result([], v ? 1 : 0);
        }
        if (sql.startsWith('INSERT INTO sf_workflow.migration_plan')) {
          this.plans.push({
            migration_id: p[0],
            tenant_id: p[1],
            from_version_id: p[2],
            to_version_id: p[3],
            node_mapping: JSON.parse(p[4] as string),
            approval_ref: p[5],
            simulation_evidence_ref: p[6],
            requested_by: p[7],
            approved_by: p[8],
          });
          return result([], 1);
        }
        if (sql.includes('FROM sf_workflow.migration_plan')) {
          return result(scoped(this.plans).filter((x) => x['migration_id'] === p[0]));
        }
        if (sql.startsWith('INSERT INTO sf_workflow.workflow_instance')) {
          if (this.instances.some((i) => i['tenant_id'] === p[1] && i['application_id'] === p[3])) {
            throw pgError('dup', '23505');
          }
          this.instances.push({
            instance_id: p[0],
            tenant_id: p[1],
            application_id: p[3],
            workflow_version_id: p[4],
            graph_hash: p[5],
            temporal_workflow_id: p[6],
            status: p[7],
            active_nodes: JSON.parse(p[8] as string),
            last_signal_id: null,
            migration_id: null,
          });
          return result([], 1);
        }
        if (sql.startsWith('SELECT instance_id')) {
          return result(scoped(this.instances).filter((i) => i['application_id'] === p[0]));
        }
        if (sql.startsWith('UPDATE sf_workflow.workflow_instance SET status')) {
          const i = scoped(this.instances).find((x) => x['instance_id'] === p[0]);
          if (i) {
            i['status'] = p[1];
            i['active_nodes'] = JSON.parse(p[2] as string);
            i['last_signal_id'] = p[3];
          }
          return result([], i ? 1 : 0);
        }
        if (sql.startsWith('UPDATE sf_workflow.workflow_instance SET workflow_version_id')) {
          const i = scoped(this.instances).find((x) => x['instance_id'] === p[0]);
          if (i) {
            i['workflow_version_id'] = p[1];
            i['graph_hash'] = p[2];
            i['migration_id'] = p[3];
          }
          return result([], i ? 1 : 0);
        }
        if (sql.startsWith('INSERT INTO sf_workflow.workflow_request')) {
          this.requests.push({
            request_id: p[0],
            tenant_id: p[1],
            instance_id: p[2],
            application_id: p[3],
            request_kind: p[4],
            request_node_id: p[5],
            outcome: p[6],
            status: p[7],
            requested_by: p[8],
            idempotency_key: p[9],
          });
          return result([], 1);
        }
        if (sql.startsWith('SELECT request_id')) {
          return result(
            scoped(this.requests).filter(
              (r) => r['application_id'] === p[0] && r['idempotency_key'] === p[1],
            ),
          );
        }
        if (sql.startsWith('INSERT INTO sf_workflow.inbox_event')) {
          if (this.inbox.some((r) => r['consumer_group'] === p[0] && r['event_id'] === p[1]))
            return result([], 0);
          this.inbox.push({ consumer_group: p[0], event_id: p[1], tenant_id: p[2] });
          return result([], 1);
        }
        if (sql.startsWith('INSERT INTO sf_workflow.outbox_event')) {
          if (p[1] !== tenant) throw pgError('rls', '42501');
          this.outbox.push({
            event_id: p[0],
            tenant_id: p[1],
            topic: p[2],
            event_type: p[4],
            envelope: JSON.parse(p[9] as string),
          });
          this.log.push(`OUTBOX:${p[4] as string}`);
          return result([], 1);
        }
        throw new Error(`FakeDb: unscripted SQL: ${sql.slice(0, 80)}`);
      },
    };
    return client;
  }
}

/** Pool that proves a code path never reaches the database. */
export class UnreachablePool implements SqlPool {
  connects = 0;
  async connect(): Promise<SqlPoolClient> {
    this.connects += 1;
    throw new Error('database must not be reached on this path');
  }
}
