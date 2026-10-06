import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import type { ResultRow } from "./call";
import { ResultTable } from "./call";
import { desktopDate, sqlLen, sqlServerCompare } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { budgetUse, planCash } from "./planning";
import type { BudgetUse, CashPlanning } from "./planning";
import { isNumberField, money, num, runReportSql } from "./run";

/**
 * Routines every report of the common Report_Combine program uses (reportStandard.ts for
 * SP_REPORT_STANDARD, reportFormating.ts for SP_REPORT_FORMATING, output.ts for what
 * Report_Combine does after them). A report's own branch only holds what is particular to it.
 */

// ---- Result tables ----

/** A result table with the columns (and number kinds) of a query's fields: SELECT ... INTO. */
export function tableFromFields(fields: readonly { name: string; dataTypeID: number }[]): ResultTable {
  const table = new ResultTable();
  for (const field of fields) {
    table.addColumn(field.name);
    if (isNumberField(field as never)) table.setKind(field.name, [20, 21, 23].includes(field.dataTypeID) ? "int" : "decimal");
  }
  return table;
}

/** A query's result as a table of its own rows. */
export function tableFromResult(result: Readonly<{ fields: readonly { name: string; dataTypeID: number }[]; rows: readonly ResultRow[] }>): ResultTable {
  const table = tableFromFields(result.fields);
  table.rows = result.rows.map((row) => ({ ...row }));
  return table;
}

/** sp_RENAME ... 'COLUMN': the column keeps its place and kind. */
export function renameColumn(table: ResultTable, from: string, to: string): void {
  const name = table.name(from);
  if (!name || name === to) return;
  table.columns[table.columns.indexOf(name)] = to;
  const kind = table.numberKinds.get(name);
  table.numberKinds.delete(name);
  if (kind) table.numberKinds.set(to, kind);
  for (const row of table.rows) { row[to] = row[name]; delete row[name]; }
}

/** ALTER TABLE ... DROP COLUMN, when the table has it. */
export function dropColumn(table: ResultTable, column: string): void {
  const name = table.name(column);
  if (!name) return;
  table.columns.splice(table.columns.indexOf(name), 1);
  table.numberKinds.delete(name);
  for (const row of table.rows) delete row[name];
}

/** INSERT that goes in ahead of the rows already there (the procedures' opening rows). */
export function insertFirst(table: ResultTable, values: Readonly<Record<string, unknown>>): ResultRow {
  const row = table.insert(values);
  table.rows.pop();
  table.rows.unshift(row);
  return row;
}

/**
 * The report system's own columns (fix_columns' names): never shown in the grid, whether the
 * setup lists them for the report or a procedure branch adds them (heading rows' codes ...).
 */
export const FIX_COLUMN_NAMES: ReadonlySet<string> = new Set([
  "SMART_LED_KEY", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_BOOK_CODE", "SMART_SCHEDULE_CODE", "SMART_PRODUCT_CODE",
  "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE", "SORTING_COL", "SORTING_DATE", "ROW_DATA_TYPE", "SYSTEM_BLANK2",
  "SMART_NAME", "SMART_SELECTED_BOOK", "SMART_SELECTED_SCHDULE", "SMART_SELECTED_PRODUCT",
  "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4",
]);

// ---- ORDER BY ----

export type SortKey = (row: ResultRow) => string | number | null;

/** A cell as an ORDER BY text key (NULL stays NULL). */
export const textKey = (value: unknown): string | null => (value === null || value === undefined ? null : toText(value));
/** A cell as an ORDER BY number key (NULL or blank stays NULL). */
export const numberKey = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : num(value));
/** RIGHT(SPACE(10) + doc_no, 10): voucher numbers compare right-aligned, as numbers do. */
export const rightAlignedKey = (value: unknown): string | null => (value === null || value === undefined ? null : `          ${toText(value)}`.slice(-10));

/** A stable ORDER BY over the keys: text in SQL Server's order (case ignored), NULL first. */
export function sortRows(table: ResultTable, keys: readonly SortKey[]): void {
  const indexed = table.rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    for (const key of keys) {
      const x = key(a.row);
      const y = key(b.row);
      if (x === y) continue;
      if (x === null) return -1;
      if (y === null) return 1;
      const order = typeof x === "number" && typeof y === "number" ? x - y : sqlServerCompare(String(x), String(y));
      if (order !== 0) return order;
    }
    return a.index - b.index;
  });
  table.rows = indexed.map((entry) => entry.row);
}

// ---- SQL text ----

/** SQL Server's REPLACE is case-insensitive under the database's collation. */
export const replaceCI = (source: string, find: string, replacement: string): string => source.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement);

/** FN_REMOVE_ALIASES: "bookmst.book_desc" -> "book_desc". */
export const removeAlias = (text: string): string => (text.includes(".") ? text.slice(text.indexOf(".") + 1) : text);

/** The procedures' |sys.sp.aentry| (an entry addon group) as the join the report wants. */
export const withEntryAddon = (sql: string, join: string): string => sql.split("|sys.sp.aentry|").join(join);

/** " GROUP BY a,b ORDER BY c" from the parts that are not blank (SP_REPORT_FORMATING's LBL_RESULT). */
export function groupOrderTail(groups: readonly string[], orders: readonly string[]): string {
  const group = groups.filter((part) => part.trim() !== "").join(",");
  const order = orders.filter((part) => part.trim() !== "").join(",");
  return `${group !== "" ? ` GROUP BY ${group}` : ""}${order !== "" ? ` ORDER BY ${order}` : ""}`;
}

/** The procedures' "Empty Conditions Found" check before a format's query runs. */
export function requireWhere(where: string): void {
  if (where.trim() === "") throw new ReportRefusal("ERROR NUMBER : 4 \nReport Generation Failed..\nEmpty Conditions Found.. ", "INTERNAL PROGRAM FAILURE");
}

// ---- Dates ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Three-letter month names, as DATENAME(MM, d) starts. */
export const MONTH_NAMES: readonly string[] = MONTHS;

/** convert(varchar(20), date, 103): dd/MM/yyyy. */
export function ddMmYyyy(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

/** The day before (DATEADD(dd, -1, date)). */
export const dayBefore = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);

/** A row's date text ("01-Apr-2026", "01-Apr-26" or dd/MM/yyyy) as a date, as Convert.ToDateTime reads it. */
export function parseRowDate(text: string): Date | null {
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text.trim());
  if (named) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === named[2].toLowerCase());
    if (month < 0) return null;
    return new Date(named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]), month, Number(named[1]));
  }
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return slashed ? new Date(Number(slashed[3]), Number(slashed[2]) - 1, Number(slashed[1])) : null;
}

/**
 * A format's period (SP_REPORT_FORMATING): the label column, and what the query groups and orders
 * on. DAILY is style 6 (DD-Mon-YY), a week runs Sunday to Saturday (DATEFIRST 7) shown as
 * dd/MM/yyyy To dd/MM/yyyy, 15 days are the 1st-15th and 16th-month end. The procedures group on
 * the year and month and order the label as text (a week starting in the previous month sorts
 * last, as on the desktop); the label is grouped on too, which SQL Server would have wanted.
 */
export function formatPeriod(format: string, date: string): { label: string; alias: string; group: string; order: string } | null {
  const d103 = (expr: string) => `to_char(${expr}, 'DD/MM/YYYY')`;
  const year = `EXTRACT(YEAR FROM ${date})`;
  const month = `EXTRACT(MONTH FROM ${date})`;
  switch (format) {
    case "DAILY": {
      const label = `to_char(${date}, 'DD-Mon-YY')`;
      return { label, alias: "SELECTED_DATE", group: `${year},${month},${d103(date)},${label}`, order: `${year},${month},${d103(date)} COLLATE "C"` };
    }
    case "WEEKLY": {
      const start = `(${date}::date - EXTRACT(DOW FROM ${date})::int)`;
      const label = `${d103(start)} || ' To ' || ${d103(`(${start} + 6)`)}`;
      return { label, alias: "SELECTED_DATE", group: `${year},${month},${label}`, order: `${year},${month},(${label}) COLLATE "C"` };
    }
    case "HALF_MONTH": {
      const first = `date_trunc('month', ${date})::date`;
      const label = `(case when EXTRACT(DAY FROM ${date}) <= 15 then ${d103(first)} || ' To ' || ${d103(`(${first} + 14)`)} else ${d103(`(${first} + 15)`)} || ' To ' || ${d103(`((${first} + interval '1 month')::date - 1)`)} end)`;
      return { label, alias: "selected_date", group: `${year},${month},${label}`, order: `${year},${month},${label} COLLATE "C"` };
    }
    case "QUATER_YEAR": {
      const label = `(case when ${month} between 1 and 3 then 'JAN - MAR' when ${month} between 4 and 6 then 'APR - JUN' when ${month} between 7 and 9 then 'JUL - SEP' when ${month} between 10 and 12 then 'OCT - DEC' end) || ' , ' || CAST(${year} AS varchar(4))`;
      return { label, alias: "SELECTED_DATE", group: `${year},${label}`, order: `${year},(${label}) COLLATE "C"` };
    }
    case "HALF_YEAR": {
      const label = `(case when ${month} between 4 and 9 then 'APR - SEP' else 'OCT - MAR' end)`;
      return { label, alias: "SELECTED_DATE", group: label, order: `${label} COLLATE "C"` };
    }
    default:
      return null;
  }
}

/** A format the procedure does not know: its error row. */
export function unknownFormat(format: string): ReportRefusal {
  return new ReportRefusal(format !== "" ? `${format} NOT FOUND PLEASE CHECK IT ` : " BLANK STRING FROM SYSTEM FOR FORMATING PLEASE CHECK ", "INTERNAL PROGRAM FAILURE");
}

// ---- Groups as headings ----

/**
 * FN_GETFIXCOLNAMEFOR: for a ticked group's run select (ac.name, bookmst.book_desc, bs.bs_desc,
 * adata.txt_AREA ...), the fix columns its heading rows fill and their values, and the heading's
 * ROW_DATA_TYPE. The account carries its book too (reports 1, 3, 4, 6, 38); an addon is numbered
 * by the caller (ADDON_1_CODE ...). Null when the group is none of these.
 */
export function groupHeadingColumns(group: string, addonNumber: number): { columns: string[]; values: string[]; rowType: string; addon: boolean } | null {
  const bare = removeAlias(group).toUpperCase();
  const alias = group.includes(".") ? group.slice(0, group.indexOf(".")) : "";
  switch (bare) {
    case "NAME": return { columns: ["SMART_AC_CODE", "BOOK"], values: ["AC.CODE", "ac.book"], rowType: "AC", addon: false };
    case "BOOK_DESC": return { columns: ["SMART_BOOK_CODE"], values: ["BOOKMST.BOOK_KEY"], rowType: "BOOK", addon: false };
    case "BS_DESC": return { columns: ["SMART_SCHEDULE_CODE"], values: ["BS.BS_KEY"], rowType: "SCHEDULE", addon: false };
  }
  if (bare.includes("TXT_")) return { columns: [`ADDON_${addonNumber}_CODE`], values: [`${alias}.KEY_${bare.replace("TXT_", "")}`], rowType: `ADDON_${addonNumber}`, addon: true };
  return null;
}

/** The procedures' error when a group has no fix columns. */
export const groupFailed = (): ReportRefusal => new ReportRefusal("Finding Selected Group Failed\nPlease Check Function_FIX In Database", "INTERNAL PROGRAM FAILURE");

/** The column a group fills on its heading and voucher rows (CASE ... WHEN 'BOOK_DESC' THEN 'SMART_SELECTED_BOOK' ...). */
export function groupSmartColumn(group: string, addonNumber: number): string {
  switch (removeAlias(group).toUpperCase()) {
    case "NAME": return "SMART_NAME";
    case "BOOK_DESC": return "SMART_SELECTED_BOOK";
    case "BS_DESC": return "SMART_SELECTED_SCHDULE";
    case "": return "";
    default: return `SMART_SELECTED_ADDON${addonNumber + 1}`;
  }
}

/** The ticked groups' run selects ("ac.name,bookmst.book_desc,") as a list. */
export const groupList = (unionGroups: string): string[] => unionGroups.split(",").map((part) => part.trim()).filter((part) => part !== "");

// ---- Narration ----

/**
 * A narration as the procedures cut it into rows of 40 characters (SUBSTRING(text, 1, 40),
 * '\' + SUBSTRING(text, 41, 40) ...). The first piece has the "\" only when `firstMarked` (the
 * text does not already start with one); a piece after the first comes only while LEN(text) runs
 * past it; with `lastUnbounded` the last piece takes all that is left.
 */
export function narrationPieces(text: string, options: Readonly<{ count: number; firstMarked: boolean; lastUnbounded: boolean }>): string[] {
  const pieces: string[] = [];
  for (let chunk = 0; chunk < options.count; chunk += 1) {
    const start = chunk * 40;
    if (chunk > 0 && sqlLen(text) <= start) break;
    const piece = options.lastUnbounded && chunk === options.count - 1 ? text.slice(start) : text.slice(start, start + 40);
    pieces.push(chunk > 0 || options.firstMarked ? `\\${piece}` : piece);
  }
  return pieces;
}

// ---- Cash, discount and bank books ----

/** The day book's two amount columns as the procedures name them for the account's book. */
export function cashBookColumns(book: number): [string, string] {
  return book === 5 ? ["GIVEN", "TAKEN"] : book === 6 ? ["DEPOSIT", "WITHDRAWAL"] : ["RECEIPT", "PAYMENT"];
}

// ---- Planning (cash and bank books) ----

export { planCash };
export type { CashPlanning };

/**
 * The planning figures of the day book's account (Report_Combine's output step, key 1): the year's
 * opening, each month's receipts and payments up to the Upto date, the last 30 days' payments, the
 * account's limit and the interest entries of the period. Read from the ledger, whatever filter the
 * grid has, so the position is the account's own.
 */
export async function readCashPlanning(loader: Loader, plan: ReportPlan): Promise<CashPlanning | null> {
  const { call } = plan;
  const code = Number(call.fcValue);
  if (!Number.isInteger(code) || code <= 0 || ![4, 5, 6].includes(call.book)) return null;
  const db = call.database;
  const day = (date: Date) => `'${desktopDate(date)}'`;
  const upto = call.upto;
  const window = new Date(upto.getFullYear(), upto.getMonth(), upto.getDate() - 29);
  const account = (await runReportSql(loader, `SELECT name, "LIMIT"::numeric AS lim FROM ${db}account WHERE code = $1`, [code])).rows[0];
  const opening = money(num((await runReportSql(loader, `SELECT opening::numeric AS opening FROM ${db}AC_BALANCE WHERE code = $1 AND year_id = $2 AND a_recflag = 'AC' LIMIT 1`, [code, call.yearId])).rows[0]?.opening));
  const months = (await runReportSql(loader, `SELECT to_char(doc_date, 'YYYY-MM') AS month, SUM(CASE WHEN bk_dbcode = 1 THEN amount::numeric ELSE 0 END) AS receipts, SUM(CASE WHEN bk_dbcode = 2 THEN amount::numeric ELSE 0 END) AS payments FROM ${db}ledger WHERE book_code = $1 AND doc_pos <> 'D' AND doc_date BETWEEN ${day(call.tarikh1)} AND ${day(upto)} GROUP BY 1 ORDER BY 1`, [code])).rows
    .map((row) => ({ month: String(row.month), receipts: money(num(row.receipts)), payments: money(num(row.payments)) }));
  const recent = num((await runReportSql(loader, `SELECT COALESCE(SUM(amount::numeric), 0) AS pay FROM ${db}ledger WHERE book_code = $1 AND doc_pos <> 'D' AND bk_dbcode = 2 AND doc_date BETWEEN ${day(window)} AND ${day(upto)}`, [code])).rows[0]?.pay);
  const interest = num((await runReportSql(loader, `SELECT COALESCE(SUM(led.amount::numeric), 0) AS interest FROM ${db}ledger led JOIN ${db}account ac ON ac.code = led.code WHERE led.book_code = $1 AND led.doc_pos <> 'D' AND led.bk_dbcode = 2 AND led.doc_date BETWEEN ${day(call.from)} AND ${day(upto)} AND ac.name ILIKE '%interest%' AND ac.name NOT ILIKE '%tds%' AND ac.name NOT ILIKE '%tcs%'`, [code])).rows[0]?.interest);
  // Nothing paid in the last 30 days: the average is over the year so far instead.
  const yearDays = Math.max(1, Math.round((Date.UTC(upto.getFullYear(), upto.getMonth(), upto.getDate()) - Date.UTC(call.tarikh1.getFullYear(), call.tarikh1.getMonth(), call.tarikh1.getDate())) / 86400000) + 1);
  const paidThisYear = months.reduce((sum, item) => sum + item.payments, 0);
  const useYear = recent === 0 && paidThisYear > 0;
  return planCash({ account: toText(account?.name), book: call.book, asOf: desktopDate(upto), opening, months, recentPayments: useYear ? paidThisYear : recent, windowDays: useYear ? yearDays : 30, limit: num(account?.lim), interest });
}

/**
 * Budget against actual for the accounts the report was run for (Report_Combine's output step).
 * Only debtors and creditors carry a budget (account master). What an account did is worked out as
 * the budget report (42) does: a debtor's sales (books 8 and 16, debits less credits), a creditor's
 * purchases (books 13 and 11, credits less debits), within the report's From and Upto dates.
 * Null when no account was ticked (the report was not run for accounts).
 */
export async function readBudgetUse(loader: Loader, plan: ReportPlan): Promise<BudgetUse[] | null> {
  const { call } = plan;
  const codes = [...call.selectKey[4].matchAll(/-?\d+/g)].map((match) => Number(match[0])).filter((code) => Number.isInteger(code) && code > 0);
  if (codes.length === 0) return null;
  const db = call.database;
  const day = (date: Date) => `'${desktopDate(date)}'`;
  const accounts = (await runReportSql(loader, `SELECT code, name, book, budget::numeric AS budget FROM ${db}account WHERE code = ANY($1::int[]) AND book IN (2, 3) AND a_pos <> 'D' AND budget::numeric <> 0 ORDER BY name`, [codes])).rows;
  if (accounts.length === 0) return [];
  const actuals = new Map((await runReportSql(loader, `SELECT led.code, SUM(CASE WHEN ac.book = 2 THEN (CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE -led.amount::numeric END) ELSE (CASE WHEN led.ac_dbcode = 2 THEN led.amount::numeric ELSE -led.amount::numeric END) END) AS actual`
    + ` FROM ${db}ledger led JOIN ${db}account ac ON ac.code = led.code WHERE led.code = ANY($1::int[]) AND led.doc_pos <> 'D' AND led.doc_date BETWEEN ${day(call.from)} AND ${day(call.upto)}`
    + ` AND ((ac.book = 2 AND led.book IN (8, 16)) OR (ac.book = 3 AND led.book IN (13, 11))) GROUP BY led.code`, [accounts.map((account) => Number(account.code))])).rows.map((row) => [Number(row.code), num(row.actual)]));
  return accounts.map((account) => budgetUse({ code: Number(account.code), name: toText(account.name), book: Number(account.book), budget: num(account.budget), actual: actuals.get(Number(account.code)) ?? 0 }));
}
