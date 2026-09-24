import { formatDesktopDate, formatDesktopTime } from "./legacy";
import type { MasterSession } from "./session";

/**
 * Lib_GlobalFunctions.ReplaceSysValueinQuery, and Master_ProgramGrid.SetDataBaseName.
 *
 * The desktop runs this over every setup query before Func_ReplaceSysVal_CtrlValue: it
 * swaps the placeholders that depend only on the session - the company database, the
 * year, the operator, today. `|sys.db|` becomes `<schema>.`, the PostgreSQL spelling of
 * the desktop's `[COMPANY].[dbo].`.
 *
 * Dates keep the desktop's dd/MMM/yyyy literal; PostgreSQL reads '05/Sep/2026' as a date
 * under any DateStyle, so the stored queries need no change.
 */
export function replaceSessionValues(source: string | null | undefined, session: MasterSession, now = new Date()): string {
  if (source === null || source === undefined) return "";
  let sql = source;
  const swap = (token: string, value: string) => {
    if (sql.toLowerCase().includes(token)) sql = sql.split(token).join(value);
  };
  swap("|sys.db|", `${session.companySchema}.`);
  swap("|sys.user_id|", String(session.userNo));
  swap("|sys.yearid|", `'${session.yearId}'`);
  swap("|sys.year_id|", `'${session.yearId}'`);
  swap("|sys.tarikh1|", `'${formatDesktopDate(session.tarikh1)}'`);
  swap("|sys.tarikh2|", `'${formatDesktopDate(session.tarikh2)}'`);
  swap("|sys.today|", `'${formatDesktopDate(now)}'`);
  swap("|sys.time|", `'${formatDesktopTime(now)}'`);
  return sql;
}

/** Master_ProgramGrid.SetDataBaseName: only |sys.db|. */
export function setDataBaseName(source: string | null | undefined, session: MasterSession): string {
  return (source ?? "").split("|sys.db|").join(`${session.companySchema}.`);
}

/** The first column of the first row of a query, as FieldValueTrfToString reads it; null when no row. */
export function firstValue(rows: readonly Record<string, unknown>[]): unknown {
  const row = rows[0];
  if (!row) return null;
  const key = Object.keys(row)[0];
  return key === undefined ? null : row[key];
}

/**
 * Words SQL Server accepts as a bare column name but PostgreSQL reserves. account.limit is
 * the case in the setup today. The migration kept such columns quoted in the spelling the
 * setup uses ("LIMIT"), so the name is quoted as written.
 */
const PG_RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "both", "case", "cast", "check", "collate", "column",
  "constraint", "create", "current_catalog", "current_date", "current_role", "current_time", "current_timestamp", "current_user",
  "default", "deferrable", "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign", "from", "grant",
  "group", "having", "in", "initially", "intersect", "into", "lateral", "leading", "limit", "localtime", "localtimestamp", "not",
  "null", "offset", "on", "only", "or", "order", "placing", "primary", "references", "returning", "select", "session_user", "some",
  "symmetric", "system_user", "table", "then", "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "when",
  "where", "window", "with",
]);

/** A bare column name as PostgreSQL must read it: quoted when it is a reserved word. */
export function columnName(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  const prefix = dot >= 0 ? trimmed.slice(0, dot + 1) : "";
  const bare = dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(bare) && PG_RESERVED.has(bare.toLowerCase()) ? `${prefix}"${bare}"` : trimmed;
}

/**
 * SQL Server reads `coalesce(AC.Code,'')` on a number column as `coalesce(AC.Code,0)`;
 * PostgreSQL refuses it ("invalid input syntax for type integer"). The help queries use the
 * idiom for columns of every type, so the column is read as text first, which leaves a text
 * column unchanged and shows a number as its digits (the help list shows text either way).
 */
export function blankCoalesceAsText(sql: string): string {
  return sql.replace(/coalesce\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*''\s*\)/gi, "coalesce(CAST($1 AS text),'')");
}
