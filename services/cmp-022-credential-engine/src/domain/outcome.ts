import type { ActorType } from '../types.js';

export const DOWNSTREAM_CHANNELS = ['DIGILOCKER_PUBLISH', 'NOTIFICATION'] as const;
export type DownstreamChannel = (typeof DOWNSTREAM_CHANNELS)[number];
export type DownstreamResult = 'SUCCEEDED' | 'FAILED';

/**
 * Append-only record of a post-issuance side effect (CMP-012 publish, CMP-025 notification).
 * Recording an outcome never changes the credential row: issuance is not reversible by publish
 * or notification failure (SF-CON-CREDENTIAL).
 */
export interface DownstreamOutcomeRow {
  tenant_id: string;
  outcome_id: string;
  credential_id: string;
  channel: DownstreamChannel;
  outcome: DownstreamResult;
  outcome_ref: string;
  failure_code: string | null;
  actor_type: ActorType;
  recorded_by: string;
  correlation_id: string;
  recorded_at: string;
}

export function downstreamOutcomeView(row: DownstreamOutcomeRow): Record<string, unknown> {
  const view: Record<string, unknown> = {
    outcome_id: row.outcome_id,
    credential_id: row.credential_id,
    channel: row.channel,
    outcome: row.outcome,
    outcome_ref: row.outcome_ref,
    recorded_at: row.recorded_at,
    credential_lifecycle_status: 'ISSUED',
    issuance_reversed: false,
  };
  if (row.failure_code !== null) view['failure_code'] = row.failure_code;
  return view;
}
