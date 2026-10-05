import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate, sqlServerCompare } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { isNumberField, money, num, runReportSql } from "./run";

/**
 * SP_REPORT_FORMATING, report 4 (the main ledger's formats), lines 2127-2336 of the SQL Server
 * procedure, with the procedure's common tail (LBL_RESULT) that adds FROM, WHERE, GROUP BY and
 * ORDER BY to the format's select.
 *
 * DAILY, WEEKLY, HALF_MONTH (15 days), QUATER_YEAR, HALF_YEAR and SUMMARY are one grouped query
 * each: a row per account and period with its debits and credits. MONTHLY builds its own table (an
 * account heading, the opening, and a row per month with the closing up to that month's end).
 * SPC_SUMMARY is SP_LEDGER_SPCL_SUMMARY_REPORT: the selected postings by the voucher's party,
 * book and schedule.
 *
 * The SQL Server date expressions are written in PostgreSQL with the same results: style 103 is
 * DD/MM/YYYY, style 6 is DD-Mon-YY, a week runs Sunday to Saturday (DATEFIRST 7).
 */

export async function ledgerFormatted(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const format = call.formating;
  const csFrom = call.from_.split("|sys.sp.aentry|").join(`left join ${db}addon_aentry aentry on led.led_key=aentry.aona_ledid`);
  const where = call.where.split("|sys.yearid|").join(call.yearId);

  if (format === "MONTHLY") return monthly(loader, plan, where);

  let groupBy = call.groupBy;
  let orderBy = call.orderBy;
  let sql: string;
  let extraGroup = "";
  let extraOrder = "";
  const date = call.dateField;
  const sums = "sum(case when ledpost.post_dbcode = 1 then ledpost.post_amt else 0.00 end) as \"DEBIT\",sum(case when ledpost.post_dbcode = 2 then ledpost.post_amt else 0.00 end) as \"CREDIT\",0.00 as \"CLOSING_BAL\",'' as \"DR_CR\"";
  const d103 = (expr: string) => `to_char(${expr}, 'DD/MM/YYYY')`;
  switch (format) {
    case "DAILY": {
      const label = `to_char(${date}, 'DD-Mon-YY')`;
      sql = `${label} AS "SELECTED_DATE",${sums}`;
      extraGroup = `EXTRACT(YEAR FROM ${date}),EXTRACT(MONTH FROM ${date}),${d103(date)},${label}`;
      extraOrder = `EXTRACT(YEAR FROM ${date}),EXTRACT(MONTH FROM ${date}),${d103(date)} COLLATE "C"`;
      break;
    }
    case "WEEKLY": {
      const start = `(${date}::date - EXTRACT(DOW FROM ${date})::int)`;
      const label = `${d103(start)} || ' To ' || ${d103(`(${start} + 6)`)}`;
      sql = `${label} as "SELECTED_DATE", ${sums}`;
      extraGroup = `EXTRACT(YEAR FROM ${date}),EXTRACT(MONTH FROM ${date}),${label}`;
      extraOrder = `EXTRACT(YEAR FROM ${date}),EXTRACT(MONTH FROM ${date}),(${label}) COLLATE "C"`;
      break;
    }
    case "HALF_MONTH": {
      const first = `date_trunc('month', ${date})::date`;
      const label = `(case when EXTRACT(DAY FROM ${date}) <= 15 then ${d103(first)} || ' To ' || ${d103(`(${first} + 14)`)} else ${d103(`(${first} + 15)`)} || ' To ' || ${d103(`((${first} + interval '1 month')::date - 1)`)} end)`;
      sql = `${label} as "selected_date",${sums}`;
      extraGroup = `EXTRACT(YEAR FROM ${date}),EXTRACT(MONTH FROM ${date}),${label}`;
      extraOrder = `EXTRACT(YEAR FROM ${date}),EXTRACT(MONTH FROM ${date}),${label} COLLATE "C"`;
      break;
    }
    case "QUATER_YEAR": {
      const label = `(case when EXTRACT(MONTH FROM ${date}) between 1 and 3 then 'JAN - MAR' when EXTRACT(MONTH FROM ${date}) between 4 and 6 then 'APR - JUN' when EXTRACT(MONTH FROM ${date}) between 7 and 9 then 'JUL - SEP' when EXTRACT(MONTH FROM ${date}) between 10 and 12 then 'OCT - DEC' end) || ' , ' || CAST(EXTRACT(YEAR FROM ${date}) AS varchar(4))`;
      sql = `${label} as "SELECTED_DATE",${sums}`;
      extraGroup = `EXTRACT(YEAR FROM ${date}),${label}`;
      extraOrder = `EXTRACT(YEAR FROM ${date}),(${label}) COLLATE "C"`;
      break;
    }
    case "HALF_YEAR": {
      const label = `(case when EXTRACT(MONTH FROM ${date}) between 4 and 9 then 'APR - SEP' else 'OCT - MAR' end)`;
      sql = `${label} as "SELECTED_DATE",${sums}`;
      extraGroup = label;
      extraOrder = `${label} COLLATE "C"`;
      break;
    }
    case "SUMMARY":
      sql = `'${toDdMmYyyy(call.from)}' || ' TO ' || '${toDdMmYyyy(call.upto)}' as "SELECTED_DATE",${sums}`;
      break;
    case "SPC_SUMMARY":
      return special(loader, plan, where);
    default:
      throw new ReportRefusal(format !== "" ? `${format} NOT FOUND PLEASE CHECK IT ` : " BLANK STRING FROM SYSTEM FOR FORMATING PLEASE CHECK ", "INTERNAL PROGRAM FAILURE");
  }
  let select = call.queryStart.trim();
  if (select !== "") {
    if (!select.toUpperCase().includes("AC.NAME")) select = `AC.NAME,${select}`;
    sql = ` SELECT ${sql},${select}`;
  } else {
    sql = ` SELECT AC.NAME,${sql}`;
  }
  if (!groupBy.toUpperCase().includes("AC.NAME")) groupBy = groupBy.trim() !== "" ? `${groupBy},AC.NAME` : "AC.NAME";
  if (!orderBy.toUpperCase().includes("AC.NAME")) orderBy = orderBy.trim() !== "" ? `${orderBy},AC.NAME` : "AC.NAME";
  if (where.trim() === "") throw new ReportRefusal("ERROR NUMBER : 4 \nReport Generation Failed..\nEmpty Conditions Found.. ", "INTERNAL PROGRAM FAILURE");
  sql += `${csFrom}${where}`;
  sql += extraGroup !== "" ? ` GROUP BY ${groupBy},${extraGroup}` : ` GROUP BY ${groupBy}`;
  sql += extraOrder !== "" ? ` ORDER BY ${orderBy},${extraOrder}` : ` ORDER BY ${orderBy}`;
  return tableOf(await runReportSql(loader, frag(sql)));
}

/** convert(varchar(20), date, 103). */
function toDdMmYyyy(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function tableOf(result: Awaited<ReturnType<typeof runReportSql>>): ResultTable {
  const table = new ResultTable();
  for (const field of result.fields) {
    table.addColumn(field.name);
    if (isNumberField(field)) table.setKind(field.name, [20, 21, 23].includes(field.dataTypeID) ? "int" : "decimal");
  }
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) if (table.has(column)) table.setKind(column, "decimal");
  table.rows = result.rows.map((row) => ({ ...row }));
  return table;
}

/**
 * MONTHLY: TEMP_TABLE_LEDGER1 with an account heading (H), its opening (O) and a row per month that
 * has postings (P), each month's closing being the opening plus everything posted before the next
 * month. The From date must be the year's start. Accounts with nothing but the heading go.
 */
async function monthly(loader: Loader, plan: ReportPlan, where: string): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  if (desktopDate(call.from) !== desktopDate(call.tarikh1)) throw new ReportRefusal("MONTHLY REPORT BETWEEN DATE NOT ALLOWED PLEASE SELECT FROM DATE LIKE YEAR START DATE ", "INTERNAL PROGRAM FAILURE");
  const keys = call.selectKey[4];
  if (keys === "") throw new ReportRefusal("Month format needs the accounts ticked (Account group)", "INTERNAL PROGRAM FAILURE");
  // Credit Only / Debit Only: the procedure leaves the other column out and its INSERT fails
  // ("Column name or number of supplied values does not match"). Here that column shows 0.00
  // and the closing stays the account's balance.
  const onlySide = /ledpost\.POST_DBCODE = 1/i.test(where) ? 1 : /ledpost\.POST_DBCODE = 2/i.test(where) ? 2 : 0;

  const table = new ResultTable();
  for (const column of ["SORTING_COL", "ROW_DATA_TYPE", "SMART_NAME", "PARTICULARS", "DEBIT", "CREDIT", "CLOSINGS", "DR_CR"]) table.addColumn(column);
  for (const column of ["DEBIT", "CREDIT", "CLOSINGS"]) table.setKind(column, "decimal");

  for (const row of (await runReportSql(loader, `SELECT DISTINCT ac.name FROM ${db}ACCOUNT AC WHERE ac.a_pos <> 'D' AND ac.code IN ${keys}`)).rows) {
    table.insert({ SORTING_COL: row.name === null ? null : `${row.name}  H`, ROW_DATA_TYPE: "AC", SMART_NAME: row.name, PARTICULARS: row.name, DR_CR: "" });
  }
  for (const row of (await runReportSql(loader, `SELECT ac.name, coalesce(acbal.opening::numeric, 0.00) AS opening FROM ${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ac.Code = ACBAL.CODE WHERE ac.a_pos <> 'D' AND ac.code IN ${keys} AND acbal.opening::numeric <> 0`)).rows) {
    const opening = num(row.opening);
    // The procedure puts a credit opening in CREDIT as it is: a negative amount.
    table.insert({ SORTING_COL: row.name === null ? null : `${row.name}  O`, ROW_DATA_TYPE: "OPENINGS", SMART_NAME: row.name, PARTICULARS: "Opening", DEBIT: opening > 0 ? opening : 0, CREDIT: opening < 0 ? opening : 0, CLOSINGS: opening, DR_CR: "" });
  }

  const tarikh1 = desktopDate(call.tarikh1);
  const tarikh2 = desktopDate(call.tarikh2);
  for (let month = new Date(call.from.getFullYear(), call.from.getMonth(), 1); month <= call.upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
    const monthNo = month.getMonth() + 1;
    const next = desktopDate(new Date(month.getFullYear(), month.getMonth() + 1, 1));
    const inMonth = `EXTRACT(MONTH FROM ${call.dateField}) = ${monthNo}`;
    const closing = month.getTime() === new Date(call.tarikh1.getFullYear(), call.tarikh1.getMonth(), 1).getTime() && call.tarikh1.getDate() === 1
      ? `coalesce(acbal.opening::numeric,0.00) + coalesce(SUM(case when ledpost.POST_DBCODE = 1 and ${inMonth} then ledpost.post_amt end),0.00) - coalesce(SUM(case when ledpost.POST_DBCODE = 2 and ${inMonth} then ledpost.post_amt end),0.00)`
      : `coalesce(acbal.opening::numeric,0.00) + coalesce((select SUM(case when ledpost1.POST_DBCODE = 1 then ledpost1.post_amt::numeric else 0.00 end) from ${db}LEDGER_POST ledpost1 where ledpost1.post_code = ledpost.post_code and ledpost1.post_date < '${next}'),0.00) - coalesce((select SUM(case when ledpost1.POST_DBCODE = 2 then ledpost1.post_amt::numeric else 0.00 end) from ${db}LEDGER_POST ledpost1 where ledpost1.post_code = ledpost.post_code and ledpost1.post_date < '${next}'),0.00)`;
    const sql = `SELECT ac.name || '  P' || to_char(led.doc_date, 'YYYYMM') || ' ' || CAST(ledpost.post_code AS varchar(18)) AS "SORTING_COL", ac.name AS "SMART_NAME", to_char(led.doc_date, 'FMMonth') AS "PARTICULARS"`
      + (onlySide === 2 ? `, 0.00 AS "DEBIT"` : `, coalesce(SUM(case when ledpost.POST_DBCODE = 1 and ${inMonth} then ledpost.post_amt end),0.00) AS "DEBIT"`)
      + (onlySide === 1 ? `, 0.00 AS "CREDIT"` : `, coalesce(SUM(case when ledpost.POST_DBCODE = 2 and ${inMonth} then ledpost.post_amt end),0.00) AS "CREDIT"`)
      + `, ${closing} AS "CLOSINGS"`
      + ` FROM ${db}LEDGER_POST ledpost LEFT JOIN ${db}LEDGER LED ON ledpost.LED_ID = LED.LED_KEY LEFT JOIN ${db}ACCOUNT AC ON ac.Code = ledpost.POST_CODE AND AC.A_POS <> 'D' LEFT JOIN ${db}AC_BALANCE ACBAL ON ACBAL.CODE = AC.CODE`
      + ` WHERE led.doc_pos <> 'D' AND ac.a_pos <> 'D' AND led.DOC_POSTING = 'P' AND led.doc_date BETWEEN '${tarikh1}' AND '${tarikh2}' AND ${inMonth} AND ledpost.post_code IN ${keys}`
      + ` GROUP BY ac.name, to_char(led.doc_date, 'FMMonth'), to_char(led.doc_date, 'YYYYMM'), acbal.opening, ledpost.post_code`;
    for (const row of (await runReportSql(loader, frag(sql))).rows) {
      table.insert({ SORTING_COL: row.SORTING_COL, ROW_DATA_TYPE: "LED", SMART_NAME: row.SMART_NAME, PARTICULARS: row.PARTICULARS, DEBIT: num(row.DEBIT), CREDIT: num(row.CREDIT), CLOSINGS: money(num(row.CLOSINGS)), DR_CR: "" });
    }
  }
  // An account with only its heading goes; every other row says DR or CR from its closing.
  const counts = new Map<string, number>();
  for (const row of table.rows) counts.set(toText(row.SMART_NAME), (counts.get(toText(row.SMART_NAME)) ?? 0) + 1);
  table.rows = table.rows.filter((row) => counts.get(toText(row.SMART_NAME)) !== 1);
  for (const row of table.rows) if (row.ROW_DATA_TYPE !== "AC") row.DR_CR = num(row.CLOSINGS) < 0 ? "CR" : "DR";
  const indexed = table.rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => sqlServerCompare(a.row.SORTING_COL as string | null, b.row.SORTING_COL as string | null) || a.index - b.index);
  table.rows = indexed.map((entry) => entry.row);
  return table;
}

/**
 * SP_LEDGER_SPCL_SUMMARY_REPORT: by the voucher's party with its book (Book group ticked), its
 * schedule (Schedule group), or both. Without either the procedure returns its error row.
 */
async function special(loader: Loader, plan: ReportPlan, where: string): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const groups = call.groupBy.toUpperCase();
  const type = groups.includes("BOOK_DESC") && groups.includes("BS_DESC") ? 3 : groups.includes("BS_DESC") ? 2 : groups.includes("BOOK_DESC") ? 1 : 0;
  if (type === 0) throw new ReportRefusal("Error No :  \nInternal program failure", "INTERNAL PROGRAM FAILURE");
  const from = ` from ((${db}LEDGER_POST ledpost left join ${db}LEDGER LED on ledpost.LED_ID = LED.LED_KEY) left join ${db}ACCOUNT AC on led.CODE = Ac.Code AND AC.A_POS <> 'D')`;
  const sums = `sum(case when ledpost.post_dbcode = 1 then ledpost.post_amt else 0.00 end) as "DEBIT",sum(case when ledpost.post_dbcode = 2 then ledpost.post_amt else 0.00 end) as "CREDIT"`;
  const bookName = `(SELECT T1.NAME FROM ${db}ACCOUNT T1 WHERE T1.Code = LED.BOOK_CODE)`;
  const schedule = (column: string) => `(SELECT BS.${column} FROM ${db}BALSHEET BS WHERE BS.BS_KEY IN (SELECT AC1.BS_ID FROM ${db}ACCOUNT AC1 WHERE AC1.Code = LED.BOOK_CODE) LIMIT 1)`;
  let sql: string;
  if (type === 1) {
    sql = `SELECT LED.BOOK_CODE AS "LED_BOOK_CODE",AC.NAME,${bookName} AS "SELECTED_BOOK",${sums},CAST(0.00 AS NUMERIC(18,2)) AS "CLOSING_BAL",CAST('' AS VARCHAR(3)) AS "DR_CR"${from} ${where} GROUP BY AC.NAME,LED.BOOK_CODE ORDER BY AC.NAME,"SELECTED_BOOK"`;
  } else if (type === 2) {
    sql = `WITH REC_CTE AS (SELECT (SELECT AC1.BS_ID FROM ${db}ACCOUNT AC1 WHERE AC1.Code = LED.BOOK_CODE) AS "BS_ID",${schedule("BS_DESC")} AS "SCHD",${schedule("BS_CODE")} AS "SCHD_CODE",AC.NAME,${sums}${from} ${where} GROUP BY AC.NAME,LED.BOOK_CODE,AC.Code)`
      + ` SELECT RC.NAME,COALESCE(RC."SCHD",'N/A') AS "SELECTED_SCHEDULE",SUM(RC."DEBIT") AS "DEBIT",SUM(RC."CREDIT") AS "CREDIT",CAST(0.00 AS NUMERIC(18,2)) AS "CLOSING_BAL",CAST('' AS VARCHAR(3)) AS "DR_CR" FROM REC_CTE RC GROUP BY RC."BS_ID",RC."SCHD",RC."SCHD_CODE",RC.NAME ORDER BY RC.NAME,RC."SCHD_CODE"`;
  } else {
    sql = `SELECT AC.NAME,${bookName} AS "SELECTED_BOOK",COALESCE(${schedule("BS_DESC")},'N/A') AS "SELECTED_SCHEDULE",${schedule("BS_CODE")} AS "SCHD_CODE",${sums},CAST(0.00 AS NUMERIC(18,2)) AS "CLOSING_BAL",CAST('' AS VARCHAR(3)) AS "DR_CR"${from} ${where} GROUP BY AC.NAME,LED.BOOK_CODE,AC.Code ORDER BY AC.NAME,"SELECTED_BOOK","SCHD_CODE"`;
  }
  return tableOf(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
}
