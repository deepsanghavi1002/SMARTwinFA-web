import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";
import { SYSTEM_SCHEMA } from "../master-program/session";

/**
 * 115: MULTI COMPANY ACCOUNT SUMMARY (SP_FRT_RPT_MULTI_COMPANY_ACCOUNT_SUMMARY_REP; ANALYSIS REP. > Multi Company > Account Summary).
 *
 * The accounts of the first combo (1 the others, not debtors, creditors or journal; 2 Sundry Debtors; 3 Sundry Creditors) with their closing
 * balance (the year's opening plus every posting from the year's start to Upto) side by side: a column for each company of the group that has
 * the year (a short name; the ticked ones of the Book group), TOTAL, a row for each account name (and schedule, when schedules are ticked:
 * SMART_SELECTED_SCHDULE, its subtotals are the output layer's). An account with no closing is left out. With the first combo 1 the
 * control accounts (opening style SD / SC) take in what the debtors / creditors posted on their own vouchers.
 * Each company is two or three grouped reads (the accounts with their opening and postings, the debtor / creditor totals).
 */
const SCHEMA = /^[a-z0-9_]+$/;

/** The companies of the group that have the session's year and a short name (the ticked ones of the Book group), by short name. */
async function groupCompanies(loader: Loader, plan: ReportPlan): Promise<ResultRow[]> {
  const { call } = plan;
  return (await runReportSql(loader, `SELECT lower(btrim(c.co_dataname)) AS schema_name, btrim(c.co_short) AS short FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
    + ` WHERE n.c_tarikh1::date = $1::date AND n.c_tarikh2::date = $2::date AND coalesce(btrim(c.co_short), '') <> ''`
    + ` AND c.co_group_name = (SELECT co_group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $3)`
    + (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectBookKey.trim()) ? ` AND c.co_key IN ${call.selectBookKey.trim()}` : "")
    + ` ORDER BY c.co_short`, [desktopDate(call.tarikh1), desktopDate(call.tarikh2), call.companyKey])).rows;
}

export async function multiCompanyAccountSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const combo = call.fcValue;
  const schedules = call.selectScheduleKey.trim();
  const withSchedule = schedules !== "";
  const book = combo === 1 ? "ac.book <> 2 AND ac.book <> 3 AND ac.book <> 19" : combo === 2 ? "ac.book = 2" : combo === 3 ? "ac.book = 3" : "";
  if (book === "") return new ResultTable();

  const companies = await groupCompanies(loader, plan);

  const table = new ResultTable();
  table.addColumn("NAME");
  if (withSchedule) table.addColumn("SMART_SELECTED_SCHDULE");
  const shorts = companies.map((company) => toText(company.short));
  for (const short of shorts) table.setKind(short, "decimal");
  table.setKind("TOTAL", "decimal");

  const period = [desktopDate(call.tarikh1), desktopDate(call.upto)];
  const cells = new Map<string, { name: string; schedule: string; byCompany: Map<string, number> }>();
  for (const company of companies) {
    const schema = toText(company.schema_name);
    const short = toText(company.short);
    if (!SCHEMA.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','ac_balance','ledger','ledger_post','balsheet')", [schema])).rows[0];
    if (num(exists?.n) < 5) continue;

    const accounts = (await runReportSql(loader, `SELECT btrim(ac.name) AS name${withSchedule ? ", btrim(bs.bs_desc) AS schedule" : ""}, coalesce(op.opening, 0) + coalesce(p.net, 0) AS closing`
      + ` FROM ${schema}.account ac${withSchedule ? ` LEFT JOIN ${schema}.balsheet bs ON bs.bs_key = ac.bs_id` : ""}`
      + ` LEFT JOIN (SELECT acn.name, acn.book, sum(acbal.opening::numeric) AS opening FROM ${schema}.account acn LEFT JOIN ${schema}.ac_balance acbal ON acn.code = acbal.code WHERE acn.a_pos = 'A' GROUP BY acn.name, acn.book) op ON op.name = ac.name AND op.book = ac.book`
      + ` LEFT JOIN (SELECT ledpost.post_code, sum(CASE WHEN ledpost.post_dbcode = 1 THEN ledpost.post_amt::numeric ELSE -ledpost.post_amt::numeric END) AS net FROM ${schema}.ledger led JOIN ${schema}.ledger_post ledpost ON ledpost.led_id = led.led_key`
      + ` WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND ledpost.post_date BETWEEN $1 AND $2 GROUP BY ledpost.post_code) p ON p.post_code = ac.code`
      + ` WHERE ac.a_pos = 'A' AND ${book}${withSchedule ? ` AND ac.bs_id IN ${schedules}` : ""}`, period)).rows;

    // The control accounts: what the debtors (SD) / creditors (SC) posted on their own vouchers.
    const control = new Map<string, number>();
    if (combo === 1) {
      const sides = (await runReportSql(loader, `SELECT ac1.book, sum(CASE WHEN lp.post_dbcode = 1 THEN lp.post_amt::numeric ELSE -lp.post_amt::numeric END) AS net FROM ${schema}.ledger led`
        + ` JOIN ${schema}.ledger_post lp ON lp.led_id = led.led_key JOIN ${schema}.account ac1 ON ac1.code = led.code AND ac1.a_pos = 'A' AND ac1.book IN (2, 3)`
        + ` WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND lp.post_code = ac1.code AND lp.post_date BETWEEN $1 AND $2 GROUP BY ac1.book`, period)).rows;
      const net = (bookNo: number) => num(sides.find((row) => num(row.book) === bookNo)?.net);
      for (const row of (await runReportSql(loader, `SELECT lower(btrim(name)) AS name, ac_opensty FROM ${schema}.account WHERE ac_opensty IN ('SD', 'SC') AND a_pos <> 'D'`)).rows) {
        control.set(toText(row.name), toText(row.ac_opensty) === "SD" ? net(2) : net(3));
      }
    }

    for (const account of accounts) {
      const closing = Math.round((num(account.closing) + (control.get(toText(account.name).toLowerCase()) ?? 0)) * 100) / 100;
      if (closing === 0) continue;
      const name = toText(account.name);
      const schedule = withSchedule ? toText(account.schedule) : "";
      const key = `${name.toLowerCase()}\u0000${schedule.toLowerCase()}`;
      const entry = cells.get(key) ?? { name, schedule, byCompany: new Map<string, number>() };
      entry.byCompany.set(short, Math.round(((entry.byCompany.get(short) ?? 0) + closing) * 100) / 100);
      cells.set(key, entry);
    }
  }

  for (const short of shorts) table.addColumn(short);
  table.addColumn("TOTAL");
  const rows: ResultRow[] = [];
  for (const entry of cells.values()) {
    const row: ResultRow = { NAME: entry.name };
    if (withSchedule) row.SMART_SELECTED_SCHDULE = entry.schedule;
    let total = 0;
    for (const short of shorts) { const value = entry.byCompany.get(short); row[short] = value ?? null; total += value ?? 0; }
    row.TOTAL = Math.round(total * 100) / 100;
    rows.push(row);
  }
  const lower = (text: string) => text.toLowerCase();
  rows.sort((a, b) => (withSchedule ? lower(toText(a.SMART_SELECTED_SCHDULE)).localeCompare(lower(toText(b.SMART_SELECTED_SCHDULE))) : 0) || lower(toText(a.NAME)).localeCompare(lower(toText(b.NAME))));
  table.rows = rows;
  return table;
}

/**
 * 178: MULTI COMPANY PROFIT AND LOSS (the same procedure as 115, its other branch; ANALYSIS REP. > Multi Company > Profit And Loss).
 *
 * The accounts of the profit and loss heads (balance sheet codes 01.. and 02..) with what was posted between From and Upto (debit less credit,
 * no opening), a column a company of the group, TOTAL; a row a name inside its head (BOOK, the head's level key, and SMART_SELECTED_SCHDULE its
 * description), in the order of the level then the name. An account with nothing posted is left out. The stock accounts are put right as the
 * procedure does: OPENING STOCK takes the opening (the last year's closing when From is not the year's start) of the closing stock account
 * (opening style CB) and CLOSING STOCK its OS_BILLDIFF, reversed. Each company is two grouped reads.
 */
export async function multiCompanyProfitLoss(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const companies = await groupCompanies(loader, plan);
  const startOfYear = call.from.getTime() === call.tarikh1.getTime();
  const shorts = companies.map((company) => toText(company.short));

  const table = new ResultTable();
  for (const column of ["NAME", "SMART_SELECTED_SCHDULE", "BOOK"]) table.addColumn(column);
  table.setKind("BOOK", "int");
  for (const short of shorts) table.setKind(short, "decimal");
  table.setKind("TOTAL", "decimal");

  const period = [desktopDate(call.from), desktopDate(call.upto)];
  const cells = new Map<string, { name: string; schedule: string; book: number; byCompany: Map<string, number> }>();
  for (const company of companies) {
    const schema = toText(company.schema_name);
    const short = toText(company.short);
    if (!SCHEMA.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','ac_balance','ledger','ledger_post','balsheet')", [schema])).rows[0];
    if (num(exists?.n) < 5) continue;

    const accounts = (await runReportSql(loader, `SELECT btrim(ac.name) AS name, bs.bs_level AS book, (SELECT btrim(b1.bs_desc) FROM ${schema}.balsheet b1 WHERE b1.bs_key = bs.bs_level LIMIT 1) AS schedule, coalesce(p.net, 0) AS closing`
      + ` FROM ${schema}.account ac LEFT JOIN ${schema}.balsheet bs ON bs.bs_key = ac.bs_id`
      + ` LEFT JOIN (SELECT ledpost.post_code, sum(CASE WHEN ledpost.post_dbcode = 1 THEN ledpost.post_amt::numeric ELSE -ledpost.post_amt::numeric END) AS net FROM ${schema}.ledger led JOIN ${schema}.ledger_post ledpost ON ledpost.led_id = led.led_key`
      + ` WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND ledpost.post_date BETWEEN $1 AND $2 GROUP BY ledpost.post_code) p ON p.post_code = ac.code`
      + ` WHERE ac.a_pos = 'A' AND left(bs.bs_code, 2) IN ('01', '02')`, period)).rows;

    // The closing stock accounts (opening style CB): their opening (or last year's closing) and OS_BILLDIFF for the year.
    const stock = new Map<string, { opening: number; billDiff: number }>();
    for (const row of (await runReportSql(loader, `SELECT lower(btrim(ac.name)) AS name, ${startOfYear ? "acbal.opening" : "acbal.last_year"}::numeric AS opening, acbal.os_billdiff::numeric AS bill_diff`
      + ` FROM ${schema}.account ac JOIN ${schema}.ac_balance acbal ON acbal.code = ac.code WHERE ac.ac_opensty = 'CB' AND ac.a_pos <> 'D' AND acbal.year_id = $1 ORDER BY ac.code`, [call.yearId])).rows) {
      const name = toText(row.name);
      if (!stock.has(name)) stock.set(name, { opening: num(row.opening), billDiff: num(row.bill_diff) });
    }

    // The procedure's renames and updates, in its order: OPENING STOCK reads as the closing stock account (its opening), CLOSING STOCK its OS_BILLDIFF reversed.
    const lines = accounts.map((row) => ({ name: toText(row.name), book: num(row.book), schedule: toText(row.schedule), closing: Math.round(num(row.closing) * 100) / 100 }));
    const is = (line: { name: string }, name: string) => line.name.toLowerCase() === name.toLowerCase();
    for (const line of lines) if (is(line, "OPENING STOCK")) line.name = "CLOSING STOCK [ASSET]";
    for (const line of lines) { const found = stock.get(line.name.toLowerCase()); if (found) line.closing = found.opening; }
    for (const line of lines) if (is(line, "CLOSING STOCK [ASSET]")) line.name = "OPENING STOCK";
    for (const line of lines) if (is(line, "CLOSING STOCK")) line.name = "CLOSING STOCK [ASSET]";
    for (const line of lines) { const found = stock.get(line.name.toLowerCase()); if (found) line.closing = -found.billDiff; }
    for (const line of lines) if (is(line, "CLOSING STOCK [ASSET]")) line.name = "CLOSING STOCK";

    for (const line of lines) {
      const key = `${line.name.toLowerCase()}\u0000${line.schedule.toLowerCase()}\u0000${line.book}`;
      const entry = cells.get(key) ?? { name: line.name, schedule: line.schedule, book: line.book, byCompany: new Map<string, number>() };
      entry.byCompany.set(short, Math.round(((entry.byCompany.get(short) ?? 0) + line.closing) * 100) / 100);
      cells.set(key, entry);
    }
  }

  for (const short of shorts) table.addColumn(short);
  table.addColumn("TOTAL");
  const rows: ResultRow[] = [];
  for (const entry of cells.values()) {
    // A line with nothing in any company is left out (the procedure deletes a company's zero lines before the pivot).
    if ([...entry.byCompany.values()].every((value) => value === 0)) continue;
    const row: ResultRow = { NAME: entry.name, SMART_SELECTED_SCHDULE: entry.schedule, BOOK: entry.book };
    let total = 0;
    for (const short of shorts) { const value = entry.byCompany.get(short); row[short] = value === undefined || value === 0 ? null : value; total += value ?? 0; }
    row.TOTAL = Math.round(total * 100) / 100;
    rows.push(row);
  }
  rows.sort((a, b) => num(a.BOOK) - num(b.BOOK) || toText(a.NAME).toLowerCase().localeCompare(toText(b.NAME).toLowerCase()));
  table.rows = rows;
  return table;
}
