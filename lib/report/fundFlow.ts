import type { Loader } from "../master-program/load";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { dayBefore, sortRows, textKey } from "./library";
import type { FundLine } from "./fundFlowPivot";
import { pivotFundFlow } from "./fundFlowPivot";
import { money, num, runReportSql } from "./run";

/**
 * SP_FRT_RPT_FUND_FLOW: where the cash and bank books' money came from and went to. A row a
 * schedule (balance sheet head) of the accounts the books were posted against, a column a cash /
 * bank book (account books 4 and 6, named by A_MAPCODE), TOTAL, and PERC (the row's share of the
 * receipts, or of the payments, in %). "  Opening" rows carry each book's balance at From (the
 * year's opening, plus its postings from the year's start to the day before From). The desktop
 * builds this in TEMP_TABLE_RECPT_ / PAY_ / FUND_<machine>; here the same lines are built in
 * memory from read-only queries, so the report never writes.
 *
 * The date is the voucher's, or the reconciliation date when "CHK_RECODATE" is ticked.
 *
 * Where the desktop's SQL is loose the web does what it meant, and only here:
 *  - the books' opening balances are read for the report's year (the desktop joined AC_BALANCE on
 *    the account alone, so a second year's row would have been counted twice);
 *  - a book name repeated among the books is one column (the desktop's PIVOT refuses duplicates);
 *  - a side whose rows add up to nothing gets no PERC (the desktop divides by zero).
 */
export async function fundFlow(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const year = call.yearId.replace(/'/g, "''");
  const schedules = call.selectScheduleKey.trim();
  if (!/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(schedules)) throw new ReportRefusal("Select the schedules to report.", "No Selections Done!");
  const dateColumn = call.checkQuery.includes("CHK_RECODATE,") ? "reco_date" : "doc_date";
  const day = (date: Date) => `'${desktopDate(date)}'::date`;

  // One column a cash / bank book.
  const named = await runReportSql(loader, `select distinct ltrim(rtrim(a_mapcode)) as "name" from ${db}account where a_pos <> 'D' and book in (4,6) and coalesce(a_mapcode,'') <> '' order by 1`);
  const books: string[] = [];
  for (const row of named.rows) {
    const name = String(row.name);
    if (!books.some((book) => book.toLowerCase() === name.toLowerCase())) books.push(name);
  }
  if (books.length === 0) throw new ReportRefusal("No cash or bank book has a map code (A_MAPCODE).", "INTERNAL PROGRAM FAILURE");

  const lines: FundLine[] = [];
  const side = async (debit: 1 | 2, sideName: "RECEIPT" | "PAYMENT") => {
    const result = await runReportSql(loader,
      `select bs.bs_desc as "PARTICULAR", ltrim(rtrim(ac1.a_mapcode)) as "BOOK_NAME", sum(led.amount::numeric) as "AMOUNT"`
      + ` from ${db}account ac left join ${db}ac_balance acbal on ac.code = acbal.code left join ${db}balsheet bs on ac.bs_id = bs.bs_key`
      + ` left join ${db}ledger led on ac.code = led.code and led.${dateColumn} between ${day(call.from)} and ${day(call.upto)}`
      + ` left join ${db}account ac1 on ac1.code = led.book_code`
      + ` where led.ac_dbcode = ${debit} and led.doc_pos <> 'D' and ac.a_pos <> 'D' and acbal.year_id = '${year}' and led.book in (4,6) and ac.bs_id in ${schedules}`
      + ` group by bs.bs_desc, ltrim(rtrim(ac1.a_mapcode))`);
    for (const row of result.rows) {
      const amount = num(row.AMOUNT);
      lines.push({ side: sideName, particular: row.PARTICULAR === null || row.PARTICULAR === undefined ? null : String(row.PARTICULAR), book: String(row.BOOK_NAME ?? ""), amount: sideName === "PAYMENT" ? money(amount * -1) : money(amount) });
    }
  };
  await side(2, "RECEIPT");
  await side(1, "PAYMENT");

  // Each book's balance at From: a debit balance is money received, a credit balance money paid.
  const priorTo = call.from.getTime() !== call.tarikh1.getTime();
  const opening = await runReportSql(loader, priorTo
    ? `select ltrim(rtrim(ac.a_mapcode)) as "name", acbal.opening::numeric + (coalesce(sum(case when led.bk_dbcode = 1 then led.amount::numeric else 0.00 end),0.00) - coalesce(sum(case when led.bk_dbcode = 2 then led.amount::numeric else 0.00 end),0.00)) as "opening"`
      + ` from ${db}account ac left join ${db}ac_balance acbal on acbal.code = ac.code and acbal.year_id = '${year}'`
      + ` left join ${db}ledger led on led.book_code = ac.code and led.${dateColumn} between ${day(call.tarikh1)} and ${day(dayBefore(call.from))} and led.doc_pos <> 'D'`
      + ` where ac.a_pos <> 'D' and ac.book in (4,6) group by acbal.opening, ac.a_mapcode order by ac.a_mapcode`
    : `select ltrim(rtrim(ac.a_mapcode)) as "name", acbal.opening::numeric as "opening" from ${db}account ac left join ${db}ac_balance acbal on acbal.code = ac.code and acbal.year_id = '${year}'`
      + ` where ac.a_pos <> 'D' and ac.book in (4,6) order by ac.a_mapcode`);
  for (const row of opening.rows) {
    if (row.opening === null || row.opening === undefined || row.name === null || row.name === undefined) continue;
    const amount = money(num(row.opening));
    if (amount !== 0) lines.push({ side: amount > 0 ? "RECEIPT" : "PAYMENT", particular: "  Opening", book: String(row.name), amount });
  }

  const table = new ResultTable();
  for (const column of ["PARTICULAR", "SMART_SELECTED_SCHDULE", ...books, "TOTAL", "PERC"]) table.addColumn(column);
  for (const column of [...books, "TOTAL", "PERC"]) table.setKind(column, "decimal");
  table.rows = pivotFundFlow(books, lines);
  // SMART_SELECTED_SCHDULE desc (receipts first), then PARTICULAR.
  sortRows(table, [(row) => (row.SMART_SELECTED_SCHDULE === "RECEIPT" ? 0 : 1), (row) => textKey(row.PARTICULAR)]);
  return table;
}
