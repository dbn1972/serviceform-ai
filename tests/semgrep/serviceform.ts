// Semgrep rule tests: `semgrep --test .semgrep/` checks each ruleid annotation fires.
declare const db: { query: (q: string, p?: unknown[]) => unknown };
declare const req: { headers: Record<string, string> };
declare const id: string;

// ruleid: sf-no-sql-interpolation
db.query(`SELECT * FROM t WHERE id = ${id}`);

// ok: sf-no-sql-interpolation
db.query('SELECT * FROM t WHERE id = $1', [id]);

// ruleid: sf-no-tenant-from-client-header
export const tenant = req.headers['x-tenant-id'];

// ruleid: sf-no-tls-verify-disable
export const agent = { rejectUnauthorized: false };
