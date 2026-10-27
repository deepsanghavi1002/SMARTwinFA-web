import { Client } from "pg";
import { logEvent } from "./log.ts";

/**
 * A connection is opened and closed inside the request that uses it, and
 * nothing is pooled across requests.
 *
 * The application runs on the Workers runtime, where a socket belongs to the
 * request that opened it: reusing a pooled connection on a later request makes
 * that request hang until the runtime cancels it, which showed up as roughly
 * every other call to the company selection screen never returning. The
 * database is on the same machine, so opening a connection per request costs
 * little.
 *
 * Configuration is read here, not at module load, because the worker's
 * environment is only populated once a request is being handled.
 *
 * DATABASE_URL supplies host, port, database and user; DB_* override any of
 * them. The password is passed separately rather than embedded in the URL so
 * it never reaches a log line or a committed file — set DB_PASSWORD (or
 * PGPASSWORD) in .env.local. pg lets a connectionString override an explicit
 * `password`, so the two must not be mixed.
 */
function clientConfig() {
  const password = process.env.DB_PASSWORD || process.env.PGPASSWORD;
  if (!password) {
    throw new Error("DB_PASSWORD is not configured; set it in .env.local");
  }
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
  return {
    host: process.env.DB_HOST || url?.hostname || "localhost",
    port: Number(process.env.DB_PORT || url?.port || 5432),
    database: process.env.DB_NAME || url?.pathname.replace(/^\//, "") || "smartwin_data",
    user: process.env.DB_USER || (url?.username ? decodeURIComponent(url.username) : "") || "postgres",
    password,
    application_name: "smartwinfa-web",
  };
}

async function withClient<T>(run: (client: Client) => Promise<T>) {
  const client = new Client(clientConfig());
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** A query slower than this many milliseconds is logged (SLOW_QUERY_MS, default 1000); faster ones are not. */
function slowQueryMs(): number {
  const configured = Number(process.env.SLOW_QUERY_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 1000;
}

/** The statement text for a log line: whitespace folded, cut short, never the parameters. */
export function sqlForLog(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}...` : flat;
}

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  try {
    const res = await withClient((client) => client.query(text, params));
    const duration = Date.now() - start;
    if (duration >= slowQueryMs()) logEvent("warn", "Slow query", { action: "query", durationMs: duration, rows: res.rowCount, sql: sqlForLog(text) });
    return res;
  } catch (error) {
    // The driver's message names the failing statement's problem; the parameters stay out of the log.
    logEvent("error", error instanceof Error ? error.message : String(error), { action: "query", durationMs: Date.now() - start, sql: sqlForLog(text) });
    throw error;
  }
}

/**
 * Runs work inside a read-only transaction. The startup screens read the live
 * company system database, so every statement they issue must be unable to
 * write, whatever the query text says.
 */
export async function readOnly<T>(run: (client: Client) => Promise<T>) {
  return withClient(async (client) => {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    try {
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Runs work that writes inside one transaction: it commits only when `run` returns, and
 * rolls back on any error. `readOnlyWork` keeps a request that only reads from being able
 * to write. The master screens' queries can take longer than the startup ones, so they get
 * a longer statement timeout.
 */
export async function transaction<T>(run: (client: Client) => Promise<T>, options: { readOnlyWork?: boolean; timeoutMs?: number } = {}) {
  return withClient(async (client) => {
    await client.query(options.readOnlyWork ? "BEGIN READ ONLY" : "BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${Math.max(1000, Math.trunc(options.timeoutMs ?? 30000))}ms'`);
    try {
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}
