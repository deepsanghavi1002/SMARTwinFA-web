import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { dayBefore } from "./library";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";
import { SYSTEM_SCHEMA } from "../master-program/session";

/**
 * 118: MULTI COMPANY LEDGER (SP_FRT_RPT_MULTI_COMPANY_LEDGER_REP; ANALYSIS REP. > Multi Company > Ledger).
 *
 * One account (the Account group's single pick) by its name in every company of the group that has the year (a short name; the ticked ones of
 * the Book group): the account's heading (AC), then for each company its opening (the year's AC_BALANCE, plus what was posted before From when
 * From is not the year's start), the postings between From and Upto, one line each (date, voucher, the book's account or JOURNAL, Debit,
 * Credit) and, unless Combine is ticked, its Closing Balance line (the running balance and the closing line's amount are the output layer's).
 * With Combine the companies' lines run together by date and one Closing Balance ends the report.
 * Put right: the closing line is the last of its company (the procedure's sort put it before the Upto day's vouchers).
 * Each company is two grouped reads (the opening, the postings).
 */
const SCHEMA = /^[a-z0-9_]+$/;

type Line = { row: ResultRow; company: string; date: string; last: boolean };

export async function multiCompanyLedger(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const key = call.selectKey[4].trim();
  if (key.includes(",")) throw new ReportRefusal("Multiple Party Selection Not Allowed", "INTERNAL PROGRAM FAILURE");
  if (!/^\(\s*\d+\s*\)$/.test(key)) throw new ReportRefusal("Select an account (Account group)", "INTERNAL PROGRAM FAILURE");
  const combine = call.checkQuery.includes("CHK_COMBINE,");
  const party = toText((await runReportSql(loader, `SELECT btrim(name) AS name FROM ${call.database}account WHERE code IN ${key} ORDER BY (a_pos = 'A') DESC, code LIMIT 1`)).rows[0]?.name);

  const table = new ResultTable();
  for (const column of ["DATE", "DOCUMENT", "CO_SHORT", "SMART_NAME", "PARTICULARS", "DEBIT", "CREDIT", "CLOSING_BAL", "ROW_DATA_TYPE"]) table.addColumn(column);
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) table.setKind(column, "decimal");
  if (party === "") return table;

  const blank = (values: ResultRow): ResultRow => Object.assign(Object.fromEntries(table.columns.map((column) => [column, ""])), { DEBIT: 0, CREDIT: 0, CLOSING_BAL: 0 }, values);
  const lines: Line[] = [{ company: "", date: "", last: false, row: blank({ SMART_NAME: party, PARTICULARS: party, ROW_DATA_TYPE: "AC" }) }];

  const companies = (await runReportSql(loader, `SELECT lower(btrim(c.co_dataname)) AS schema_name, btrim(c.co_short) AS short FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
    + ` WHERE n.c_tarikh1::date = $1::date AND n.c_tarikh2::date = $2::date AND coalesce(btrim(c.co_short), '') <> ''`
    + ` AND c.co_group_name = (SELECT co_group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $3)`
    + (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectBookKey.trim()) ? ` AND c.co_key IN ${call.selectBookKey.trim()}` : "")
    + ` ORDER BY c.co_short`, [desktopDate(call.tarikh1), desktopDate(call.tarikh2), call.companyKey])).rows;

  const startOfYear = call.from.getTime() === call.tarikh1.getTime();
  for (const company of companies) {
    const schema = toText(company.schema_name);
    const short = toText(company.short);
    if (!SCHEMA.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','ac_balance','ledger','ledger_post')", [schema])).rows[0];
    if (num(exists?.n) < 4) continue;
    let count = 0;

    const opening = (await runReportSql(loader, `SELECT sum(acbal.opening::numeric) AS opening`
      + (startOfYear ? "" : `, coalesce((SELECT sum(CASE WHEN lp.post_dbcode = 1 THEN lp.post_amt::numeric ELSE -lp.post_amt::numeric END) FROM ${schema}.ledger led JOIN ${schema}.ledger_post lp ON lp.led_id = led.led_key`
        + ` WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND lp.post_code IN (SELECT code FROM ${schema}.account WHERE btrim(name) = $1 AND a_pos = 'A') AND lp.post_date BETWEEN $2 AND $3), 0) AS before`)
      + ` FROM ${schema}.ac_balance acbal JOIN ${schema}.account ac ON ac.code = acbal.code WHERE btrim(ac.name) = $1 AND ac.a_pos = 'A'`,
    startOfYear ? [party] : [party, desktopDate(call.tarikh1), desktopDate(dayBefore(call.from))])).rows[0];
    const amount = Math.round((num(opening?.opening) + num(opening?.before)) * 100) / 100;
    if (amount !== 0) {
      lines.push({ company: short, date: "0", last: false, row: blank({ DATE: dateStyle6(call.from), SMART_NAME: party, PARTICULARS: "Opening Balance", CO_SHORT: short, DEBIT: amount > 0 ? amount : 0, CREDIT: amount < 0 ? -amount : 0, ROW_DATA_TYPE: "OPENINGS" }) });
      count += 1;
    }

    const posted = await runReportSql(loader, `SELECT to_char(led.doc_date, 'YYYYMMDD') AS sort_date, led.doc_date AS doc_date, led.full_docno AS document, btrim(ac.name) AS name,`
      + ` CASE WHEN led.book <> 19 THEN (SELECT btrim(ac1.name) FROM ${schema}.account ac1 WHERE ac1.code = led.book_code AND ac1.a_pos <> 'D' LIMIT 1) ELSE 'JOURNAL' END AS particulars,`
      + ` CASE WHEN lp.post_dbcode = 1 THEN lp.post_amt::numeric ELSE 0 END AS debit, CASE WHEN lp.post_dbcode = 2 THEN lp.post_amt::numeric ELSE 0 END AS credit`
      + ` FROM ${schema}.ledger_post lp LEFT JOIN ${schema}.ledger led ON led.led_key = lp.led_id JOIN ${schema}.account ac ON ac.code = lp.post_code AND ac.a_pos <> 'D'`
      + ` WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND led.doc_date BETWEEN $1 AND $2 AND btrim(ac.name) = $3 ORDER BY led.doc_date, led.ac_dbcode, led.doc_no`,
    [desktopDate(call.from), desktopDate(call.upto), party]);
    for (const line of posted.rows) {
      lines.push({ company: short, date: toText(line.sort_date), last: false, row: blank({ DATE: dateStyle6(line.doc_date as Date), DOCUMENT: toText(line.document), CO_SHORT: short, SMART_NAME: toText(line.name), PARTICULARS: toText(line.particulars), DEBIT: num(line.debit), CREDIT: num(line.credit), ROW_DATA_TYPE: "LED" }) });
      count += 1;
    }
    if (count > 0 && !combine) lines.push({ company: short, date: "99999999", last: true, row: blank({ DATE: dateStyle6(call.upto), SMART_NAME: party, PARTICULARS: "Closing Balance", CO_SHORT: short, ROW_DATA_TYPE: "CLOSING" }) });
  }
  if (combine) lines.push({ company: "￿", date: "99999999", last: true, row: blank({ DATE: dateStyle6(call.upto), SMART_NAME: party, PARTICULARS: "Closing Balance", CO_SHORT: "CLOSING", ROW_DATA_TYPE: "CLOSING" }) });

  const order = (a: Line, b: Line) => {
    if (!combine && a.company !== b.company) return a.company < b.company ? -1 : 1;
    if (a.last !== b.last) return a.last ? 1 : -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  };
  table.rows = lines.map((line, index) => ({ line, index })).sort((a, b) => order(a.line, b.line) || a.index - b.index).map(({ line }) => line.row);
  return table;
}
