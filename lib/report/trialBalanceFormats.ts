import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { dayBefore, formatPeriod, MONTH_NAMES, tableFromResult, withEntryAddon } from "./library";
import { money, num, runReportSql } from "./run";

/**
 * 6: TRIAL BALANCE with a format (SP_FRT_RPT_TRIALBAL, SP_REPORT_FORMATING branch 6): Month, Daily,
 * Weekly, 15 Days, Quarter Year and Half Year. No Formating is trialBalance() in reportStandard.ts.
 *
 * Daily ... Half Year: an account's opening line ("Opening Balance B/d", type OPENINGS, only for
 * accounts that have postings in the period) and a line per period (type LED) with its debit and
 * credit; the closing is worked out after, with the other reports' lines (Update_ClosingBalance).
 * Month: a line per account with the opening and a debit, credit, closing and DR / CR for each month
 * of the period and for the whole of it; the closings run on from the opening here (the desktop
 * fills them in after the procedure).
 */
export async function trialBalanceFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const format = call.formating;
  const known = ["MONTHLY", "DAILY", "WEEKLY", "HALF_MONTH", "QUATER_YEAR", "HALF_YEAR"];

  if (call.filterId.toUpperCase() === "OPENING") {
    const name: Record<string, string> = { MONTHLY: "Monthly", DAILY: "Daily", WEEKLY: "Weekly", HALF_MONTH: "15 Days", QUATER_YEAR: "Quater Year", HALF_YEAR: "Half Year" };
    throw new ReportRefusal(`Error Number : -1 \nOpening not possible for ${name[format] ?? ""} Report`, "INTERNAL PROGRAM FAILURE");
  }
  if (!known.includes(format)) throw new ReportRefusal("Error Number : -1\nInvalid formating specified", "INTERNAL PROGRAM FAILURE");

  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  const between = call.from.getTime() !== call.tarikh1.getTime();
  const book = call.fcValue === 1 ? "NOT IN (2,3)" : call.fcValue === 2 ? " = 2" : " = 3";
  const where = `${call.where.split("|sys.yearid|").join(call.yearId)} AND AC.BOOK ${book}`;
  const schedule = call.selectScheduleKey !== "";
  const scheduleColumn = schedule ? `bs.bs_desc as "SELECTED_SCHDULE",` : "";
  const csFrom = withEntryAddon(call.from_, `left join ${db}addon_aentry aentry on ac.code=aentry.aona_accode`).split("sys.aents").join("").split("sys.aente").join("");
  const fixdb = `${db}LEDGER_POST LEDPOST LEFT JOIN ${db}ACCOUNT AC ON AC.Code = LEDPOST.POST_CODE`;
  const openingFrom = withEntryAddon(call.openingFrom, `left join ${db}addon_aentry aentry on ac.code=aentry.aona_accode`).split("SYS.FIXDB").join(fixdb);
  const dataFrom = `(${openingFrom} LEFT JOIN ${db}AC_BALANCE ACBAL ON AC.Code = ACBAL.CODE)`;
  const select = call.queryStart.trim();
  const extra = select !== "" ? `,${select}` : "";
  // Every line of an account carries its name (SMART_NAME), so the closing can start again at each account.
  const smartName = /smart_name/i.test(select) ? "" : `AC.Name AS "SMART_NAME",`;

  // The opening: the year's, plus what was posted before From when the report starts later.
  const opening = between
    ? `(ACBAL.OPENING::numeric + COALESCE((SELECT SUM(CASE WHEN LEDPOST1.POST_DBCODE = 1 THEN LEDPOST1.POST_AMT::numeric ELSE 0.00 END) - SUM(CASE WHEN LEDPOST1.POST_DBCODE = 2 THEN LEDPOST1.POST_AMT::numeric ELSE 0.00 END) FROM ${db}LEDGER_POST LEDPOST1 WHERE LEDPOST1.POST_CODE = AC.Code AND LEDPOST1.POST_DATE BETWEEN '${desktopDate(call.tarikh1)}' AND '${desktopDate(dayBefore(call.from))}'),0.00))`
    : "ACBAL.OPENING::numeric";

  // The sorting: the order by without the account's name, then the name last; the same list joined with blanks makes the sort column.
  const kept = `${call.orderBy},`.replace(/ac\.name,/gi, "").replace(/,$/, "").trim();
  const orderBy = `${kept}${kept === "" ? "" : ","}AC.Name`;
  const sorting = orderBy.split(",").map((part) => `(${part.trim()})::text`).join(" || ' ' || ");
  const groupBy = call.groupBy.trim() === "" ? "AC.NAME" : /ac\.name/i.test(call.groupBy) ? call.groupBy.trim().replace(/,$/, "") : `${call.groupBy.trim().replace(/,$/, "")},AC.NAME`;
  const groupWithSchedule = schedule && !/bs\.bs_desc/i.test(groupBy) ? `${groupBy},bs.bs_desc` : groupBy;
  const postedBetween = ` AND LEDPOST.POST_DATE BETWEEN '${fromText}' AND '${uptoText}' `;
  const side = (code: number) => `SUM(CASE WHEN LEDPOST.POST_DBCODE = ${code} THEN LEDPOST.POST_AMT::numeric ELSE 0.00 END)`;

  if (format === "MONTHLY") return monthly();

  // Daily, Weekly, 15 Days, Quarter Year, Half Year.
  const period = format === "DAILY"
    ? { label: `to_char(LEDPOST.POST_DATE, 'DD/MM/YYYY')`, group: "LEDPOST.POST_DATE", order: "LEDPOST.POST_DATE" }
    : (() => {
      const found = formatPeriod(format, "LEDPOST.POST_DATE")!;
      return { label: found.label, group: found.label, order: `min(LEDPOST.POST_DATE),${found.label}` };
    })();
  const openings = `CTE_OPENINGS AS (SELECT AC.Code AS "AC_CODE",'OPENINGS' AS "ROW_DATA_TYPE",${sorting} || ' O' AS "SORTING_COL",0 AS "ORDERING_COL1",NULL::varchar AS "SELECTED_DATE",${scheduleColumn}'Opening Balance B/d' AS "NAME",${smartName}`
    + `CASE WHEN ${opening} > 0 THEN ${opening} ELSE 0.00 END AS "DEBIT",CASE WHEN ${opening} < 0 THEN ABS(${opening}) ELSE 0.00 END AS "CREDIT",ABS(${opening}) AS "CLOSING_BAL",`
    + `CASE WHEN ${opening} > 0 THEN 'DR' WHEN ${opening} < 0 THEN 'CR' ELSE '' END AS "DR_CR"${extra} ${csFrom} ${where} ORDER BY ${orderBy})`;
  const data = `CTE_DATA AS (SELECT AC.Code AS "AC_CODE",'LED' AS "ROW_DATA_TYPE",${sorting} || ' P' AS "SORTING_COL",ROW_NUMBER() OVER (ORDER BY ${orderBy},${period.order}) AS "ORDERING_COL1",${period.label} AS "SELECTED_DATE",${scheduleColumn}AC.Name AS "NAME",${smartName}`
    + `ABS(${side(1)}) AS "DEBIT",ABS(${side(2)}) AS "CREDIT",0.00 AS "CLOSING_BAL",''::varchar AS "DR_CR"${extra} FROM ${dataFrom} ${where}${postedBetween}GROUP BY AC.Code,${groupWithSchedule},${period.group} ORDER BY ${orderBy},${period.order})`;
  const sql = `WITH ${openings}, ${data} SELECT * FROM CTE_OPENINGS WHERE "AC_CODE" IN (SELECT "AC_CODE" FROM CTE_DATA) UNION SELECT * FROM CTE_DATA ORDER BY "SORTING_COL","ORDERING_COL1"`;
  const table = tableFromResult(await runReportSql(loader, frag(sql)));
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) table.setKind(column, "decimal");
  return table;

  /** Month: the opening, then a debit, credit, closing and DR / CR for each month and for the whole period. */
  async function monthly(): Promise<ResultTable> {
    const months: { name: string; number: number }[] = [];
    for (let month = new Date(call.from.getFullYear(), call.from.getMonth(), 1); month <= call.upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
      months.push({ name: MONTH_NAMES[month.getMonth()], number: month.getMonth() + 1 });
    }
    const openings = `CTE_OPENINGS AS (SELECT AC.Code AS "AC_CODE",${scheduleColumn}AC.Name AS "NAME",SUM(COALESCE(ABS(${opening}),0.00)) AS "CLOSING_BAL",`
      + `CASE WHEN COALESCE(SUM(${opening}),0.00) > 0 THEN 'DR' WHEN COALESCE(SUM(${opening}),0.00) < 0 THEN 'CR' ELSE '' END AS "DR_CR"${extra} ${csFrom} ${where} GROUP BY ${groupWithSchedule},AC.Code ORDER BY ${orderBy})`;
    const perMonth = months.map(({ name, number }) => `SUM(CASE WHEN LEDPOST.POST_DBCODE = 1 AND EXTRACT(MONTH FROM LEDPOST.POST_DATE) = ${number} THEN COALESCE(LEDPOST.POST_AMT::numeric,0.00) ELSE 0.00 END) AS "${name} DEBIT",`
      + `SUM(CASE WHEN LEDPOST.POST_DBCODE = 2 AND EXTRACT(MONTH FROM LEDPOST.POST_DATE) = ${number} THEN COALESCE(LEDPOST.POST_AMT::numeric,0.00) ELSE 0.00 END) AS "${name} CREDIT",0.00 AS "${name} CLOSING_BAL",''::varchar AS "${name} DR_CR"`).join(",");
    const totals = `${side(1)} AS "TOTAL_DEBIT",${side(2)} AS "TOTAL_CREDIT",0.00 AS "TOTAL_CLOSINGS",''::varchar AS "TOT._DR_CR"`;
    const data = `CTE_DATA AS (SELECT AC.Code AS "AC_CODE",'LED' AS "ROW_DATA_TYPE",ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS "ORDERING_COL1",${scheduleColumn}AC.Name AS "NAME",${perMonth},${totals}${extra}`
      + ` FROM ${dataFrom} ${where}${postedBetween}GROUP BY AC.Code,${groupWithSchedule} ORDER BY ${orderBy})`;
    const sql = `WITH ${openings}, ${data} SELECT CASE WHEN OP."DR_CR" = 'CR' THEN OP."CLOSING_BAL" * -1 ELSE OP."CLOSING_BAL" END AS "OPENING_BAL",DT.* FROM CTE_DATA DT LEFT JOIN CTE_OPENINGS OP ON DT."AC_CODE" = OP."AC_CODE" ORDER BY DT."ORDERING_COL1"`;
    const table = tableFromResult(await runReportSql(loader, frag(sql)));
    table.setKind("OPENING_BAL", "decimal");
    for (const column of table.columns) if (/ (DEBIT|CREDIT|CLOSING_BAL)$/.test(column) || /^TOTAL_/.test(column)) table.setKind(column, "decimal");
    // The closings run on from the opening: month by month, then for the whole period.
    const drCr = (balance: number) => (balance > 0 ? "DR" : balance < 0 ? "CR" : "");
    for (const row of table.rows) {
      let balance = num(row.OPENING_BAL);
      for (const { name } of months) {
        balance = money(balance + num(row[`${name} DEBIT`]) - num(row[`${name} CREDIT`]));
        row[`${name} CLOSING_BAL`] = Math.abs(balance);
        row[`${name} DR_CR`] = drCr(balance);
      }
      const total = money(num(row.OPENING_BAL) + num(row.TOTAL_DEBIT) - num(row.TOTAL_CREDIT));
      row.TOTAL_CLOSINGS = Math.abs(total);
      row["TOT._DR_CR"] = drCr(total);
      if (toText(row.OPENING_BAL) === "") row.OPENING_BAL = 0;
    }
    return table;
  }
}
