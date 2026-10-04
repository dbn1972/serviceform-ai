import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

export const GENESIS_HASH_HEX = '00'.repeat(32);

export function sha256(bytes: Buffer | string): Buffer {
  return createHash('sha256').update(bytes).digest();
}

export function hashEvent(event: unknown): Buffer {
  return sha256(canonicalJson(event));
}

export interface ChainHashInput {
  tenant_id: string | null;
  chain_seq: number;
  recorded_at: string;
  audit_id: string;
  event: unknown;
  prev_hash_hex: string;
}

export function hashChainRow(input: ChainHashInput): Buffer {
  return sha256(
    canonicalJson({
      v: 1,
      audit_id: input.audit_id,
      chain_seq: input.chain_seq,
      event: input.event,
      prev_hash: input.prev_hash_hex,
      recorded_at: input.recorded_at,
      tenant_id: input.tenant_id,
    }),
  );
}

export function toHex(buf: Buffer): string {
  return buf.toString('hex');
}
