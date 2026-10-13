import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import {
  applicableJurisdictions,
  assertPublishedPin,
  selectAvailable,
  type DiscoveryResultItem,
} from '../domain/availability.js';
import {
  buildDiscoveryQuery,
  isDiscoveryQuery,
  type DiscoveryFilters,
  type DiscoveryQueryContract,
} from '../domain/query.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp006Error, detail, type ErrorCode } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { CatalogueEntry, CataloguePort } from '../ports/catalogue-port.js';
import type { JurisdictionPort, JurisdictionResolution } from '../ports/jurisdiction-port.js';
import type { LocalizationPort } from '../ports/localization-port.js';
import type { SearchCandidate, SearchPort } from '../ports/search-port.js';
import type {
  DiscoveryQueryRecord,
  DiscoveryRepository,
  DiscoveryResultRecord,
  DiscoverySelectionRecord,
  DiscoveryTx,
} from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { DiscoveryQueryInput } from './input.js';

export interface DiscoveryServiceDeps {
  repo: DiscoveryRepository;
  authorizer: AuthorizationPort;
  catalogue: CataloguePort;
  jurisdictions: JurisdictionPort;
  search: SearchPort;
  localization?: LocalizationPort;
  clock: () => Date;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface CommandResult {
  status: number;
  body: unknown;
}

type ActorType = TenantContext['actor']['type'];
/** Discovery is open to citizens and staff; integrations have no discovery surface. */
const QUERY_ACTORS: readonly ActorType[] = ['CITIZEN', 'OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM'];
/** INT-003: only the citizen who ran the query may turn a result into a draft intent. */
const SELECT_ACTORS: readonly ActorType[] = ['CITIZEN'];

export const QUERY_RESOURCE_TYPE = 'DiscoveryQuery';
export const SELECTION_RESOURCE_TYPE = 'DiscoverySelection';

export const ACTIONS = {
  query: 'DISCOVERY_QUERY',
  read: 'DISCOVERY_QUERY_READ',
  select: 'DISCOVERY_SERVICE_SELECT',
} as const;

export type LocalizationStatus = 'NOT_REQUESTED' | 'RESOLVED' | 'UNAVAILABLE';

type PortName = 'CATALOGUE' | 'JURISDICTION' | 'SEARCH' | 'LOCALIZATION';

/** A refusal after authorization that must leave an audit trail even when nothing commits. */
class AuditedRefusal extends Cmp006Error {
  constructor(
    code: ErrorCode,
    readonly reason: string,
    readonly action: string,
    readonly resourceType: string,
    readonly resourceId: string,
  ) {
    super(code, detail(reason));
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function validCandidates(v: unknown): v is SearchCandidate[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c: Partial<SearchCandidate>) =>
        typeof c?.tenant_id === 'string' &&
        typeof c.service_id === 'string' &&
        isUuid(c.service_id),
    )
  );
}

function validEntries(v: unknown): v is CatalogueEntry[] {
  return (
    Array.isArray(v) &&
    v.every(
      (e: Partial<CatalogueEntry>) =>
        typeof e?.tenant_id === 'string' &&
        typeof e.service_id === 'string' &&
        isUuid(e.service_id) &&
        typeof e.catalogue_version_id === 'string' &&
        typeof e.service_code === 'string' &&
        typeof e.service_binding_version_id === 'string' &&
        isUuid(e.service_binding_version_id) &&
        isStringArray(e.jurisdiction_codes),
    )
  );
}

function validResolutions(v: unknown): v is JurisdictionResolution[] {
  return (
    Array.isArray(v) &&
    v.every(
      (r: Partial<JurisdictionResolution>) =>
        typeof r?.code === 'string' &&
        typeof r.active === 'boolean' &&
        isStringArray(r.applicable_codes),
    )
  );
}

export function contractOf(row: DiscoveryQueryRecord, keywords?: string[]): DiscoveryQueryContract {
  const filters: DiscoveryFilters = { jurisdiction_codes: row.jurisdiction_codes };
  if (row.service_codes.length > 0) filters.service_codes = row.service_codes;
  if (keywords && keywords.length > 0) filters.keywords = keywords;
  return buildDiscoveryQuery({
    tenantId: row.tenant_id,
    queryId: row.query_id,
    correlationId: row.correlation_id,
    filters,
    catalogueVersionId: row.catalogue_version_id,
    pagination: { limit: row.pagination_limit, offset: row.pagination_offset },
  });
}

function resultView(
  r: Omit<DiscoveryResultItem, 'label_key'>,
  label: string | null,
): Record<string, unknown> {
  return {
    rank: r.rank,
    service_id: r.service_id,
    service_code: r.service_code,
    category_code: r.category_code,
    service_binding_version_id: r.service_binding_version_id,
    catalogue_version_id: r.catalogue_version_id,
    matched_jurisdiction_codes: r.matched_jurisdiction_codes,
    label,
  };
}

export class ServiceDiscoveryService {
  constructor(private readonly deps: DiscoveryServiceDeps) {}

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp006Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  /** Every port call is a network call: never inside a DB transaction, failures fail closed. */
  private async external<T>(
    port: PortName,
    call: () => Promise<unknown>,
    valid: (v: unknown) => v is T,
  ): Promise<T> {
    this.assertNotInTx();
    let out: unknown;
    try {
      out = await call();
    } catch (err) {
      throw new Cmp006Error('SF-INT-001', { ...detail(`${port}_UNAVAILABLE`), cause: err });
    }
    if (!valid(out)) throw new Cmp006Error('SF-INT-001', detail(`${port}_RESPONSE_INVALID`));
    return out;
  }

  private async guard(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    actors: readonly ActorType[],
  ): Promise<void> {
    this.assertNotInTx();
    if (!actors.includes(ctx.actor.type)) {
      throw new Cmp006Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action, resourceType));
    } catch (err) {
      if (err instanceof Cmp006Error && err.code === 'SF-AUTH-002') {
        await this.auditOutcome(ctx, action, resourceType, resourceId, 'DENIED');
      }
      throw err;
    }
  }

  private async auditOutcome(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    result: 'DENIED' | 'FAILED',
    reason?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action === ACTIONS.select ? 'WRITE' : 'READ',
        resourceType,
        resourceId,
        result,
        ...(reason === undefined ? {} : { reason }),
        now,
      }),
    );
  }

  private async emit(
    tx: DiscoveryTx,
    ctx: TenantContext,
    p: {
      eventType: DomainEventType;
      aggregateType: string;
      aggregateId: string;
      now: Date;
      data: object;
    },
  ): Promise<void> {
    const env = envelopeOf({
      eventType: p.eventType,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: p.aggregateType,
      aggregateId: p.aggregateId,
      aggregateVersion: 1,
      occurredAt: p.now.toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: p.data,
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
  }

  /** Audits a post-authorization refusal as FAILED, then rethrows it unchanged. */
  private async auditedFailure(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    err: unknown,
  ): Promise<never> {
    if (err instanceof Cmp006Error && err.code !== 'SF-SYS-001') {
      const reason =
        err instanceof AuditedRefusal ? err.reason : (err.details?.[0]?.code ?? err.code);
      await this.auditOutcome(ctx, action, resourceType, resourceId, 'FAILED', reason);
    }
    throw err;
  }

  /**
   * Runs a discovery query. All master-data/search lookups happen before the one write
   * transaction, which records only CMP-006's own query log, results, event and audit.
   * Nothing here creates or changes a form, draft or application (INT-003 is citizen-driven).
   */
  async query(ctx: TenantContext, input: DiscoveryQueryInput): Promise<CommandResult> {
    const queryId = randomUUID();
    await this.guard(ctx, ACTIONS.query, QUERY_RESOURCE_TYPE, queryId, QUERY_ACTORS);
    try {
      return await this.runQuery(ctx, queryId, input);
    } catch (err) {
      return this.auditedFailure(ctx, ACTIONS.query, QUERY_RESOURCE_TYPE, queryId, err);
    }
  }

  private async runQuery(
    ctx: TenantContext,
    queryId: string,
    input: DiscoveryQueryInput,
  ): Promise<CommandResult> {
    const tenantId = ctx.tenant_id;
    const pinId = input.catalogue_version_id;
    const { limit, offset } = input.pagination;
    const pin = await this.external(
      'CATALOGUE',
      () => this.deps.catalogue.getVersion({ tenantId, catalogueVersionId: pinId }),
      (v): v is Awaited<ReturnType<CataloguePort['getVersion']>> =>
        v === null ||
        (typeof v === 'object' &&
          typeof (v as { tenant_id?: unknown }).tenant_id === 'string' &&
          typeof (v as { status?: unknown }).status === 'string'),
    );
    assertPublishedPin(tenantId, pinId, pin);

    const resolutions = await this.external(
      'JURISDICTION',
      () =>
        this.deps.jurisdictions.resolve({ tenantId, codes: input.filters.jurisdiction_codes }),
      validResolutions,
    );
    const applicable = applicableJurisdictions(input.filters.jurisdiction_codes, resolutions);

    const serviceCodes = input.filters.service_codes ?? [];
    const candidates = await this.external(
      'SEARCH',
      () =>
        this.deps.search.searchServices({
          tenantId,
          catalogueVersionId: pinId,
          jurisdictionCodes: [...applicable].sort(),
          serviceCodes,
          keywords: input.filters.keywords ?? [],
          limit: limit + 1,
          offset,
        }),
      validCandidates,
    );
    const hasMore = candidates.length > limit;
    const page = candidates.slice(0, limit);
    const serviceIds = [...new Set(page.map((c) => c.service_id))];
    const entries =
      serviceIds.length === 0
        ? []
        : await this.external(
            'CATALOGUE',
            () =>
              this.deps.catalogue.getEntries({ tenantId, catalogueVersionId: pinId, serviceIds }),
            validEntries,
          );
    const { items, excluded } = selectAvailable({
      tenantId,
      catalogueVersionId: pinId,
      serviceCodes,
      candidates: page,
      entries,
      applicable,
    });

    const { labels, status: localizationStatus } = await this.labelsFor(
      tenantId,
      input.locale,
      items,
    );

    const contract = buildDiscoveryQuery({
      tenantId,
      queryId,
      correlationId: ctx.correlation_id,
      filters: input.filters,
      catalogueVersionId: pinId,
      pagination: input.pagination,
    });
    if (!isDiscoveryQuery(contract)) {
      throw new Cmp006Error('SF-SYS-001', detail('INVALID_DISCOVERY_QUERY'));
    }

    const now = this.deps.clock();
    const record: DiscoveryQueryRecord = {
      tenant_id: tenantId,
      query_id: queryId,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      catalogue_version_id: pinId,
      jurisdiction_codes: input.filters.jurisdiction_codes,
      service_codes: serviceCodes,
      keyword_count: input.filters.keywords?.length ?? 0,
      pagination_limit: limit,
      pagination_offset: offset,
      result_count: items.length,
      excluded_count: excluded,
      has_more: hasMore,
      created_at: now.toISOString(),
      correlation_id: ctx.correlation_id,
    };
    const results: DiscoveryResultRecord[] = items.map(({ label_key: _key, ...item }) => ({
      ...item,
      tenant_id: tenantId,
      query_id: queryId,
    }));

    await this.deps.repo.withTx(ctx, async (tx) => {
      await tx.insertQuery(record);
      if (results.length > 0) await tx.insertResults(results);
      await this.emit(tx, ctx, {
        eventType: 'DiscoveryQueryExecuted',
        aggregateType: QUERY_RESOURCE_TYPE,
        aggregateId: queryId,
        now,
        data: {
          query_id: queryId,
          catalogue_version_id: pinId,
          jurisdiction_codes: record.jurisdiction_codes,
          service_codes: record.service_codes,
          keyword_count: record.keyword_count,
          result_count: record.result_count,
          excluded_count: record.excluded_count,
          has_more: hasMore,
          result_is_non_statutory: true,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.query,
        actionClass: 'READ',
        resourceType: QUERY_RESOURCE_TYPE,
        resourceId: queryId,
        result: 'SUCCESS',
        now,
      });
    });

    return {
      status: 200,
      body: {
        query: contract,
        results: items.map((i) =>
          resultView(i, i.label_key === null ? null : (labels[i.label_key] ?? null)),
        ),
        pagination: { limit, offset, next_offset: hasMore ? offset + limit : null },
        excluded_count: excluded,
        localization_status: localizationStatus,
        result_is_non_statutory: true,
        draft_created: false,
        created_at: record.created_at,
      },
    };
  }

  /** Labels are presentation only; a localization outage degrades to codes, never fails a query. */
  private async labelsFor(
    tenantId: string,
    locale: string | null,
    items: readonly DiscoveryResultItem[],
  ): Promise<{ labels: Record<string, string>; status: LocalizationStatus }> {
    if (locale === null || !this.deps.localization) return { labels: {}, status: 'NOT_REQUESTED' };
    const keys = [...new Set(items.map((i) => i.label_key).filter((k): k is string => k !== null))];
    if (keys.length === 0) return { labels: {}, status: 'RESOLVED' };
    const port = this.deps.localization;
    try {
      const labels = await this.external(
        'LOCALIZATION',
        () => port.resolveLabels({ tenantId, locale, keys }),
        (v): v is Record<string, string> =>
          typeof v === 'object' &&
          v !== null &&
          !Array.isArray(v) &&
          Object.values(v).every((s) => typeof s === 'string'),
      );
      return { labels, status: 'RESOLVED' };
    } catch (err) {
      if (err instanceof Cmp006Error && err.code === 'SF-INT-001') {
        return { labels: {}, status: 'UNAVAILABLE' };
      }
      throw err;
    }
  }

  /** Owner (or authorised staff) view of a stored query. Raw keywords were never stored. */
  async getQuery(ctx: TenantContext, queryId: string): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.read, QUERY_RESOURCE_TYPE, queryId, QUERY_ACTORS);
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getQuery(queryId);
      if (!row || (ctx.actor.type === 'CITIZEN' && row.actor_id !== ctx.actor.id)) {
        throw new Cmp006Error('SF-SYS-002', detail('QUERY_NOT_FOUND'));
      }
      const results = await tx.getResults(queryId);
      await appendAudit(tx, ctx, {
        action: ACTIONS.read,
        actionClass: 'READ',
        resourceType: QUERY_RESOURCE_TYPE,
        resourceId: queryId,
        result: 'SUCCESS',
        now,
      });
      return {
        status: 200,
        body: {
          query: contractOf(row),
          keyword_count: row.keyword_count,
          results: results.map((r) => resultView(r, null)),
          pagination: {
            limit: row.pagination_limit,
            offset: row.pagination_offset,
            next_offset: row.has_more ? row.pagination_offset + row.pagination_limit : null,
          },
          excluded_count: row.excluded_count,
          result_is_non_statutory: true,
          created_at: row.created_at,
        },
      };
    });
  }

  /**
   * INT-003 hand-off. The citizen who ran the query picks one of its results; CMP-006 records the
   * choice and emits DiscoveryServiceSelected carrying the catalogue and binding pins. The draft
   * itself is created by its owning component on that event, never here.
   */
  async selectService(
    ctx: TenantContext,
    queryId: string,
    input: { service_id: string },
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.select, SELECTION_RESOURCE_TYPE, queryId, SELECT_ACTORS);
    try {
      const preview = await this.deps.repo.withTx(ctx, async (tx) => {
        const q = await tx.getQuery(queryId);
        if (!q || q.actor_id !== ctx.actor.id) return undefined;
        const r = (await tx.getResults(queryId)).find((x) => x.service_id === input.service_id);
        return { q, r };
      });
      if (!preview) throw new Cmp006Error('SF-SYS-002', detail('QUERY_NOT_FOUND'));
      if (!preview.r) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'SERVICE_NOT_IN_RESULTS',
          ACTIONS.select,
          SELECTION_RESOURCE_TYPE,
          queryId,
        );
      }
      const result = preview.r;
      const pin = await this.external(
        'CATALOGUE',
        () =>
          this.deps.catalogue.getVersion({
            tenantId: ctx.tenant_id,
            catalogueVersionId: result.catalogue_version_id,
          }),
        (v): v is Awaited<ReturnType<CataloguePort['getVersion']>> =>
          v === null || (typeof v === 'object' && typeof (v as { status?: unknown }).status === 'string'),
      );
      assertPublishedPin(ctx.tenant_id, result.catalogue_version_id, pin);
      return await this.command(ctx, idem, async (tx, now) => {
        const selection: DiscoverySelectionRecord = {
          tenant_id: ctx.tenant_id,
          selection_id: randomUUID(),
          query_id: queryId,
          service_id: result.service_id,
          service_code: result.service_code,
          service_binding_version_id: result.service_binding_version_id,
          catalogue_version_id: result.catalogue_version_id,
          actor_type: 'CITIZEN',
          actor_id: ctx.actor.id,
          selected_at: now.toISOString(),
          correlation_id: ctx.correlation_id,
        };
        await tx.insertSelection(selection);
        await this.emit(tx, ctx, {
          eventType: 'DiscoveryServiceSelected',
          aggregateType: SELECTION_RESOURCE_TYPE,
          aggregateId: selection.selection_id,
          now,
          data: {
            selection_id: selection.selection_id,
            query_id: queryId,
            service_id: selection.service_id,
            service_code: selection.service_code,
            service_binding_version_id: selection.service_binding_version_id,
            catalogue_version_id: selection.catalogue_version_id,
            result_is_non_statutory: true,
            draft_created: false,
          },
        });
        await appendAudit(tx, ctx, {
          action: ACTIONS.select,
          actionClass: 'WRITE',
          resourceType: SELECTION_RESOURCE_TYPE,
          resourceId: selection.selection_id,
          result: 'SUCCESS',
          now,
        });
        return {
          status: 201,
          body: {
            selection_id: selection.selection_id,
            query_id: queryId,
            service_id: selection.service_id,
            service_code: selection.service_code,
            service_binding_version_id: selection.service_binding_version_id,
            catalogue_version_id: selection.catalogue_version_id,
            selected_at: selection.selected_at,
            result_is_non_statutory: true,
            draft_created: false,
          },
        };
      });
    } catch (err) {
      return this.auditedFailure(ctx, ACTIONS.select, SELECTION_RESOURCE_TYPE, queryId, err);
    }
  }

  private async command(
    ctx: TenantContext,
    idem: Idempotency,
    run: (tx: DiscoveryTx, now: Date) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claim !== 'claimed') return claim;
      const result = await run(tx, now);
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: result.status,
        body: result.body,
      });
      return result;
    });
  }
}
