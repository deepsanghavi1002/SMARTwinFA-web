import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { cashBookColumns, dayBefore, ddMmYyyy, formatPeriod, groupOrderTail, insertFirst, MONTH_NAMES, requireWhere, sortRows, tableFromResult, textKey, unknownFormat, withEntryAddon } from "./library";
import { cashBookFrom, cashBookOpening } from "./reportStandard";
import { money, num, runReportSql } from "./run";

/**
 * SP_REPORT_FORMATING: a report's formats (Month, Daily, Weekly, 15 Days, Quarter, Half Year,
 * Summary ...), one branch per report key as in the SQL Server procedure, each finished by the
 * procedure's common tail (LBL_RESULT) that adds FROM, WHERE, GROUP BY and ORDER BY to the
 * format's select. The periods' SQL is shared (library.formatPeriod).
 *
 * Ported branches: 1 (day book), 4 (ledger), 42 (budget).
 */
export async function formattedReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  switch (plan.call.reportKey) {
    case 1: return daybookFormats(loader, plan);
    case 4: return ledgerFormats(loader, plan);
    case 42: return budget(loader, plan);
    default: throw new ReportRefusal(`Report ${plan.call.reportKey}'s formats are not available in the web version yet.`, "Not ported yet");
  }
}

// ======================================================================================
// 1: DAYBOOK (lines 247-778)
// ======================================================================================
//
// A row per period with what came in and went out; with no group and an opening, an "Opening
// Balance B/d" row heads them. SUMMARY is one row for the whole period. MONTHLY is one row with a
// pair of columns per month and the year's totals (the opening in them).
//
// Where the desktop's figures come out wrong they are put right here, and only there:
//  - a credit (negative) opening went into PAYMENT / TOTAL_WITHDRAWAL as a negative amount, which
//    turned the running balance's sign; here it goes in as the amount paid out.
//  - Weekly and 15 Days took the opening up to the start of the first period, not up to From, so the
//    vouchers between the two were in neither; here the opening runs to the day before From.
//  - Month stepped from the From day (15/Apr to 10/Oct gave no October); here every month the
//    period touches has its columns.
//  - with a group, Daily / Weekly ... named ac.name without grouping on it (SQL Server refuses) and
//    Month added the opening to every group's row; here the group's name is grouped on and the
//    book's opening is left out, as Detail does with a group.

async function daybookFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const csFrom = cashBookFrom(plan);
  const where = call.where;
  const format = call.formating;
  const book = call.book;
  if (book !== 4 && book !== 5 && book !== 6) throw new ReportRefusal(`${format} is only for a cash, discount or bank account`, "INTERNAL PROGRAM FAILURE");
  const [inCol, outCol] = cashBookColumns(book);
  const opening = call.filterText.toUpperCase() === "NONE" ? await cashBookOpening(loader, plan, csFrom, dayBefore(call.from)) : 0;
  if (format === "MONTHLY") return daybookMonthly(loader, plan, csFrom, opening);

  const selectStart = call.queryStart.trim();
  const csGroup = call.groupBy.trim();
  const csOrder = call.orderBy.trim();
  const nameLead = csGroup !== "" ? `ac.name as "NAME",` : "";
  // With no group at all the opening heads the periods, in a NAME column of its own.
  const openingRow = selectStart === "" && csGroup === "" && opening !== 0 && format !== "SUMMARY";
  const blankName = openingRow ? `,CAST('' as VARCHAR) AS "NAME"` : "";
  const sums = (zero: string, cc: boolean) => `sum(case when led.bk_dbcode=1 then LED.AMOUNT else ${zero} end) as "${inCol}",sum(case when led.bk_dbcode=2 then LED.AMOUNT else ${zero} end) as "${outCol}",0.00 as "CLOSING_BAL",'' as "DR_CR"${cc ? `,0.00 AS "CC_AMT"` : ""}`;

  let body: string;
  let periodGroup = "";
  let periodOrder = "";
  const period = formatPeriod(format, call.dateField);
  if (period) {
    body = `${nameLead}${period.label} AS "${period.alias}"${blankName},${sums(format === "QUATER_YEAR" ? "0" : "0.00", format === "DAILY")}`;
    periodGroup = period.group;
    periodOrder = period.order;
  } else if (format === "SUMMARY") {
    body = `${csGroup.toUpperCase().includes("NAME") ? `ac.name as "NAME",` : ""}${sums("0.00", false)}`;
  } else {
    throw unknownFormat(format);
  }
  requireWhere(where);

  // With no group and an opening (not Summary): TEMP_TABLE_DAYBOOK1, the opening row then the periods.
  if (openingRow) {
    const table = tableFromResult(await runReportSql(loader, frag(`SELECT ${body} ${csFrom} ${where}${groupOrderTail([periodGroup], [periodOrder])}`)));
    insertFirst(table, { SELECTED_DATE: "", NAME: "Opening Balance B/d", [inCol]: opening > 0 ? opening : 0, [outCol]: opening < 0 ? Math.abs(opening) : 0, CLOSING_BAL: 0, DR_CR: "", CC_AMT: 0 });
    return table;
  }
  const select = selectStart !== "" ? `SELECT ${body},${selectStart}` : `SELECT ${body}`;
  return tableFromResult(await runReportSql(loader, frag(`${select} ${csFrom} ${where}${groupOrderTail([csGroup, periodGroup], [csOrder, periodOrder])}`)));
}

/**
 * MONTHLY: one row (or one per group) with each month's deposits and withdrawals, then the totals
 * with the opening in them. Payment Only / Receipt Only leave out the other side's columns; Show
 * Closing Balance (CHK_SOCBM) adds a closing and DR/CR column per month, left at 0.
 */
async function daybookMonthly(loader: Loader, plan: ReportPlan, csFrom: string, opening: number): Promise<ResultTable> {
  const { call } = plan;
  const date = call.dateField;
  const where = call.where;
  const withDeposit = !/led\.bk_dbcode=2/i.test(where);
  const withWithdrawal = !/led\.bk_dbcode=1/i.test(where);
  const selectStart = call.queryStart.trim();
  const csGroup = call.groupBy.trim();
  const csOrder = call.orderBy.trim();
  const totalOpening = selectStart === "" && csGroup === "" ? opening : 0;
  const columns: string[] = [];
  for (let month = new Date(call.from.getFullYear(), call.from.getMonth(), 1); month <= call.upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
    const name = MONTH_NAMES[month.getMonth()];
    const inMonth = `EXTRACT(MONTH FROM ${date}) = ${month.getMonth() + 1}`;
    if (withDeposit) columns.push(`coalesce(SUM(case when led.BK_DBCODE=1 and ${inMonth} then led.AMOUNT end),0.00) as "${name} DEPOSIT"`);
    if (withWithdrawal) columns.push(`coalesce(SUM(case when led.BK_DBCODE=2 and ${inMonth} then led.AMOUNT end),0.00) as "${name} WITHDRAWAL"`);
    if (call.closingNeeded) columns.push(`0.00 as "${name} CLOSING_BAL"`, `' ' as "${name} DR_CR"`);
  }
  if (withDeposit) columns.push(`coalesce(SUM(case when led.BK_DBCODE=1 then led.AMOUNT end),0.00)${totalOpening > 0 ? ` + ${totalOpening.toFixed(2)}` : ""} as "TOTAL_DEPOSIT"`);
  if (withWithdrawal) columns.push(`coalesce(SUM(case when led.BK_DBCODE=2 then led.AMOUNT end),0.00)${totalOpening < 0 ? ` + ${Math.abs(totalOpening).toFixed(2)}` : ""} as "TOTAL_WITHDRAWAL"`);
  if (call.closingNeeded) columns.push(`0.00 as "TOTAL_CLOSINGS"`, `CAST('' AS VARCHAR(2)) AS "TOT._DR_CR"`);
  const list = columns.join(",");
  const select = selectStart !== "" ? `SELECT ${list},${selectStart}`
    : opening !== 0 && csGroup === "" ? `SELECT ${opening.toFixed(2)} AS "OPENING_BAL",${list}`
    : csGroup !== "" ? `SELECT ac.name as "NAME",${list}`
    : `SELECT ${list}`;
  requireWhere(where);
  // The group's NAME (ac.name) is grouped on too when it heads the select.
  const groupBy = csGroup !== "" && selectStart === "" && !csGroup.toLowerCase().includes("ac.name") ? `${csGroup},ac.name` : csGroup;
  return tableFromResult(await runReportSql(loader, pgFragment(`${select} ${csFrom} ${where}${groupOrderTail([groupBy], [csOrder])}`, plan, loader.session.companySchema)));
}

// ======================================================================================
// 4: LEDGER (lines 2127-2336)
// ======================================================================================
//
// DAILY ... SUMMARY are one grouped query each: a row per account and period with its debits and
// credits. MONTHLY builds its own table (an account heading, the opening, and a row per month with
// the closing up to that month's end). SPC_SUMMARY is SP_LEDGER_SPCL_SUMMARY_REPORT: the selected
// postings by the voucher's party, book and schedule.

/** The ledger formats' result: the amounts are decimals whatever the query typed them as. */
function ledgerTable(result: Awaited<ReturnType<typeof runReportSql>>): ResultTable {
  const table = tableFromResult(result);
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) if (table.has(column)) table.setKind(column, "decimal");
  return table;
}

async function ledgerFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const format = call.formating;
  const csFrom = withEntryAddon(call.from_, `left join ${db}addon_aentry aentry on led.led_key=aentry.aona_ledid`);
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  if (format === "MONTHLY") return ledgerMonthly(loader, plan, where);
  if (format === "SPC_SUMMARY") return ledgerSpecialSummary(loader, plan, where);

  let groupBy = call.groupBy;
  let orderBy = call.orderBy;
  const sums = "sum(case when ledpost.post_dbcode = 1 then ledpost.post_amt else 0.00 end) as \"DEBIT\",sum(case when ledpost.post_dbcode = 2 then ledpost.post_amt else 0.00 end) as \"CREDIT\",0.00 as \"CLOSING_BAL\",'' as \"DR_CR\"";
  let sql: string;
  let periodGroup = "";
  let periodOrder = "";
  const period = formatPeriod(format, call.dateField);
  if (period) {
    sql = `${period.label} AS "${period.alias}",${sums}`;
    periodGroup = period.group;
    periodOrder = period.order;
  } else if (format === "SUMMARY") {
    sql = `'${ddMmYyyy(call.from)}' || ' TO ' || '${ddMmYyyy(call.upto)}' as "SELECTED_DATE",${sums}`;
  } else {
    throw unknownFormat(format);
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
  requireWhere(where);
  return ledgerTable(await runReportSql(loader, frag(`${sql}${csFrom}${where}${groupOrderTail([groupBy, periodGroup], [orderBy, periodOrder])}`)));
}

/**
 * MONTHLY: TEMP_TABLE_LEDGER1 with an account heading (H), its opening (O) and a row per month that
 * has postings (P), each month's closing being the opening plus everything posted before the next
 * month. The From date must be the year's start. Accounts with nothing but the heading go.
 */
async function ledgerMonthly(loader: Loader, plan: ReportPlan, where: string): Promise<ResultTable> {
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
  sortRows(table, [(row) => textKey(row.SORTING_COL)]);
  return table;
}

/**
 * SP_LEDGER_SPCL_SUMMARY_REPORT: by the voucher's party with its book (Book group ticked), its
 * schedule (Schedule group), or both. Without either the procedure returns its error row.
 */
async function ledgerSpecialSummary(loader: Loader, plan: ReportPlan, where: string): Promise<ResultTable> {
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
  return ledgerTable(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
}

// ======================================================================================
// 42: BUDGET (SP_FRT_RPT_BUDGET)
// ======================================================================================
//
// Each account of the chosen book (debtors: the sales books 8 and 16; creditors: purchases 13 and
// 11) with what it did in the period (quantity, and the amount the way its side counts it),
// the budget kept on the account master and the variance (actual less budget). Accounts with a
// budget and nothing in the period come in too, so their budget shows unused. "Print Greater Than
// Budget Only" keeps the accounts with something done and over budget.
//
// Where the desktop's SQL fails the web does what it meant: with no account ticked the procedure
// had no list of accounts for the unused budgets (its SQL reads "code in "), so here every account
// of the book with a budget is used.

async function budget(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const debtors = call.fcValue === 2;
  const day = (date: Date) => `'${desktopDate(date)}'`;
  const period = `${day(call.from)} AND ${day(call.upto)}`;
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  const sign = debtors ? "1" : "2";
  const quantity = `(select CAST(SUM(case when stock_nat='A' then quantity${debtors ? "*-1" : ""} else quantity${debtors ? "" : "*-1"} end) AS NUMERIC(20,0)) from ${db}prod_ledger where code=led.code and il_pos='A' and il_date between ${period}) as "Quantity"`;
  const sql = `select ac.name as "name",ac.code as "AC_CODE",${quantity},coalesce(sum(case when led.ac_dbcode = ${sign} then led.amount::numeric else led.amount::numeric*-1 end),0) as "ACT_AMOUNT",coalesce(ac.budget::numeric,0) as "budget",CAST(0.00 AS NUMERIC(20,2)) AS "VARIANCE"`
    + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code ${where} and (led.doc_date between ${period}) and ${debtors ? "(led.book=8 or led.book=16)" : "(led.book=13 or led.book=11)"} group by ac.name,ac.code,led.code,ac.budget order by ac.name`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  for (const column of ["ACT_AMOUNT", "budget", "VARIANCE"]) table.setKind(column, "decimal");

  // Budgeted accounts with nothing in the period.
  const known = call.selectKey[4] !== "" ? `ac.code in ${call.selectKey[4]}` : `ac.book = ${Number(call.fcValue)}`;
  const unused = await runReportSql(loader, `select ac.name, ac.code, ac.budget::numeric as budget from ${db}ACCOUNT ac where ${known} and ac.budget::numeric <> 0 and ac.a_pos <> 'D'`);
  const have = new Set(table.rows.map((row) => String(row.AC_CODE)));
  for (const account of unused.rows) {
    if (have.has(String(account.code))) continue;
    table.insert({ name: account.name, AC_CODE: account.code, ACT_AMOUNT: 0, budget: num(account.budget), VARIANCE: 0 });
  }
  for (const row of table.rows) row.VARIANCE = money(num(row.ACT_AMOUNT) - num(row.budget));
  if (call.checkQuery.includes("CHK_ODBUDGET,")) table.rows = table.rows.filter((row) => !(num(row.ACT_AMOUNT) === 0 || num(row.VARIANCE) < 0));
  sortRows(table, [(row) => textKey(row.name)]);
  return table;
}
