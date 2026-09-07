import { Client } from "pg";

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

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  try {
    const res = await withClient((client) => client.query(text, params));
    console.log("Executed query", { text, duration: Date.now() - start, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error("Database query error", { text, error });
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
