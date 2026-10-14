import { describe, expect, it } from 'vitest';
import {
  COMMAND_SOURCES,
  evaluateCommand,
  isOpaqueRef,
  REGISTRY_COMMANDS,
  REGISTRY_STATUSES,
  TERMINAL_STATUSES,
  toContract,
  type RegistryEntryRecord,
  type RegistryStatus,
  type StatusHistoryRecord,
} from '../../src/domain/status.js';
import {
  ACTOR_OFFICER,
  ACTOR_SYSTEM,
  CRED_1,
  CRED_2,
  ISSUER_REF,
  TENANT_A,
} from '../doubles/fixtures.js';

const EXPECTED: Record<string, RegistryStatus | null> = {
  'REGISTERED:ACTIVATE': 'ACTIVE',
  'REGISTERED:REVOKE': 'REVOKED',
  'ACTIVE:SUSPEND': 'SUSPENDED',
  'ACTIVE:REVOKE': 'REVOKED',
  'ACTIVE:REISSUE': 'REISSUED',
  'SUSPENDED:REINSTATE': 'ACTIVE',
  'SUSPENDED:REVOKE': 'REVOKED',
  'SUSPENDED:REISSUE': 'REISSUED',
};

describe('registry state machine', () => {
  for (const from of REGISTRY_STATUSES) {
    for (const command of REGISTRY_COMMANDS) {
      const want = EXPECTED[`${from}:${command}`] ?? null;
      it(`${from} --${command}--> ${want ?? 'refused'}`, () => {
        const v = evaluateCommand(command, from);
        if (want === null) {
          expect(v.allowed).toBe(false);
          if (!v.allowed) {
            expect(v.reason).toBe(
              TERMINAL_STATUSES.includes(from) ? 'TERMINAL_STATUS' : 'TRANSITION_NOT_ALLOWED',
            );
          }
        } else {
          expect(v).toEqual({ allowed: true, to: want });
        }
      });
    }
  }

  it('terminal statuses have no outgoing transition and REGISTERED is never a target', () => {
    for (const cmd of REGISTRY_COMMANDS) {
      for (const t of TERMINAL_STATUSES) expect(COMMAND_SOURCES[cmd]).not.toContain(t);
    }
    expect(Object.values(EXPECTED)).not.toContain('REGISTERED');
  });

  it('opaque refs reject free text, whitespace and over-long values', () => {
    expect(isOpaqueRef('reason:tenant-meta:0007')).toBe(true);
    expect(isOpaqueRef('Fraudulent document submitted')).toBe(false);
    expect(isOpaqueRef('')).toBe(false);
    expect(isOpaqueRef('a'.repeat(129))).toBe(false);
    expect(isOpaqueRef('ref;DROP')).toBe(false);
    expect(isOpaqueRef(7)).toBe(false);
  });
});

describe('toContract', () => {
  const entry: RegistryEntryRecord = {
    tenant_id: TENANT_A,
    credential_id: CRED_1,
    issuer_ref: ISSUER_REF,
    current_status: 'REISSUED',
    superseded_by_credential_id: CRED_2,
    status_version: 3,
    registered_at: '2026-10-14T04:00:00.000Z',
    updated_at: '2026-10-14T05:00:00.000Z',
    registered_by: ACTOR_SYSTEM,
    last_correlation_id: '77777777-7777-4777-8777-777777777777',
  };
  const row = (
    sequence: number,
    from: RegistryStatus | null,
    to: RegistryStatus,
    reason: string | null,
  ): StatusHistoryRecord => ({
    tenant_id: TENANT_A,
    entry_id: `a${sequence}111111-1111-4111-8111-111111111111`,
    credential_id: CRED_1,
    sequence,
    from_status: from,
    to_status: to,
    reason_code_ref: reason,
    superseded_by_credential_id: to === 'REISSUED' ? CRED_2 : null,
    actor_type: sequence === 1 ? 'SYSTEM' : 'OFFICER',
    actor_id: sequence === 1 ? ACTOR_SYSTEM : ACTOR_OFFICER,
    correlation_id: '77777777-7777-4777-8777-777777777777',
    changed_at: '2026-10-14T04:00:00.000Z',
  });

  it('orders history by sequence, omits null reasons and carries the successor id', () => {
    const doc = toContract(entry, [
      row(3, 'ACTIVE', 'REISSUED', 'reason:meta:9'),
      row(1, null, 'REGISTERED', null),
      row(2, 'REGISTERED', 'ACTIVE', null),
    ]);
    expect(doc.history.map((h) => h.sequence)).toEqual([1, 2, 3]);
    expect('reason_code_ref' in (doc.history[0] ?? {})).toBe(false);
    expect(doc.history[2]?.reason_code_ref).toBe('reason:meta:9');
    expect(doc.superseded_by_credential_id).toBe(CRED_2);
    expect(doc.status_authority_cmp).toBe('CMP-024');
    expect(doc.history.every((h) => h.immutable)).toBe(true);
  });

  it('non-reissued entries carry no successor id', () => {
    const doc = toContract(
      { ...entry, current_status: 'ACTIVE', superseded_by_credential_id: null },
      [row(1, null, 'REGISTERED', null)],
    );
    expect('superseded_by_credential_id' in doc).toBe(false);
  });
});
