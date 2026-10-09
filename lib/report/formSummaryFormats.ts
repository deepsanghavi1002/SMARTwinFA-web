import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { sortRows, tableFromResult, textKey } from "./library";
import { formatParts, readsReturnAccounts, sumColumns, taxOnlyColumns } from "./formSummaryFormatsSql";
import type { AmountColumns } from "./formSummaryFormatsSql";
import { num, runReportSql } from "./run";

/**
 * SP_FRT_RPT_FORM_SUMM (REPORT > Register > Form Summary, report 14, with a format): the Form Summary's
 * tax lines summed. "Details (Summarized Taxes)" (SM_SUMMARY) gives a row a voucher and tax line,
 * "Summary For Period Selected" (SUMMARY) a row a tax line for the whole period. The amount columns are
 * the standard report's (SP_FOMSUMM_COLS); see formSummary in reportStandard.ts.
 *
 * Read as the desktop does: a return account is looked for as "16" or "11" anywhere in the ticked keys
 * (no comma, no CHK_CRCASCOM test), unlike the standard report. The opposite book of the amounts is read
 * as the standard report reads it, with ",10".
 */
export async function formSummaryFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const book = call.fcValue;
  const against = call.againstBook;
  const combined = call.showNarration;
  const groupKeys = call.firstHelpKeys.filter((key) => /^\d+$/.test(key));
  if (groupKeys.length === 0) throw new ReportRefusal("Minimum One Account Should Be Selected To Generate Report", "No Selections Done!");
  const key5 = `,${groupKeys.join(",")},`;
  const keys = groupKeys.join(",");

  const oppBook = key5.includes(",16") || key5.includes(",11") || key5.includes(",10")
    ? ([8, 9].includes(book) ? "16" : [13, 14].includes(book) ? "11" : book === 15 ? "10" : "") : "";
  const inBook = book === 8 ? "8,9" : book === 13 ? "13,14" : book === 15 ? "10,15" : [11, 16].includes(book) ? String(against) : `'${book}'`;

  // The tax slabs of the period for the book (TMP_SLAB).
  const slabBook = [11, 16].includes(book) ? String(against) : book === 10 ? "15" : String(book);
  const slabRows = (await runReportSql(loader, frag(`SELECT slab_key FROM ${db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND BOOK = ${slabBook} and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' and SLAB_UPTODT = '${desktopDate(call.tarikh2)}' ORDER BY SLAB_ORDER`))).rows;
  if (slabRows.length === 0) throw new ReportRefusal("No tax slab is set for this book and year (Internal program failure).", "Internal program failure");
  const slabKey = slabRows.map((row) => `'${num(row.slab_key)}'`).join(",");
  const lastPlace = num((await runReportSql(loader, `SELECT MAX(IDOPT_KEY) AS m FROM ${db}IDOPT_MASTER WHERE IDOPT_FLAG = 'TP'`)).rows[0]?.m);

  // SP_FOMSUMM_COLS: the amount columns (as formSummary builds them).
  const signed = (column: string) => (oppBook !== "" ? `(CASE WHEN LED.BOOK = ${oppBook} THEN (LEDEXT.${column} * -1) ELSE LEDEXT.${column} END)` : `LEDEXT.${column}`);
  const net = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN (${signed("S_LASTOT")} - ${signed("SLAB_AMT")}) ELSE ${signed("SLAB_AMT")} END)`;
  const tax = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN ${signed("SLAB_AMT")} ELSE 0.00 END)`;
  const fin = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN ${signed("S_LASTOT")} ELSE ${signed("SLAB_AMT")} END)`;
  const forBooks = (books: string) => (column: string) => `CASE WHEN LED.BOOK ${books} THEN ${column} ELSE 0.00 END`;
  const cashBooks = book === 8 ? "IN (9,11)" : book === 13 ? "IN (14,16)" : book === 15 ? "IN (10)" : "";
  const returnBook = [8, 9].includes(book) ? "16" : [13, 14].includes(book) ? "11" : book === 15 ? "10" : "";
  const columns: AmountColumns = {
    bnet: combined ? "" : forBooks(`= ${book}`)(net), btax: combined ? "" : forBooks(`= ${book}`)(tax),
    cnnet: combined || cashBooks === "" ? "" : forBooks(cashBooks)(net), cntax: combined || cashBooks === "" ? "" : forBooks(cashBooks)(tax),
    rnet: combined || oppBook === "" || returnBook === "" ? "" : forBooks(`= ${returnBook}`)(net), rtax: combined || oppBook === "" || returnBook === "" ? "" : forBooks(`= ${returnBook}`)(tax),
    totnet: net, tottax: tax, totfin: fin,
  };

  const parts = formatParts(call.formating, slabKey, lastPlace !== 0 ? String(lastPlace + 1) : "101", sumColumns(columns));
  if (!parts) throw new ReportRefusal("Internal program failure\nQuery Was Blank", "INTERNAL PROGRAM FAILURE");

  let where = call.where;
  if (readsReturnAccounts(groupKeys)) where += ` AND (LED.BOOK_CODE IN (${keys}) OR LED.AG_BKCODE IN (${keys})) AND (LED.BOOK IN (${inBook}) OR LED.AG_BOOK IN (${inBook}))`;
  else where += ` AND (LED.BOOK_CODE IN (${keys})) AND (LED.BOOK IN (${inBook}))`;
  where += ` AND ((CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) AND TAX.TAX_DESC IS NULL THEN 'sys.remove' ELSE TAX.TAX_DESC END) <> 'sys.remove' OR LEDEXT.SLAB_ID not in (${slabKey}))`;
  where += ` AND SLAB.SLAB_ORDER >= (SELECT SM.SLAB_ORDER FROM ${db}SLAB_MASTER SM WHERE SM.SLAB_KEY in (${slabKey}) LIMIT 1)`;
  where += ` AND LED.DOC_DATE BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}'`;

  // TAX_MASTER.TAX_TYPE is text in this schema: the join to IDOPT_MASTER needs it as a number.
  const from = call.from_.split("TAX.TAX_TYPE").join("nullif(TAX.TAX_TYPE,'')::int");
  const result = await runReportSql(loader, frag(`SELECT IDOP.OPT_DESC,${parts.select} ${from} ${where} GROUP BY IDOP.OPT_DESC,${parts.groupBy} ORDER BY ${parts.orderBy}`));
  const table = tableFromResult(result);
  for (const column of ["B_NET", "B_TAX", "CN_NET", "CN_TAX", "R_NET", "R_TAX", "TOT_NET", "TOT_TAX", "TOT_FIN"]) if (table.has(column)) table.setKind(column, "decimal");

  // SGST / UTGST lines carry their tax only.
  const zeroed = taxOnlyColumns(book, check("CHK_CRCASCOM"), (column) => table.has(column));
  for (const row of table.rows) {
    const place = toText(table.get(row, "OPT_DESC")).toUpperCase();
    if (place !== "SGST" && place !== "UTGST") continue;
    for (const column of zeroed) table.set(row, column, 0);
    table.set(row, "TOT_NET", 0);
    table.set(row, "TOT_FIN", table.get(row, "TOT_TAX"));
  }
  sortRows(table, [(row) => textKey(table.get(row, "TAX_PLACE_DESC"))]);
  return table;
}
