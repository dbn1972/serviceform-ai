import type {
  AuthzDecisionInput,
  AuthzDecisionOutput,
  ConnectorBinding,
  RequestContext,
} from '@serviceform/contracts';
import type { EnabledBinding, RetryPolicy } from '@serviceform/connector-sdk';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export interface MetricsPort {
  increment(name: string, labels?: Record<string, string>): void;
}

export interface DefinitionRecord {
  connector_definition_id: string;
  adapter_key: string;
  connector_type: ConnectorBinding['connector_type'];
  supported_modes: string[];
  timeout_ms: number;
  retry_policy: RetryPolicy | null;
  egress_allowlist: string[];
  status: 'ACTIVE' | 'DISABLED';
}

export interface BindingRecord {
  binding: ConnectorBinding & { enabled: boolean };
  definition: DefinitionRecord;
}

export interface TransactionRow {
  connector_transaction_id: string;
  tenant_id: string;
  connector_binding_id: string;
  direction: 'INVOKE' | 'WEBHOOK';
  operation: string;
  idempotency_key: string | null;
  request_fingerprint: string;
  provider_reference: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CIRCUIT_OPEN';
  attempts: number;
  error_code: string | null;
  response_ref: string | null;
  mode: string;
  environment: string;
  simulation: unknown;
  correlation_id: string;
  aggregate_version: number;
}

export interface BindingRepository {
  getById(id: string): Promise<BindingRecord | null>;
  insertBinding(record: BindingRecord): Promise<void>;
  insertDefinition(def: DefinitionRecord): Promise<void>;
  listEnabledIndex(): Promise<EnabledBinding[]>;
  resolveWebhookTenant(bindingId: string): Promise<string | null>;
}

export interface TransactionRepository {
  insertInvoke(row: TransactionRow): Promise<{ inserted: boolean; row: TransactionRow }>;
  insertWebhook(row: TransactionRow): Promise<{ inserted: boolean; row: TransactionRow }>;
  finalize(
    id: string,
    patch: Pick<
      TransactionRow,
      'status' | 'attempts' | 'error_code' | 'response_ref' | 'provider_reference' | 'simulation'
    > & {
      aggregate_version: number;
    },
  ): Promise<boolean>;
  getTransaction(id: string): Promise<TransactionRow | null>;
}

export interface OutboxWriter {
  insertTenant(input: { envelope: unknown; topic: string; partition_key: string }): Promise<void>;
}

export interface InboxWriter {
  record(consumerGroup: string, eventId: string, tenantId: string): Promise<boolean>;
}

export interface UnitOfWork {
  withTransaction<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T>;
}

export const denyAllAuthorization: AuthorizationPort = {
  async decide(): Promise<AuthzDecisionOutput> {
    return {
      allow: false,
      reason_code: 'DEFAULT_DENY',
      policy_revision: 'none',
      decision_id: '00000000-0000-4000-8000-000000000000',
    };
  },
};

export const noopMetrics: MetricsPort = {
  increment() {},
};
