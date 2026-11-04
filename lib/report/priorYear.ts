import type { Loader } from "../master-program/load";
import { SYSTEM_SCHEMA } from "../master-program/session";
import { desktopDate } from "./formula";
import type { ReportCall } from "./call";

/**
 * The previous year's database of the open company ("schema."), what the procedures take as @nvar_Prv_DatabaseName: the company of the same name whose
 * accounting year starts a year before this one. "" when there is none (the first year, or its schema is not in this installation).
 */
export async function priorYearDatabase(loader: Loader, call: ReportCall): Promise<string> {
  const { session } = loader;
  const start = call.tarikh1;
  const found = (await loader.client.query(
    `SELECT LOWER(BTRIM(c.co_dataname)) AS schema_name FROM ${SYSTEM_SCHEMA}.company c JOIN ${SYSTEM_SCHEMA}.cname n ON n.c_id = c.co_key JOIN ${SYSTEM_SCHEMA}.year_ac y ON y.year_key = n.c_yearid
     WHERE c.co_pos = 'A' AND BTRIM(c.name) = $1 AND y.year_start::date = $2::date AND LOWER(BTRIM(c.co_dataname)) <> $3 AND LOWER(BTRIM(c.co_dataname)) ~ '^[a-z_][a-z0-9_]*$'
       AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = LOWER(BTRIM(c.co_dataname))) ORDER BY c.co_key DESC LIMIT 1`,
    [session.companyName, desktopDate(new Date(start.getFullYear() - 1, start.getMonth(), start.getDate())), session.companySchema])).rows[0];
  return found ? `${String(found.schema_name)}.` : "";
}

/** A date as yyyy-mm-dd (a parameter for ::date). */
export const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** "(1,2,3)" of ticked keys as it can be written into SQL, else "" (nothing ticked or not a plain key list). */
export const keyList = (keys: string) => (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys.trim()) ? keys.trim() : "");
