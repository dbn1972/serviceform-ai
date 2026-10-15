/**
 * Recording stand-in for a pg Pool. It never talks to PostgreSQL; it records every statement,
 * which transaction it ran in and the transaction-local settings applied with set_config, so a
 * host seam test can observe tenant scoping and the "no network inside the transaction" rule.
 */
export interface RecordedStatement {
  sql: string;
  params: readonly unknown[];
  tx: number | null;
}

export interface RecordedTx {
  id: number;
  settings: Record<string, string>;
  outcome: 'OPEN' | 'COMMIT' | 'ROLLBACK';
}

type RowsFor = (sql: string, params: readonly unknown[]) => { rows: unknown[]; rowCount?: number };

export class RecordingPool {
  readonly statements: RecordedStatement[] = [];
  readonly txs: RecordedTx[] = [];
  connects = 0;
  private open = 0;
  private seq = 0;

  constructor(private readonly rowsFor: RowsFor = () => ({ rows: [] })) {}

  openTransactions(): number {
    return this.open;
  }

  dataStatements(): RecordedStatement[] {
    return this.statements.filter(
      (s) => !/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(s.sql) && !/set_config/i.test(s.sql),
    );
  }

  settingKeys(): string[] {
    return [...new Set(this.txs.flatMap((t) => Object.keys(t.settings)))].sort();
  }

  tenantsSeen(): string[] {
    const out = new Set<string>();
    for (const t of this.txs) {
      for (const [k, v] of Object.entries(t.settings)) if (/tenant/i.test(k)) out.add(v);
    }
    return [...out];
  }

  query = async (sql: string, params: readonly unknown[] = []) => this.exec(null, sql, params);

  connect = async () => {
    this.connects += 1;
    let current: RecordedTx | null = null;
    return {
      query: async (sql: string, params: readonly unknown[] = []) => {
        const text = String(sql).trim();
        const head = text.slice(0, 16).toUpperCase();
        if (head.startsWith('BEGIN')) {
          this.seq += 1;
          current = { id: this.seq, settings: {}, outcome: 'OPEN' };
          this.txs.push(current);
          this.open += 1;
        } else if ((head.startsWith('COMMIT') || head.startsWith('ROLLBACK')) && current) {
          current.outcome = head.startsWith('COMMIT') ? 'COMMIT' : 'ROLLBACK';
          current = null;
          this.open -= 1;
        } else if (text.toLowerCase().includes('set_config') && current) {
          const marker = "set_config('";
          const lower = text.toLowerCase();
          const at = lower.indexOf(marker);
          let key: string | undefined;
          let value: string;
          if (at >= 0) {
            const start = at + marker.length;
            const end = text.indexOf("'", start);
            key = end > start ? text.slice(start, end) : undefined;
            value = String(params[0]);
          } else {
            key = String(params[0]);
            value = String(params[1]);
          }
          if (key !== undefined) current.settings[key] = value;
        }
        return this.exec(current?.id ?? null, text, params);
      },
      release: () => undefined,
    };
  };

  end = async () => undefined;
  on = () => undefined;

  private exec(tx: number | null, sql: string, params: readonly unknown[]) {
    this.statements.push({ sql, params: [...params], tx });
    const r = this.rowsFor(sql, params);
    return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
  }
}
