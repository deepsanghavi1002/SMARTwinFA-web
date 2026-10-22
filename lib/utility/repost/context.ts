import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";

/**
 * Utility > Re-Post Data (Utility_Repostdata, SP_REPOST_DATA of SMART_SETUP). The procedure builds each statement as text with |database| in front of
 * every table; here the same statements are run in PostgreSQL against the company's schema, in order, inside one transaction (the procedure keeps
 * going after a statement that fails; here a failed statement stops the run and takes everything back, naming the statement).
 */
export type RepostContext = Readonly<{
  client: Client;
  /** The company's schema (the procedure's @var_database_name). */
  sch: string;
  /** Year_ID, "ddmmyyyyddmmyyyy". */
  yearId: string;
  /** The year's first and last day, as 'YYYY-MM-DD'. */
  from: string;
  to: string;
  licence: number;
  /** SETUP.EINVOICE_REQ has a Y. */
  einvoiceReq: boolean;
  /** SETUP.I_POSTING has a Y: products post to their own account. */
  prodAcPost: boolean;
  /** The company's own schema name, for the CO_FROM_DATANAME lookup. */
  schemaName: string;
  log: (message: string) => void;
}>;

/** The re-post's progress, one line a step (the step that is running shows at once; its time follows): repost-timing.log in the program's folder. */
export function trace(line: string): void {
  try { appendFileSync(join(process.cwd(), "repost-timing.log"), `${new Date().toISOString().slice(11, 23)} ${line}
`); } catch { /* the log is only a help */ }
}

/** The time of every step of the run in progress (printed, slowest first, when the run ends). */
export const timings: { step: string; ms: number }[] = [];

/** Runs one statement; a failure says which step it was. */
export async function run(ctx: RepostContext, step: string, sql: string, params: unknown[] = []): Promise<number> {
  const started = Date.now();
  trace(`START ${step}`);
  try {
    const result = await ctx.client.query(sql, params);
    const took = Date.now() - started;
    trace(`done  ${step}: ${(took / 1000).toFixed(1)} s, ${result.rowCount ?? 0} rows`);
    timings.push({ step, ms: took });
    return result.rowCount ?? 0;
  } catch (error) {
    throw new Error(`Re-Post stopped at "${step}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The rows of a select. */
export async function rows<T = Record<string, unknown>>(ctx: RepostContext, step: string, sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await ctx.client.query(sql, params)).rows as T[];
  } catch (error) {
    throw new Error(`Re-Post stopped at "${step}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The first column of the first row of a select (null when there is none). */
export async function scalar(ctx: RepostContext, step: string, sql: string, params: unknown[] = []): Promise<unknown> {
  const found = await rows<Record<string, unknown>>(ctx, step, sql, params);
  const first = found[0];
  return first === undefined ? null : Object.values(first)[0] ?? null;
}

/** A number kept as the procedure keeps it: NULL stays NULL (a statement built with it is then empty and does nothing). */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The column of a table that holds the entry type (the desktop's TYPE): this database names it `type` or `int_type`; null when the table has neither. */
export async function typeColumn(ctx: RepostContext, table: string): Promise<string | null> {
  const found = await rows<{ column_name: string }>(ctx, `Type column of ${table}`, "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name IN ('type', 'int_type')", [ctx.sch, table]);
  const names = found.map((row) => row.column_name);
  return names.includes("type") ? "type" : names.includes("int_type") ? "int_type" : null;
}

/** The identity column's sequence of a table back to its start (dbcc checkident ... reseed, 0). */
export async function reseed(ctx: RepostContext, table: string): Promise<void> {
  const columns = await rows<{ column_name: string }>(ctx, `reseed ${table}`, "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND (is_identity = 'YES' OR column_default LIKE 'nextval%')", [ctx.sch, table]);
  for (const { column_name } of columns) {
    const sequence = await scalar(ctx, `reseed ${table}`, "SELECT pg_get_serial_sequence($1, $2)", [`${ctx.sch}.${table}`, column_name]);
    if (typeof sequence === "string") await run(ctx, `reseed ${table}`, `SELECT setval('${sequence}', 1, false)`);
  }
}
