import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TopicSpec } from '@serviceform/outbox';
import { loadConfig } from '../config.js';
import { syncRegistry } from './service.js';

const dir = dirname(fileURLToPath(import.meta.url));

export function loadTopicsFile(path = join(dir, '../../registry/topics.json')): TopicSpec[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { topics: TopicSpec[] };
  return raw.topics;
}

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await syncRegistry(client, loadTopicsFile());
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
