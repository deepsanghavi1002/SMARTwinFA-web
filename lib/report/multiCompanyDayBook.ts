import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { dayBefore, ddMmYyyy } from "./library";
import { num, runReportSql } from "./run";
import { SYSTEM_SCHEMA } from "../master-program/session";

/**
 * 117: MULTI COMPANY DAY BOOK (SP_FRT_RPT_MULTI_COMPANY_DAY_BOOK_REP; ANALYSIS REP. > Multi Company > Bank / Cash).
 *
 * The cash (4) or bank (6) account picked in the first combo, in every company of the group that has the same year (a short name, and the
 * ticked companies when the Book group names some), one line a voucher: date, number, [cheque number, date and reconciliation date for the
 * bank], company, party, Receipt, Payment. Without schedules each company has its opening line (from the year's AC_BALANCE, plus what the
 * book moved before From when From is not the year's start) and, unless Combine is ticked, a closing line; with Combine one closing line ends
 * the report. With schedules the lines carry the party's schedule (SMART_SELECTED_SCHDULE), no opening and no closing. The running balance
 * (CLOSING_BAL) is the output layer's.
 *
 * Where the desktop's procedure comes out wrong it is put right here:
 *  - a company that has no account of that name kept the previous company's code (the OUTPUT variable was not assigned); here it has no lines.
 *  - the closing line sorted ahead of the vouchers of the Upto day (its VOU_NO is empty); here it is the last line of its company.
 * Each company is four grouped reads (the account, the opening, the lines) instead of one cursor step per statement.
 */

const SCHEMA = /^[a-z0-9_]+$/;

type Line = { row: ResultRow; company: string; schedule: string; date: string; number: string; last: boolean };

export async function multiCompanyDayBook(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const bank = call.book === 6;
  const combine = call.checkQuery.includes("CHK_COMBINE,");
  const schedules = call.selectScheduleKey.trim();
  const withSchedule = schedules !== "";
  const accountName = call.fcText.trim();

  const table = new ResultTable();
  for (const column of ["VOU_DATE", "VOU_NO", ...(bank ? ["CHQ_NO", "CHQ_DATE", "RECO_DATE"] : []), "CO_SHORT", "PARTY_NAME", "RECEIPT", "PAYMENT", "CLOSING_BAL", ...(withSchedule ? ["SMART_SELECTED_SCHDULE"] : []), "ROW_DATA_TYPE"]) table.addColumn(column);
  for (const column of ["RECEIPT", "PAYMENT", "CLOSING_BAL"]) table.setKind(column, "decimal");

  const companies = (await runReportSql(loader, `SELECT lower(btrim(c.co_dataname)) AS schema_name, btrim(c.co_short) AS short FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
    + ` WHERE n.c_tarikh1::date = $1::date AND n.c_tarikh2::date = $2::date AND coalesce(btrim(c.co_short), '') <> ''`
    + ` AND c.co_group_name = (SELECT co_group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $3)`
    + (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectBookKey.trim()) ? ` AND c.co_key IN ${call.selectBookKey.trim()}` : "")
    + ` ORDER BY c.co_short`, [desktopDate(call.tarikh1), desktopDate(call.tarikh2), call.companyKey])).rows;

  const startOfYear = call.from.getTime() === call.tarikh1.getTime();
  const lines: Line[] = [];
  const blank = (values: ResultRow): ResultRow => Object.assign(Object.fromEntries(table.columns.map((column) => [column, ""])), { RECEIPT: 0, PAYMENT: 0, CLOSING_BAL: 0 }, values);

  for (const company of companies) {
    const schema = toText(company.schema_name);
    const short = toText(company.short);
    if (!SCHEMA.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','ac_balance','ledger','balsheet')", [schema])).rows[0];
    if (num(exists?.n) < 4) continue;
    const account = (await runReportSql(loader, `SELECT code FROM ${schema}.account WHERE btrim(name) = $1 AND a_pos = 'A' ORDER BY code LIMIT 1`, [accountName])).rows[0];
    const code = num(account?.code);
    if (code === 0) continue;

    let count = 0;
    if (!withSchedule) {
      const opening = (await runReportSql(loader, `SELECT coalesce((SELECT sum(opening::numeric) FROM ${schema}.ac_balance WHERE code = $1), 0)`
        + (startOfYear ? "" : ` + coalesce((SELECT sum(CASE WHEN ac_dbcode = 2 THEN amount::numeric ELSE -amount::numeric END) FROM ${schema}.ledger WHERE doc_pos <> 'D' AND doc_posting = 'P' AND book_code = $1 AND doc_date BETWEEN $2 AND $3), 0)`)
        + " AS opening", startOfYear ? [code] : [code, desktopDate(call.tarikh1), desktopDate(dayBefore(call.from))])).rows[0];
      const amount = Math.round(num(opening?.opening) * 100) / 100;
      if (amount !== 0) {
        lines.push({ company: short, schedule: "", date: "0", number: "", last: false, row: blank({ VOU_DATE: dateStyle6(call.from), PARTY_NAME: "Opening Balance", CO_SHORT: short, RECEIPT: amount > 0 ? amount : 0, PAYMENT: amount < 0 ? -amount : 0, ROW_DATA_TYPE: "OPENINGS" }) });
        count += 1;
      }
    }

    const voucher = await runReportSql(loader, `SELECT to_char(led.doc_date, 'YYYYMMDD') AS sort_date, led.doc_date AS doc_date, btrim(led.doc_no) AS vou_no, btrim(ac.name) AS party,`
      + ` CASE WHEN led.ac_dbcode = 2 THEN led.amount::numeric ELSE 0 END AS receipt, CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE 0 END AS payment`
      + (bank ? `, btrim(led.doc_no1) AS chq_no, led.chln_date AS chq_date, led.reco_date AS reco_date` : "")
      + (withSchedule ? ", btrim(bs.bs_desc) AS schedule" : "")
      + ` FROM ${schema}.ledger led JOIN ${schema}.account ac ON ac.code = led.code AND ac.a_pos = 'A'`
      + (withSchedule ? ` LEFT JOIN ${schema}.balsheet bs ON bs.bs_key = ac.bs_id` : "")
      + ` WHERE led.book_code = $1 AND led.doc_pos = 'A' AND led.doc_date BETWEEN $2 AND $3`
      + (withSchedule ? ` AND ac.bs_id IN ${schedules}` : "")
      + ` ORDER BY led.doc_date, led.ac_dbcode, led.doc_no`, [code, desktopDate(call.from), desktopDate(call.upto)]);
    for (const line of voucher.rows) {
      const date = line.doc_date as Date;
      lines.push({
        company: short, schedule: toText(line.schedule), date: toText(line.sort_date), number: toText(line.vou_no), last: false,
        row: blank({
          VOU_DATE: dateStyle6(date), VOU_NO: toText(line.vou_no), CO_SHORT: short, PARTY_NAME: toText(line.party), RECEIPT: num(line.receipt), PAYMENT: num(line.payment), ROW_DATA_TYPE: "LED",
          ...(bank ? { CHQ_NO: toText(line.chq_no), CHQ_DATE: line.chq_date ? ddMmYyyy(line.chq_date as Date) : null, RECO_DATE: line.reco_date ? ddMmYyyy(line.reco_date as Date) : null } : {}),
          ...(withSchedule ? { SMART_SELECTED_SCHDULE: toText(line.schedule) } : {}),
        }),
      });
      count += 1;
    }
    if (count > 0 && !withSchedule && !combine) {
      lines.push({ company: short, schedule: "", date: "99999999", number: "", last: true, row: blank({ VOU_DATE: dateStyle6(call.upto), PARTY_NAME: "Closing Balance", CO_SHORT: short, ROW_DATA_TYPE: "LED" }) });
    }
  }
  if (!withSchedule && combine && lines.length > 0) {
    lines.push({ company: "￿", schedule: "", date: "99999999", number: "", last: true, row: blank({ VOU_DATE: dateStyle6(call.upto), PARTY_NAME: "Closing Balance", CO_SHORT: "CLOSING", ROW_DATA_TYPE: "LED" }) });
  }

  // The procedure's order: the company (not with Combine), the schedule, the date, the voucher number; the closing line last.
  const order = (a: Line, b: Line) => {
    if (a.last !== b.last && (combine || a.company === b.company)) return a.last ? 1 : -1;
    if (!combine && a.company !== b.company) return a.company < b.company ? -1 : 1;
    if (a.schedule !== b.schedule) return a.schedule < b.schedule ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  };
  table.rows = lines.map((line, index) => ({ line, index })).sort((a, b) => order(a.line, b.line) || a.index - b.index).map(({ line }) => line.row);
  return table;
}
