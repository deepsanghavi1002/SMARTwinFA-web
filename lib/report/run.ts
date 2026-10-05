import type { FieldDef } from "pg";
import type { Loader } from "../master-program/load";
import { ReportRefusal } from "./generate";

/**
 * Runs one statement of a report the way SP_REPORT_STANDARD's TRY / CATCH does: a failure stops the
 * report and shows the database's message (the procedure's ERROR_DETAILS). Each statement runs in
 * a savepoint so the transaction survives for the error to be reported.
 */
export type SqlResult = Readonly<{ fields: readonly FieldDef[]; rows: Record<string, unknown>[] }>;

let savepoints = 0;

export async function runReportSql(loader: Loader, sql: string, params: unknown[] = []): Promise<SqlResult> {
  const name = `rp${++savepoints}`;
  await loader.client.query(`SAVEPOINT ${name}`);
  try {
    const result = await loader.client.query(sql, params);
    await loader.client.query(`RELEASE SAVEPOINT ${name}`);
    return { fields: result.fields, rows: result.rows };
  } catch (error) {
    await loader.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    loader.warnings.push(`${error instanceof Error ? error.message : String(error)} :: ${sql.slice(0, 2000)}`);
    throw new ReportRefusal(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE");
  }
}

/** PostgreSQL type ids of the number types (int2, int4, int8, float4, float8, numeric, money). */
const NUMBER_TYPES = new Set([20, 21, 23, 700, 701, 1700, 790]);

export function isNumberField(field: FieldDef | undefined): boolean {
  return field !== undefined && NUMBER_TYPES.has(field.dataTypeID);
}

/** A cell as a number: numeric arrives as text, money already as a number (Loader's parser). */
export function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Decimal arithmetic on amounts: rounded to 4 places after every step, as numeric(18,4) would hold it. */
export function money(value: number): number {
  return Math.round(value * 10000) / 10000;
}
