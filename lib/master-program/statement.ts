import type { Client, QueryResult } from "pg";

/**
 * Runs one statement of a save. The company tables came across from SQL Server with their keys as
 * GENERATED ALWAYS identity columns (party_rate.pr_key, account.code, addon_data.aon_key ...). The
 * web allocates keys itself (max+1 under a table lock, see allocateKey) because later statements of
 * the same save need them, and PostgreSQL refuses a key it did not generate:
 * "cannot insert a non-DEFAULT value into column pr_key". So an INSERT says OVERRIDING SYSTEM VALUE
 * (which changes nothing on a table without an identity column), and the table's identity sequence
 * is kept past its highest key, before the insert (for one that leaves the key to the database,
 * such as the log tables) and after it (for keys the web wrote, so the database never hands out
 * one of them again). Any other statement runs as it is.
 */
export async function runStatement(client: Client, sql: string, params?: unknown[]): Promise<QueryResult> {
  const insert = /^\s*insert\s+into\s+("?[\w$]+"?)\.("?[\w$]+"?)\s*\(/i.exec(sql);
  if (!insert) return client.query(sql, params);
  const name = (part: string) => (part.startsWith("\"") ? part.replace(/"/g, "") : part.toLowerCase());
  const schema = name(insert[1]);
  const table = name(insert[2]);
  const identity = await identityColumns(client, schema, table);
  await syncIdentity(client, schema, table, identity);
  const result = await client.query(withOverriding(sql), params);
  await syncIdentity(client, schema, table, identity);
  return result;
}

/** INSERT INTO t (columns) VALUES / SELECT ... with OVERRIDING SYSTEM VALUE before VALUES or SELECT. */
export function withOverriding(sql: string): string {
  if (/overriding\s+system\s+value/i.test(sql)) return sql;
  return sql.replace(/^(\s*insert\s+into\s+[\w$."]+\s*\([^)]*\))\s*(values|select)\b/i, "$1 OVERRIDING SYSTEM VALUE $2");
}

async function identityColumns(client: Client, schema: string, table: string): Promise<string[]> {
  const rows = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_identity = 'YES'", [schema, table])).rows as { column_name: string }[];
  return rows.map((row) => row.column_name);
}

/** The identity sequence's next value comes after the highest key in the table. */
async function syncIdentity(client: Client, schema: string, table: string, columns: readonly string[]) {
  for (const column of columns) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), GREATEST((SELECT COALESCE(MAX("${column.replace(/"/g, "")}"), 0) FROM "${schema}"."${table}"), 1))`,
      [`"${schema}"."${table}"`, column],
    );
  }
}
