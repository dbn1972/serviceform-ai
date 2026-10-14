import type { Actor } from '../types.js';

export const CONTRACT_ID = 'SF-CON-CREDENTIAL-STATUS';
export const STATUS_AUTHORITY_CMP = 'CMP-024';

export const REGISTRY_STATUSES = [
  'REGISTERED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'REISSUED',
] as const;
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];

export const TERMINAL_STATUSES: readonly RegistryStatus[] = ['REVOKED', 'REISSUED'];
/** SF-CON-CREDENTIAL-STATUS: these targets carry a reason_code_ref from approved metadata. */
export const REASON_REQUIRED_STATUSES: readonly RegistryStatus[] = ['SUSPENDED', 'REVOKED'];

export const REGISTRY_COMMANDS = ['ACTIVATE', 'SUSPEND', 'REINSTATE', 'REVOKE', 'REISSUE'] as const;
export type RegistryCommand = (typeof REGISTRY_COMMANDS)[number];

export const COMMAND_TARGET: Readonly<Record<RegistryCommand, RegistryStatus>> = {
  ACTIVATE: 'ACTIVE',
  SUSPEND: 'SUSPENDED',
  REINSTATE: 'ACTIVE',
  REVOKE: 'REVOKED',
  REISSUE: 'REISSUED',
};

/**
 * Lifecycle mechanics only. Which facts justify a suspension or revocation is tenant metadata
 * referenced by reason_code_ref; this table never encodes statutory grounds. The same pairs are
 * enforced by sf_credential_registry.guard_entry().
 */
export const COMMAND_SOURCES: Readonly<Record<RegistryCommand, readonly RegistryStatus[]>> = {
  ACTIVATE: ['REGISTERED'],
  SUSPEND: ['ACTIVE'],
  REINSTATE: ['SUSPENDED'],
  REVOKE: ['REGISTERED', 'ACTIVE', 'SUSPENDED'],
  REISSUE: ['ACTIVE', 'SUSPENDED'],
};

/** A reissue successor must itself be live in the registry of the same tenant. */
export const SUCCESSOR_ELIGIBLE_STATUSES: readonly RegistryStatus[] = ['REGISTERED', 'ACTIVE'];

export type CommandVerdict =
  | { allowed: true; to: RegistryStatus }
  | { allowed: false; reason: 'TERMINAL_STATUS' | 'TRANSITION_NOT_ALLOWED' };

export function isRegistryStatus(value: unknown): value is RegistryStatus {
  return typeof value === 'string' && (REGISTRY_STATUSES as readonly string[]).includes(value);
}

export function evaluateCommand(command: RegistryCommand, from: RegistryStatus): CommandVerdict {
  if (TERMINAL_STATUSES.includes(from)) return { allowed: false, reason: 'TERMINAL_STATUS' };
  if (!COMMAND_SOURCES[command].includes(from)) {
    return { allowed: false, reason: 'TRANSITION_NOT_ALLOWED' };
  }
  return { allowed: true, to: COMMAND_TARGET[command] };
}

export const OPAQUE_REF = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isOpaqueRef(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_REF.test(value);
}

export interface RegistryEntryRecord {
  tenant_id: string;
  credential_id: string;
  issuer_ref: string;
  current_status: RegistryStatus;
  superseded_by_credential_id: string | null;
  status_version: number;
  registered_at: string;
  updated_at: string;
  registered_by: string;
  last_correlation_id: string;
}

export interface StatusHistoryRecord {
  tenant_id: string;
  entry_id: string;
  credential_id: string;
  sequence: number;
  from_status: RegistryStatus | null;
  to_status: RegistryStatus;
  reason_code_ref: string | null;
  superseded_by_credential_id: string | null;
  actor_type: Actor['type'];
  actor_id: string;
  correlation_id: string;
  changed_at: string;
}

export interface HistoryEntryContract {
  entry_id: string;
  sequence: number;
  from_status: RegistryStatus | null;
  to_status: RegistryStatus;
  reason_code_ref?: string;
  changed_at: string;
  actor: Actor;
  immutable: true;
}

export interface CredentialStatusContract {
  contract_id: typeof CONTRACT_ID;
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  credential_id: string;
  issuer_ref: string;
  status_authority_cmp: typeof STATUS_AUTHORITY_CMP;
  current_status: RegistryStatus;
  superseded_by_credential_id?: string;
  history: HistoryEntryContract[];
  history_append_only: true;
  invented_statutory_policy_forbidden: true;
  correlation_id?: string;
}

export function toContract(
  entry: RegistryEntryRecord,
  history: readonly StatusHistoryRecord[],
): CredentialStatusContract {
  const ordered = [...history].sort((a, b) => a.sequence - b.sequence);
  const doc: CredentialStatusContract = {
    contract_id: CONTRACT_ID,
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: entry.tenant_id,
    credential_id: entry.credential_id,
    issuer_ref: entry.issuer_ref,
    status_authority_cmp: STATUS_AUTHORITY_CMP,
    current_status: entry.current_status,
    history: ordered.map((h) => {
      const item: HistoryEntryContract = {
        entry_id: h.entry_id,
        sequence: h.sequence,
        from_status: h.from_status,
        to_status: h.to_status,
        changed_at: h.changed_at,
        actor: { type: h.actor_type, id: h.actor_id },
        immutable: true,
      };
      if (h.reason_code_ref !== null) item.reason_code_ref = h.reason_code_ref;
      return item;
    }),
    history_append_only: true,
    invented_statutory_policy_forbidden: true,
    correlation_id: entry.last_correlation_id,
  };
  if (entry.superseded_by_credential_id !== null) {
    doc.superseded_by_credential_id = entry.superseded_by_credential_id;
  }
  return doc;
}
