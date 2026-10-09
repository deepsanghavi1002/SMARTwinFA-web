import type { Loader } from "../master-program/load";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { sortRows, tableFromResult, textKey } from "./library";
import { detailQuery, summaryQueries } from "./dailyTransactionSql";
import { num, runReportSql } from "./run";

/**
 * SP_FRT_RPT_DAILY_TRANSACTION (REPORT > Extra > Daily Transaction, report 156). The Summary format is the day's figures in lines: the sale,
 * purchase, expense, deposits and withdrawals of each book, the inventory moved by product (sale, credit note, purchase, debit note, added,
 * less, production, job work), and the sale, purchase and expense by party. Any other format is the day's posted vouchers: payments,
 * receipts, journals, sale, purchase, credit and debit notes, expense and agency vouchers. The desktop builds the summary in
 * TEMP_TABLE_DAILY_TRANS_<machine>; here its lines are built in memory from read-only queries.
 */
export async function dailyTransaction(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const day = (date: Date) => `'${desktopDate(date)}'::date`;

  if (call.formating.toUpperCase() !== "SUMMARY") {
    const table = tableFromResult(await runReportSql(loader, frag(detailQuery(call.database, day(call.from), day(call.upto)))));
    for (const column of ["Debit", "Credit"]) table.setKind(column, "decimal");
    // ORDER BY SORTING_COL, date (its dd/mm/yyyy text), Voucher_No.
    sortRows(table, [(row) => textKey(row.SORTING_COL), (row) => textKey(row.Date), (row) => textKey(row.Voucher_No)]);
    return table;
  }

  const table = new ResultTable();
  for (const column of ["SORTING_COL", "SMART_NAME", "DESCRIPTION", "FIGURE"]) table.addColumn(column);
  table.setKind("FIGURE", "decimal");
  for (const query of summaryQueries(call.database, day(call.from), day(call.upto))) {
    for (const row of (await runReportSql(loader, frag(query.sql))).rows) table.rows.push({ SORTING_COL: query.sorting, SMART_NAME: query.smart, DESCRIPTION: row.DESCRIPTION ?? row.description ?? null, FIGURE: num(row.FIGURE ?? row.figure) });
  }
  sortRows(table, [(row) => textKey(row.SORTING_COL)]);
  return table;
}
