import type pg from 'pg';

/**
 * SF-M10 Phase C live-pins: CMP-051-backed approval ports for the SAMPLE_LAB host.
 * Host composition only — each port reads CMP-051's own pool under FORCE RLS (no cross-component
 * SQL from inside CMP-052/CMP-016). LOCAL/CI only; callers refuse elsewhere.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

export interface Cmp052ApprovalOk {
  ok: true;
  request_id: string;
}

/** Structural subset of CMP-052 `ApprovalPort`. */
export interface Cmp052ApprovalPortLike {
  requireApproved(input: { bindingId: string; proposedHash: string }): Promise<Cmp052ApprovalOk>;
}

/** Structural subset of CMP-016 `ApprovalPort`. */
export interface Cmp016ApprovalPortLike {
  verify(
    ctx: { tenant_id: string },
    request: {
      subject_type: 'WorkflowVersion' | 'WorkflowMigration';
      subject_id: string;
      content_hash: string;
      approval_ref: string;
    },
  ): Promise<{ approved: boolean; approver_id: string }>;
}

interface ApprovedRequest {
  request_id: string;
  subject_id: string;
  proposed_hash: string;
  checker_principal_id: string | null;
}

async function readApproved(
  pool: pg.Pool,
  tenantId: string,
  requestId: string,
): Promise<ApprovedRequest | null> {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(requestId)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const res = await client.query<ApprovedRequest>(
      `SELECT request_id, subject_id, proposed_hash, checker_principal_id
         FROM sf_maker_checker.publication_request
        WHERE tenant_id = $1 AND request_id = $2 AND status = 'APPROVED'`,
      [tenantId, requestId],
    );
    await client.query('COMMIT');
    return res.rows[0] ?? null;
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    return null;
  } finally {
    client.release();
  }
}

async function readApprovedForBinding(
  pool: pg.Pool,
  tenantId: string,
  bindingId: string,
  proposedHash: string,
): Promise<ApprovedRequest | null> {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(bindingId) || !HASH_RE.test(proposedHash)) {
    return null;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const res = await client.query<ApprovedRequest>(
      `SELECT request_id, subject_id, proposed_hash, checker_principal_id
         FROM sf_maker_checker.publication_request
        WHERE tenant_id = $1
          AND subject_type = 'TENANT_SERVICE_BINDING'
          AND subject_id = $2
          AND proposed_hash = $3
          AND status = 'APPROVED'
        ORDER BY decided_at DESC NULLS LAST
        LIMIT 1`,
      [tenantId, bindingId, proposedHash],
    );
    await client.query('COMMIT');
    return res.rows[0] ?? null;
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    return null;
  } finally {
    client.release();
  }
}

type BindingPinMap = Record<string, { version_ref?: string; content_hash?: string }>;

async function readBindingPins(
  pool: pg.Pool,
  tenantId: string,
  bindingId: string,
): Promise<BindingPinMap | null> {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(bindingId)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const res = await client.query<{ pins: BindingPinMap }>(
      `SELECT pins
         FROM sf_versioning.tenant_service_binding
        WHERE tenant_id = $1 AND binding_id = $2`,
      [tenantId, bindingId],
    );
    await client.query('COMMIT');
    return res.rows[0]?.pins ?? null;
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    return null;
  } finally {
    client.release();
  }
}

/**
 * CMP-052 ApprovalPort: publish only when CMP-051 has an APPROVED publication request for this
 * binding id and artifact hash. Replaces `SimulatedApprovalPort(allow=true)`.
 */
export class Cmp051ApprovalPort implements Cmp052ApprovalPortLike {
  constructor(
    private readonly deps: {
      pool: pg.Pool;
      /** Tenant is not on the CMP-052 port input; the host binds the placement tenant. */
      tenantId: string;
      refuse: (code: string) => Error;
    },
  ) {}

  async requireApproved(input: {
    bindingId: string;
    proposedHash: string;
  }): Promise<Cmp052ApprovalOk> {
    const row = await readApprovedForBinding(
      this.deps.pool,
      this.deps.tenantId,
      input.bindingId,
      input.proposedHash,
    );
    if (!row || !row.checker_principal_id) {
      throw this.deps.refuse('CHECKER_APPROVAL_REQUIRED');
    }
    return { ok: true, request_id: row.request_id };
  }
}

/**
 * CMP-016 ApprovalPort: `approval_ref` is a CMP-051 publication request id. The request must be
 * APPROVED, and the subject binding's workflow pin must match the version id and graph hash being
 * published. That ties CMP-016 publication to the same maker-checker decision that advances the TSB.
 */
export class Cmp051WorkflowApprovalPort implements Cmp016ApprovalPortLike {
  constructor(
    private readonly deps: {
      cmp051: pg.Pool;
      /** CMP-052 pool — read the DRAFT/PUBLISHED binding pins for the approved request subject. */
      cmp052: pg.Pool;
    },
  ) {}

  async verify(
    ctx: { tenant_id: string },
    request: {
      subject_type: 'WorkflowVersion' | 'WorkflowMigration';
      subject_id: string;
      content_hash: string;
      approval_ref: string;
    },
  ): Promise<{ approved: boolean; approver_id: string }> {
    if (request.subject_type !== 'WorkflowVersion') {
      return { approved: false, approver_id: '' };
    }
    const row = await readApproved(this.deps.cmp051, ctx.tenant_id, request.approval_ref);
    if (!row?.checker_principal_id) return { approved: false, approver_id: '' };
    const pins = await readBindingPins(this.deps.cmp052, ctx.tenant_id, row.subject_id);
    const workflow = pins?.['workflow'];
    const match =
      workflow?.version_ref === request.subject_id &&
      workflow?.content_hash === request.content_hash;
    return {
      approved: Boolean(match),
      approver_id: match ? row.checker_principal_id : '',
    };
  }
}
