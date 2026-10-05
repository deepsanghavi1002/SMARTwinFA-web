import { orderByAliases, quotedAliases } from "../small-entry/text";

/** SQL text helpers of the report port that touch no database (tested in tests/report.test.mts). */

/** Lib_GlobalVariables.SmartVfaConstants.PCbook_*. */

/** Report_Combine.SetBooksValueInString: Lib_GlobalVariables.SmartVfaConstants.PCbook_*. */
const BOOKS: Readonly<Record<string, number>> = {
  GENLED: 1, DRSLED: 2, CRSLED: 3, CASH: 4, DIS: 5, BANK: 6, PETTYCASH: 7, SALE: 8, CASHSALE: 9, AGENCY: 10,
  DRNOTE: 11, PURCHRETN: 12, PURCH: 13, CASHPURCH: 14, EXPENSE: 15, CRNOTE: 16, SALERETN: 17, COMBINE: 18, JOURNAL: 19,
};

export function setBooksValueInString(source: string): string {
  return source.replace(/\|PCbook_([A-Z]+)\|/g, (whole, name: string) => (name in BOOKS ? String(BOOKS[name]) : whole));
}

/**
 * A setup SELECT written for SQL Server, as PostgreSQL must read it: single-quoted aliases become
 * names, the last ORDER BY names a quoted alias as it is spelt (ORDER BY VALUE_COL after AS "VALUE_COL"),
 * and SPACE(n) is REPEAT(' ', n).
 */
export function setupSelect(sql: string): string {
  let out = quotedAliases(sql).replace(/\bspace\s*\(/gi, "repeat(' ', ");
  const at = out.toLowerCase().lastIndexOf("order by");
  if (at >= 0 && !out.slice(at).includes(")")) out = `${out.slice(0, at)}ORDER BY ${orderByAliases(out, out.slice(at + 8).trim())}`;
  return out;
}

/**
 * A |sys.x| token as a quoted literal: the procedures put it in bare (SQL Server converts), and some
 * setup queries already wrap it in quotes ('|sys.tarikh1|'); either way it reads as one literal.
 */
export function literal(sql: string, token: string, value: string): string {
  const quoted = `'${value.replace(/'/g, "''")}'`;
  return sql.split(`'${token}'`).join(quoted).split(token).join(quoted);
}

/**
 * A setup SQL fragment as PostgreSQL must read it: |sys.db| is the company schema, and a money
 * column (alias.column) is read as numeric, as SQL Server lets money and numeric mix.
 */
export function pgFragment(sql: string, plan: Readonly<{ moneyColumns: readonly string[] }>, schema: string): string {
  let out = sql.split("|sys.db|").join(`${schema}.`);
  if (plan.moneyColumns.length > 0) {
    const pattern = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\.(${plan.moneyColumns.join("|")})\\b(?!\\s*::)`, "gi");
    out = out.replace(pattern, "$1.$2::numeric");
  }
  return out;
}
