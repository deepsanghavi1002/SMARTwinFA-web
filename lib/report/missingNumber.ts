import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { runReportSql } from "./run";

/**
 * 98: MISSING NUMBER (UTILITY_MISSING_NUMBER, SP_FRT_RPT_MISSING_NUMBER; UTILITY > Missing Number).
 * For the chosen book and series, between From and Upto, the document numbers that are not used: the numbers of the book's entries (ledger
 * entries of an actual book, stock vouchers of the others, in number order, a number with letters left out) are walked and every number
 * skipped between two entries is listed. The procedure collects them in a work table per machine and compares the numbers as text; the web
 * collects them in memory and compares them as numbers (as a text compare passes "9" over "10" and loses what lies between).
 */
export async function missingNumber(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  // @DOC_SERIES: the series text inside the where the series choice made (" where rtrim(led.doc_series) = 'X'").
  const series = (/doc_series\)?\s*=\s*'([^']*)'/i.exec(call.where)?.[1] ?? call.seriesText).trim();
  if (series === "") throw new ReportRefusal("Select the series of the book first.", "Missing Number");
  const period = [desktopDate(call.from), desktopDate(call.upto)];

  const book = (await runReportSql(loader, `SELECT book_actual, stkm_forbook, stkm_short FROM ${db}book_properties WHERE btrim(book_desc) = btrim($1) LIMIT 1`, [call.fcText])).rows[0];
  const actual = toText(book?.book_actual) === "Y";
  const entries = actual
    ? (await runReportSql(loader, `SELECT btrim(doc_no) AS doc_no, unique_key AS entry_key FROM ${db}ledger WHERE book_code = $1 AND doc_pos = 'A' AND btrim(doc_series) = $2 AND full_docno <> 'Auto/999999' AND doc_posting = 'P'`
      + ` AND doc_date >= $3::date AND doc_date <= $4::date AND doc_no !~ '[A-Za-z]' ORDER BY lpad(btrim(doc_no), 10)`, [call.fcValue, series, ...period])).rows
    : (await runReportSql(loader, `SELECT btrim(doc_no2) AS doc_no, process_key AS entry_key FROM ${db}process WHERE btrim(stk_module) = btrim($1) AND il_pos = 'A' AND btrim(p_docseries) = $2`
      + ` AND p_date >= $3::date AND p_date <= $4::date AND doc_no2 !~ '[A-Za-z]' ORDER BY lpad(btrim(doc_no2), 10)`, [toText(book?.stkm_short), series, ...period])).rows;

  const missing: number[] = [];
  let expected: number | null = null;
  let previousKey: unknown = 0;
  for (const entry of entries) {
    const number = Number(toText(entry.doc_no));
    if (!Number.isInteger(number)) continue;
    expected ??= number;
    // An entry has a ledger row for each of its sides: the next row of the same entry is not counted again.
    if (previousKey !== entry.entry_key) {
      while (expected < number) { missing.push(expected); expected += 1; }
      expected += 1;
    }
    previousKey = entry.entry_key;
  }

  const table = new ResultTable();
  table.addColumn("DOC_NO");
  table.rows = missing.map((value) => ({ DOC_NO: String(value) }));
  return table;
}
