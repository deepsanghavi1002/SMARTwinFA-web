import type { Loader } from "../master-program/load";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { sortRows, tableFromFields, textKey } from "./library";
import { bookwiseSelect, bookwiseWhere, numberAndBlank } from "./bookwiseSql";
import { runReportSql } from "./run";

/**
 * SP_FRT_RPT_BOOKWISE (REPORT > Outstanding > Bookwise, report 135): the entries of the period of the accounts of the books (parties,
 * book 1, 2 and 3; for the expense book 15 the general accounts) with the bills each was set against: the entry's date, voucher,
 * party and amount, then the bill's date, number and the amount set off. A voucher set against several bills shows once, the bills under it.
 * The desktop builds it in TEMP_TABLE_BOOKWISE_<machine>; here the rows are built in memory from a read-only query.
 */
export async function bookwise(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  // The BOOK combo's value is the book number when the combo gives no book column.
  const book = call.book >= 0 ? call.book : call.fcValue;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const parts = bookwiseSelect(call.database, book);
  const where = bookwiseWhere(call.where.split("|sys.yearid|").join(call.yearId), parts.extraWhere, day(call.from), day(call.upto));
  const result = await runReportSql(loader, frag(`SELECT ${parts.select} ${parts.from} ${where} ORDER BY led.doc_date, led.doc_no`));

  const table = tableFromFields(result.fields.filter((field) => field.name !== "LED_KEY"));
  table.addColumn("SR_NO");
  table.setKind("SR_NO", "int");
  for (const column of ["AMOUNT", "Ag_Amt"]) if (table.has(column)) table.setKind(column, "decimal");
  table.rows = numberAndBlank(result.rows);
  sortRows(table, [(row) => textKey(row.SORTING_COL)]);
  return table;
}
