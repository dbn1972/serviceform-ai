import { ACTIONS, authorizeAction } from './authz.js';
import { assertPortAllowed, loadConfig, type Cmp035Config } from './config.js';
import { requireTenantContext } from './context.js';
import { Cmp035Error, detail } from './errors.js';
import { buildSearchDocument, isSearchDocument, type SearchDocument } from './domain/document.js';
import { parseSearchQuery } from './domain/query.js';
import { isUuid, type TenantRequestContext } from './domain/validate.js';
import type { AuthorizationPort } from './ports/authorization.js';
import type { DbSession, SearchDocumentRow, SearchStore } from './store/types.js';
import { guardOutboundPort, runInDomainTransaction } from './tx-scope.js';

export interface ServiceResult {
  status: number;
  body: unknown;
}

export interface SearchHit {
  document: SearchDocument;
  source: {
    aggregate_type: string;
    version: number;
    event_id: string;
    event_type: string;
    occurred_at: string;
  };
  projection: { rule_id: string; rule_version: number };
  revision: number;
  indexed_at: string;
  updated_at: string;
}

export interface SearchServiceDeps {
  store: SearchStore;
  authorizer: AuthorizationPort;
  config?: Cmp035Config;
  clock?: () => Date;
}

function sessionOf(ctx: TenantRequestContext): DbSession {
  return {
    tenantId: ctx.tenant_id,
    cellId: ctx.cell_id,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    correlationId: ctx.correlation_id,
  };
}

/** Defence in depth on top of FORCE RLS and the explicit tenant predicate. */
function assertSameTenant(ctx: TenantRequestContext, rows: readonly SearchDocumentRow[]): void {
  if (rows.some((r) => r.tenant_id !== ctx.tenant_id)) {
    throw new Cmp035Error('SF-TEN-002', { details: detail('CROSS_TENANT_RESULT_BLOCKED') });
  }
}

export function hitOf(row: SearchDocumentRow): SearchHit {
  const document = buildSearchDocument({
    tenantId: row.tenant_id,
    documentId: row.document_id,
    sourceCmpId: row.source_cmp_id,
    sourceRecordId: row.source_record_id,
    facets: row.facets,
  });
  if (!isSearchDocument(document)) {
    throw new Cmp035Error('SF-SYS-001', { details: detail('INVALID_SEARCH_DOCUMENT') });
  }
  return {
    document,
    source: {
      aggregate_type: row.source_aggregate_type,
      version: row.source_version,
      event_id: row.source_event_id,
      event_type: row.source_event_type,
      occurred_at: row.source_occurred_at,
    },
    projection: { rule_id: row.projection_rule_id, rule_version: row.projection_rule_version },
    revision: row.revision,
    indexed_at: row.indexed_at,
    updated_at: row.updated_at,
  };
}

/** Tenant-scoped read side of CMP-035. Results are projections, never authoritative records. */
export class SearchQueryService {
  private readonly store: SearchStore;
  private readonly authorizer: AuthorizationPort;
  private readonly clock: () => Date;

  constructor(deps: SearchServiceDeps) {
    const config = deps.config ?? loadConfig();
    assertPortAllowed(deps.authorizer, config.environment, 'AUTHORIZATION');
    this.store = deps.store;
    this.authorizer = guardOutboundPort('authorization', deps.authorizer);
    this.clock = deps.clock ?? (() => new Date());
  }

  async query(rawCtx: unknown, body: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const q = parseSearchQuery(body);
    await authorizeAction(this.authorizer, ctx, ACTIONS.query, this.clock());
    const rows = await this.store.withTx(sessionOf(ctx), (tx) =>
      runInDomainTransaction(() =>
        tx.queryDocuments({
          sourceCmpId: q.sourceCmpId,
          facets: q.facets,
          limit: q.limit + 1,
          after: q.after,
        }),
      ),
    );
    assertSameTenant(ctx, rows);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      status: 200,
      body: {
        hits: page.map(hitOf),
        next_cursor: rows.length > q.limit && last ? last.document_id : null,
      },
    };
  }

  async getDocument(rawCtx: unknown, documentId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    if (!isUuid(documentId)) {
      throw new Cmp035Error('SF-SYS-003', { details: detail('INVALID_ID', '/document_id') });
    }
    await authorizeAction(this.authorizer, ctx, ACTIONS.read, this.clock());
    const row = await this.store.withTx(sessionOf(ctx), (tx) =>
      runInDomainTransaction(() => tx.getDocument(documentId.toLowerCase())),
    );
    if (!row || row.status !== 'ACTIVE') throw new Cmp035Error('SF-SYS-002');
    assertSameTenant(ctx, [row]);
    return { status: 200, body: { hit: hitOf(row) } };
  }
}
