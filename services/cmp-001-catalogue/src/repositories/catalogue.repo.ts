import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Cmp001Error } from '../errors.js';
import { assertUnpublished } from '../domain/publication.js';

export function newId(): string {
  return randomUUID();
}

export async function latestOfferingVersion(
  client: PoolClient,
  offeringId: string,
): Promise<{ version_no: string; published_pin_ref: string | null; status: string } | undefined> {
  const { rows } = await client.query<{
    version_no: string;
    published_pin_ref: string | null;
    status: string;
  }>(
    `SELECT version_no, published_pin_ref, status
       FROM sf_catalogue.offering_version
      WHERE offering_id = $1
      ORDER BY version_no DESC
      LIMIT 1`,
    [offeringId],
  );
  return rows[0];
}

export async function requireMutableOffering(
  client: PoolClient,
  offeringId: string,
): Promise<{ version_no: string; published_pin_ref: string | null; status: string }> {
  const latest = await latestOfferingVersion(client, offeringId);
  if (!latest) throw new Cmp001Error('SF-SYS-002');
  assertUnpublished(latest.published_pin_ref);
  return latest;
}
