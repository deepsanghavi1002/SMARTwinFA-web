import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { ddMmYyyy, sortRows, tableFromFields, textKey } from "./library";
import { daysBetween, daysInYear, interestExpression, interestRate, percentExpression, summarize } from "./interestSql";
import { money, num, runReportSql } from "./run";

type Row = Record<string, unknown>;

/**
 * SP_FRT_RPT_INTEREST (REPORT > Extra > Interest Calculation, report 32): interest on the accounts of a book (1, 2, 3) at one rate for the
 * period, in the detail format a line for each account's opening balance and each interest-bearing entry (its principal, the days to
 * Upto and the interest received or paid), in the summary a line for each period of an account's balance. The rate is the runtime box's (12
 * when blank) unless the account has its own. TDSREQ adds the TDS rate. The desktop builds it in TEMP_TABLE_INTEREST_<machine>; here the
 * rows are built in memory from read-only queries.
 *
 * Read as the desktop does: with a From after the year's start the openings are the year's opening balance (without its sign) plus the
 * entries before From, and every account then takes its Dr / Cr from that sum.
 */
export async function interestCalculation(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const book = call.book >= 0 ? call.book : call.fcValue;
  const year = call.yearId.replace(/'/g, "''");
  const rate = interestRate(call.text[0] ?? "");
  const noOfDays = daysInYear(call.tarikh2);
  const tds = call.filterId.toUpperCase() === "TDSREQ";
  const percent = percentExpression(rate);
  const dateText = (date: Date) => ddMmYyyy(date);
  const ymd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const fromBefore = call.from.getTime() !== call.tarikh1.getTime();

  // The balance sheet heads of the liabilities and the capital (ENT_FRAME L or C).
  const heads = (await runReportSql(loader, `SELECT bs_key FROM ${db}BALSHEET WHERE ent_frame like '%L%' or ent_frame like '%C%' ORDER BY bs_code`)).rows.map((row) => num(row.bs_key));
  const bsKeys = heads.length > 0 ? heads.join(",") : "0";
  const inBook = `(ac.bs_id in (${bsKeys}) or ${book === 1 ? "" : book === 2 ? "ac.book=2 or " : "ac.book=3 or "}ac.ac_opensty in ('TD','IR','IP'))`;
  const accounts = call.selectKey[4] !== "" ? ` and ac.code in ${call.selectKey[4]}` : "";
  const tdsRate = `(case when coalesce((select tds_rate from ${db}INT_MASTER intmst left join ${db}ACCOUNT accc on accc.code=intmst.code where accc.bs_id=15 and accc.nature_pay=ac.nature_pay limit 1),0)=0 then intmst.tds_rate else coalesce((select tds_rate from ${db}INT_MASTER intmst left join ${db}ACCOUNT accc on accc.code=intmst.code where accc.bs_id=15 and accc.nature_pay=ac.nature_pay limit 1),0) end) AS "TDS_RATE"`;
  const days = daysBetween(call.from, call.upto) + 1;

  // The opening of each account.
  const opening = await runReportSql(loader, frag(
    `SELECT ac.name AS "SMART_NAME",'${dateText(call.from)}' AS "DATE",'Opening' AS "NO",ac.name AS "NAME",'${dateText(call.from)}' AS "FROM_DATE",'${dateText(call.upto)}' AS "UPTO_DATE",${days} AS "Days",`
    + `abs(acbal.opening::numeric) AS "PRINCIPAL_AMT",(CASE WHEN acbal.opening::numeric < 0 THEN 'Cr' ELSE 'Dr' END) AS "PDR_CR",`
    + `(case when acbal.opening::numeric > 0 then (acbal.opening::numeric * ${percent})/${noOfDays}*${days} else 0.00 end) AS "INTRECD_AMT",`
    + `(case when acbal.opening::numeric < 0 then abs((abs(acbal.opening::numeric) * ${percent})/${noOfDays}*${days}) else 0.00 end) AS "INTPAY_AMT",`
    + `abs(acbal.opening::numeric) AS "CLOSING_BAL",''::varchar(2) AS "DR_CR",${interestExpression(rate)} AS "INTEREST",ac.code AS "ac_code",(ac.name||' '||'${ymd(call.tarikh1)}'||'A') AS "SORTING_DATE"${tds ? `,${tdsRate}` : ""}`
    + ` FROM ${db}AC_BALANCE acbal LEFT JOIN ${db}ACCOUNT ac ON acbal.code = ac.code${tds ? ` LEFT JOIN ${db}IDOPT_MASTER idopt ON idopt.idopt_key = ac.nature_pay LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code` : ""}`
    + ` WHERE acbal.a_recflag = 'AC' AND ac.a_pos <> 'D' AND acbal.year_id = '${year}' AND ac.book = ${book} AND ${inBook}${accounts}`));
  const openings: Row[] = opening.rows.map((row) => ({ ...row }));

  const where = `${call.where.split("|sys.yearid|").join(call.yearId)} AND ac.BOOK = ${book} and led.int_type<>10 and (led.book=19 or led.doc_type='R') AND ${inBook}`;
  if (fromBefore) {
    // The entries before From: debits less credits for each account (TEMP_OPENINGS_).
    const moved = await runReportSql(loader, frag(
      `SELECT ac.code AS "key_code", SUM(CASE WHEN led.ac_dbcode = 1 then led.amount::numeric else 0.00 end) - SUM(CASE WHEN led.ac_dbcode = 2 then led.amount::numeric else 0.00 end) AS "openings"`
      + ` FROM ${db}ACCOUNT ac LEFT JOIN ${db}AC_BALANCE acbal ON ac.code = acbal.code${tds ? ` LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code` : ` LEFT JOIN ${db}IDOPT_MASTER idopt ON idopt.idopt_key = ac.nature_pay LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code`}`
      + ` LEFT JOIN ${db}LEDGER led ON ac.code = led.code ${where} AND led.doc_date < ${day(call.from)} GROUP BY ac.code ORDER BY ac.code`));
    if (moved.rows.length > 0) {
      const byCode = new Map(moved.rows.map((row) => [String(row.key_code), num(row.openings)]));
      for (const row of openings) if (byCode.has(String(row.ac_code))) row.PRINCIPAL_AMT = money(num(row.PRINCIPAL_AMT) + (byCode.get(String(row.ac_code)) ?? 0));
      for (const row of openings) {
        const principal = num(row.PRINCIPAL_AMT);
        const side = principal < 0 ? "Cr" : "Dr";
        const amount = Math.abs(principal);
        const percentOf = Math.round(num(row.INTEREST) / 100 * 10000) / 10000;
        row.PDR_CR = side;
        row.PRINCIPAL_AMT = amount;
        row.INTRECD_AMT = side === "Dr" ? (amount * percentOf / noOfDays) * days : 0;
        row.INTPAY_AMT = side === "Cr" ? Math.abs((Math.abs(amount) * percentOf / noOfDays) * days) : 0;
      }
    }
  }
  const kept = openings.filter((row) => num(row.PRINCIPAL_AMT) !== 0);

  // The entries of the period.
  const lineDays = `(${day(call.upto)} - led.doc_date::date + 1)`;
  const lines = await runReportSql(loader, frag(
    `SELECT ac.name AS "SMART_NAME",to_char(led.doc_date,'DD/MM/YYYY') AS "DATE",led.full_docno AS "NO",ac.name AS "Name",to_char(led.doc_date,'DD/MM/YYYY') AS "FROM_DATE",'${dateText(call.upto)}' AS "UPTO_DATE",${lineDays} AS "Days",`
    + `led.amount::numeric AS "PRINCIPAL_AMT",(CASE WHEN led.ac_dbcode = 2 then 'Cr' else 'Dr' end) AS "PDR_CR",`
    + `(CASE WHEN led.ac_dbcode = 1 THEN round((led.amount::numeric * ${percent})/${noOfDays}*${lineDays},2) ELSE 0.00 END) AS "INTRECD_AMT",`
    + `(CASE WHEN led.ac_dbcode = 2 THEN round((led.amount::numeric * ${percent})/${noOfDays}*${lineDays},2) ELSE 0.00 END) AS "INTPAY_AMT",`
    + `led.amount::numeric AS "CLOSING_BAL",''::varchar(2) AS "DR_CR",${interestExpression(rate)} AS "INTEREST",ac.code AS "ac_code",(ac.name||' '||to_char(led.doc_date,'YYYYMMDD')||'B') AS "SORTING_DATE"${tds ? `,${tdsRate}` : ""}`
    + ` FROM ${db}ACCOUNT ac LEFT JOIN ${db}AC_BALANCE acbal ON ac.code = acbal.code LEFT JOIN ${db}LEDGER led ON ac.code = led.code${tds ? ` LEFT JOIN ${db}IDOPT_MASTER idopt ON idopt.idopt_key = ac.nature_pay LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code` : ""}`
    + ` ${where} AND led.doc_date >= ${day(call.from)} AND led.doc_date <= ${day(call.upto)} ORDER BY ac.name, led.doc_date`));

  // UNION of the two (the lines named by position as the first select names them), by SORTING_DATE then SMART_NAME.
  const names = opening.fields.map((field) => field.name);
  const named = (row: Row): Row => { const values = Object.values(row); return Object.fromEntries(names.map((name, at) => [name, values[at] ?? null])); };
  const table = tableFromFields(opening.fields);
  for (const column of ["PRINCIPAL_AMT", "INTRECD_AMT", "INTPAY_AMT", "CLOSING_BAL", "INTEREST", "TDS_RATE"]) if (table.has(column)) table.setKind(column, "decimal");
  const seen = new Set<string>();
  for (const row of [...kept.map(named), ...lines.rows.map(named)]) {
    const key = JSON.stringify(names.map((name) => row[name]));
    if (seen.has(key)) continue;
    seen.add(key);
    table.rows.push(row);
  }
  sortRows(table, [(row) => textKey(row.SORTING_DATE), (row) => textKey(row.SMART_NAME)]);
  const format = call.formating.toUpperCase();
  if (format === "" || format === "DETAIL") return table;

  // Summary: each party's balance by period.
  const summary = summarize(table.rows.map((row) => ({ name: toText(row.NAME), date: toText(row.DATE), principal: num(row.PRINCIPAL_AMT), side: toText(row.PDR_CR) })), rate.rate, noOfDays, desktopDate(call.upto), call.upto);
  const out = new ResultTable();
  for (const column of ["SMART_NAME", "Name", "CLOSING_AMT", "FROM_DATE", "UPTO_DATE", "DAYS", "INT_RATE", "Interest_Amt", "DR_CR", "SORTING_DATE"]) out.addColumn(column);
  for (const column of ["CLOSING_AMT", "INT_RATE", "Interest_Amt"]) out.setKind(column, "decimal");
  out.setKind("DAYS", "int");
  out.rows = summary.map((row) => ({ ...row }));
  sortRows(out, [(row) => textKey(row.SORTING_DATE), (row) => textKey(row.SMART_NAME)]);
  return out;
}
