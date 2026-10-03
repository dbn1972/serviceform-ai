import pg from 'pg';
import { verifyPlatformChain, verifyTenantChain } from '../domain/verify-chain.js';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exitCode = 1;
    return;
  }
  const tenant = process.argv[2];
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const report =
      tenant === undefined || tenant === 'platform'
        ? await verifyPlatformChain(client)
        : await verifyTenantChain(client, tenant);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.ok) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
