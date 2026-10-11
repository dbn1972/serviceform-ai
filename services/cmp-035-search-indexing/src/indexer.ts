import { assertPortAllowed, loadConfig, type Cmp035Config } from './config.js';
import { Cmp035Error, detail } from './errors.js';
import {
  buildSearchDocument,
  deriveDocumentId,
  isSearchDocument,
  type SearchDocument,
} from './domain/document.js';
import { classifyEvent, isProjectionRule, projectFacets } from './domain/projection.js';
import { TOPIC_RE, isEventEnvelope, isUuid, type EventEnvelope } from './domain/validate.js';
import {
  EVENT_TYPES,
  INDEXER_CONSUMER_GROUP,
  TOPIC_AUDIT,
  TOPIC_DOMAIN,
  auditEnvelope,
  envelopeOf,
  type EventContext,
} from './events.js';
import { noProjectionRules, type ProjectionRulePort } from './ports/projection-rules.js';
import type { DbSession, DocumentStatus, SearchStore } from './store/types.js';
import { guardOutboundPort, runInDomainTransaction } from './tx-scope.js';

/** One event handed to CMP-035 by the CMP-038 consumer runtime (topic + SF-CON-EVENT-ENVELOPE). */
export interface IndexDelivery {
  topic: string;
  envelope: unknown;
}

export type SkipReason = 'NOT_TENANT_SCOPED' | 'NO_PROJECTION_RULE' | 'EVENT_TYPE_NOT_PROJECTED';

export type IndexOutcome =
  | {
      outcome: 'INDEXED' | 'REMOVED';
      document_id: string;
      revision: number;
      source_version: number;
    }
  | { outcome: 'DUPLICATE' | 'STALE'; document_id: string }
  | { outcome: 'SKIPPED'; reason: SkipReason };

export interface IndexerDeps {
  store: SearchStore;
  rules?: ProjectionRulePort;
  /** SYSTEM workload identity the indexer writes as (audit actor). */
  indexerActorId: string;
  config?: Cmp035Config;
  clock?: () => Date;
}

export interface DocumentChangeData {
  document: SearchDocument;
  status: DocumentStatus;
  revision: number;
  source: {
    aggregate_type: string;
    version: number;
    event_id: string;
    event_type: string;
  };
  projection: { rule_id: string; rule_version: number };
}

function invalid(code: string): Cmp035Error {
  return new Cmp035Error('SF-SYS-003', { details: detail(code) });
}

/**
 * Projects tenant events into sf_search. The source component stays authoritative: CMP-035 keeps
 * only declared facets plus the source identity/version, and never writes back to the source.
 */
export class SearchIndexConsumer {
  private readonly store: SearchStore;
  private readonly rules: ProjectionRulePort;
  private readonly indexerActorId: string;
  private readonly clock: () => Date;

  constructor(deps: IndexerDeps) {
    if (!isUuid(deps.indexerActorId)) throw invalid('INDEXER_ACTOR_ID_INVALID');
    const config = deps.config ?? loadConfig();
    const rules = deps.rules ?? noProjectionRules();
    assertPortAllowed(rules, config.environment, 'PROJECTION_RULES');
    this.store = deps.store;
    this.rules = guardOutboundPort('projection-rules', rules);
    this.indexerActorId = deps.indexerActorId;
    this.clock = deps.clock ?? (() => new Date());
  }

  async ingest(delivery: IndexDelivery): Promise<IndexOutcome> {
    if (typeof delivery.topic !== 'string' || !TOPIC_RE.test(delivery.topic)) {
      throw invalid('INVALID_TOPIC');
    }
    if (!isEventEnvelope(delivery.envelope)) throw invalid('INVALID_ENVELOPE');
    const env: EventEnvelope = delivery.envelope;
    if (env.tenant_id === null) return { outcome: 'SKIPPED', reason: 'NOT_TENANT_SCOPED' };
    const tenantId = env.tenant_id;

    const rule = await this.rules.resolve({
      tenantId,
      topic: delivery.topic,
      aggregateType: env.aggregate_type,
      eventType: env.event_type,
    });
    if (rule === null) return { outcome: 'SKIPPED', reason: 'NO_PROJECTION_RULE' };
    if (!isProjectionRule(rule)) throw invalid('INVALID_PROJECTION_RULE');
    if (rule.topic !== delivery.topic || rule.aggregate_type !== env.aggregate_type) {
      throw invalid('PROJECTION_RULE_MISMATCH');
    }
    const action = classifyEvent(rule, env.event_type);
    if (action === null) return { outcome: 'SKIPPED', reason: 'EVENT_TYPE_NOT_PROJECTED' };

    const facets = action === 'UPSERT' ? projectFacets(rule, env.data) : {};
    const status: DocumentStatus = action === 'UPSERT' ? 'ACTIVE' : 'REMOVED';
    const documentId = deriveDocumentId(tenantId, rule.source_cmp_id, env.aggregate_id);
    const document = buildSearchDocument({
      tenantId,
      documentId,
      sourceCmpId: rule.source_cmp_id,
      sourceRecordId: env.aggregate_id,
      facets,
    });
    if (!isSearchDocument(document)) throw invalid('INVALID_SEARCH_DOCUMENT');

    const ctx: EventContext = {
      tenant_id: tenantId,
      cell_id: env.cell_id,
      actor: { type: 'SYSTEM', id: this.indexerActorId },
      correlation_id: env.correlation_id,
      trace_id: env.correlation_id.replace(/-/g, '').toLowerCase(),
    };
    const session: DbSession = {
      tenantId,
      cellId: ctx.cell_id,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      correlationId: ctx.correlation_id,
    };

    return this.store.withTx(session, (tx) =>
      runInDomainTransaction(async (): Promise<IndexOutcome> => {
        if (!(await tx.recordInbox(INDEXER_CONSUMER_GROUP, env.event_id))) {
          return { outcome: 'DUPLICATE', document_id: documentId };
        }
        const existing = await tx.getDocumentBySource(rule.source_cmp_id, env.aggregate_id, {
          forUpdate: true,
        });
        const now = this.clock().toISOString();
        let revision: number;
        if (existing) {
          if (env.aggregate_version <= existing.source_version) {
            return { outcome: 'STALE', document_id: existing.document_id };
          }
          const updated = await tx.updateDocument({
            documentId: existing.document_id,
            fromRevision: existing.revision,
            fromSourceVersion: existing.source_version,
            sourceVersion: env.aggregate_version,
            sourceEventId: env.event_id,
            sourceEventType: env.event_type,
            sourceOccurredAt: env.occurred_at,
            projectionRuleId: rule.rule_id,
            projectionRuleVersion: rule.rule_version,
            facets,
            status,
            updatedAt: now,
            correlationId: env.correlation_id,
          });
          if (!updated) {
            throw new Cmp035Error('SF-APP-001', { details: detail('CONCURRENT_UPDATE') });
          }
          revision = existing.revision + 1;
        } else {
          await tx.insertDocument({
            document_id: documentId,
            tenant_id: tenantId,
            cell_id: env.cell_id,
            source_cmp_id: rule.source_cmp_id,
            source_record_id: env.aggregate_id,
            source_aggregate_type: env.aggregate_type,
            source_topic: delivery.topic,
            source_version: env.aggregate_version,
            source_event_id: env.event_id,
            source_event_type: env.event_type,
            source_occurred_at: env.occurred_at,
            projection_rule_id: rule.rule_id,
            projection_rule_version: rule.rule_version,
            facets,
            status,
            revision: 1,
            indexed_at: now,
            updated_at: now,
            last_correlation_id: env.correlation_id,
          });
          revision = 1;
        }
        const data: DocumentChangeData = {
          document,
          status,
          revision,
          source: {
            aggregate_type: env.aggregate_type,
            version: env.aggregate_version,
            event_id: env.event_id,
            event_type: env.event_type,
          },
          projection: { rule_id: rule.rule_id, rule_version: rule.rule_version },
        };
        await tx.insertOutbox(
          envelopeOf({
            eventType: status === 'ACTIVE' ? EVENT_TYPES.indexed : EVENT_TYPES.removed,
            ctx,
            aggregateId: documentId,
            aggregateVersion: revision,
            occurredAt: now,
            causationId: env.event_id,
            data,
          }),
          TOPIC_DOMAIN,
        );
        await tx.insertOutbox(
          auditEnvelope(ctx, {
            action: status === 'ACTIVE' ? 'SEARCH_DOCUMENT_INDEX' : 'SEARCH_DOCUMENT_REMOVE',
            actionClass: 'WRITE',
            resourceId: documentId,
            result: 'SUCCESS',
            occurredAt: now,
            afterRef: `sf_search.search_document:${documentId}:${revision}`,
            causationId: env.event_id,
          }),
          TOPIC_AUDIT,
        );
        return {
          outcome: status === 'ACTIVE' ? 'INDEXED' : 'REMOVED',
          document_id: documentId,
          revision,
          source_version: env.aggregate_version,
        };
      }),
    );
  }
}
