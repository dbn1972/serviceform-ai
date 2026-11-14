import { describe, expect, it } from 'vitest';
import { Cmp051ApprovalPort, Cmp051WorkflowApprovalPort } from '../src/platform/approvals.js';

const TENANT = '0d15ba00-0001-4000-8000-0d15ba0000d1';
const BINDING = '0d15ba00-0002-4000-8000-0d15ba0000d2';
const REQUEST = '05100000-0000-4000-8000-000000000051';
const CHECKER = '0d15ba00-0f03-4000-8000-0d15ba000f03';
const VERSION = '0d15ba00-0012-4000-8000-0d15ba000012';
const HASH = `sha256:${'a'.repeat(64)}`;

type QueryResult<T> = { rows: T[] };

function pool(handlers: { approved?: QueryResult<unknown>; pins?: QueryResult<unknown> }) {
  const queries: string[] = [];
  return {
    queries,
    pool: {
      connect: async () => ({
        query: async (sql: string, _params?: unknown[]) => {
          queries.push(sql);
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('set_config')) return { rows: [] };
          if (sql.includes('publication_request')) return handlers.approved ?? { rows: [] };
          if (sql.includes('tenant_service_binding')) return handlers.pins ?? { rows: [] };
          return { rows: [] };
        },
        release: () => undefined,
      }),
    } as never,
  };
}

// REQ: Phase C live-pins — CMP-051-backed approval ports (no SimulatedApprovalPort allow=true).
describe('Cmp051ApprovalPort', () => {
  it('requires an APPROVED CMP-051 request for the binding id and artifact hash', async () => {
    const { pool: p } = pool({
      approved: {
        rows: [
          {
            request_id: REQUEST,
            subject_id: BINDING,
            proposed_hash: HASH,
            checker_principal_id: CHECKER,
          },
        ],
      },
    });
    const port = new Cmp051ApprovalPort({
      pool: p,
      tenantId: TENANT,
      refuse: (code) => new Error(code),
    });
    await expect(port.requireApproved({ bindingId: BINDING, proposedHash: HASH })).resolves.toEqual(
      { ok: true, request_id: REQUEST },
    );
  });

  it('refuses when no APPROVED request matches', async () => {
    const { pool: p } = pool({ approved: { rows: [] } });
    const port = new Cmp051ApprovalPort({
      pool: p,
      tenantId: TENANT,
      refuse: (code) => new Error(code),
    });
    await expect(port.requireApproved({ bindingId: BINDING, proposedHash: HASH })).rejects.toThrow(
      'CHECKER_APPROVAL_REQUIRED',
    );
  });
});

describe('Cmp051WorkflowApprovalPort', () => {
  it('approves only when the CMP-051 request pins this workflow version and hash', async () => {
    const { pool: cmp051 } = pool({
      approved: {
        rows: [
          {
            request_id: REQUEST,
            subject_id: BINDING,
            proposed_hash: HASH,
            checker_principal_id: CHECKER,
          },
        ],
      },
    });
    const { pool: cmp052 } = pool({
      pins: {
        rows: [
          {
            pins: {
              workflow: { version_ref: VERSION, content_hash: HASH },
            },
          },
        ],
      },
    });
    const port = new Cmp051WorkflowApprovalPort({ cmp051, cmp052 });
    await expect(
      port.verify(
        { tenant_id: TENANT },
        {
          subject_type: 'WorkflowVersion',
          subject_id: VERSION,
          content_hash: HASH,
          approval_ref: REQUEST,
        },
      ),
    ).resolves.toEqual({ approved: true, approver_id: CHECKER });
  });

  it('rejects a mismatched workflow pin or missing approval', async () => {
    const { pool: cmp051 } = pool({
      approved: {
        rows: [
          {
            request_id: REQUEST,
            subject_id: BINDING,
            proposed_hash: HASH,
            checker_principal_id: CHECKER,
          },
        ],
      },
    });
    const { pool: cmp052 } = pool({
      pins: {
        rows: [
          {
            pins: { workflow: { version_ref: VERSION, content_hash: `sha256:${'b'.repeat(64)}` } },
          },
        ],
      },
    });
    const port = new Cmp051WorkflowApprovalPort({ cmp051, cmp052 });
    await expect(
      port.verify(
        { tenant_id: TENANT },
        {
          subject_type: 'WorkflowVersion',
          subject_id: VERSION,
          content_hash: HASH,
          approval_ref: REQUEST,
        },
      ),
    ).resolves.toEqual({ approved: false, approver_id: '' });
  });
});
