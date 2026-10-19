import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 111: QUERY (REPORT_QUERY, SP_FRT_RPT_QUERY; UTILITY > Query). The first combo says what is listed:
 *  - ACCOUNT ENTRY: the ledger entries of the period (posted, doc_pos 'A') by book and date: key, book, book name, date, document number, invoice
 *    number, series, full document number, the account with its debit / credit amount, and a column for each account entry addon (ADDON_FLD of
 *    entry position L: the text of a master addon, the typed value of the others). With "With Posting Account Require" a line for each posting
 *    of the entry (the accounts but the book's own), its amount on the debit or credit side; otherwise the entry's own account and amount.
 *  - INVENTORY: the stock lines of the period: key, process, book (the ledger book's account, or the book of a stock voucher), date, document,
 *    account, product, quantity and rate.
 * The lines are ordered by book name first (then the procedure's book, date, number) so that a book's lines, and its subtotal, are together.
 * An error in the query is returned, as the procedure does, as QUERY_ERROR, QUERY and ERROR_DETAILS.
 *
 * The procedure also joins ADDON_DATA on the account without using it; an account has several rows there, so every entry came out once for each of
 * them. The web leaves the join out: each entry is listed once.
 */
const dmy = (column: string) => `to_char(${column}, 'DD/MM/YYYY')`;

export async function queryReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const schema = loader.session.companySchema;
  const first = call.fcText.trim().toUpperCase();
  if (first !== "ACCOUNT ENTRY" && first !== "INVENTORY") throw new ReportRefusal("Select what to list first.", "Query");
  const period = [desktopDate(call.from), desktopDate(call.upto)];
  const table = new ResultTable();
  let text = "";

  try {
    if (first === "ACCOUNT ENTRY") {
      // The entry addons: ADDON_FLD's save names; a column the entry addon table does not have is left out.
      const have = new Set((await runReportSql(loader, "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'addon_aentry'", [schema])).rows.map((row) => toText(row.column_name).toLowerCase()));
      const fields = (await runReportSql(loader, `SELECT fiel_save, fiel_type FROM ${schema}.addon_fld WHERE fiel_relate = 'A' AND fiel_entrypos = 'L' AND fiel_pos <> 'D'`)).rows;
      const addon: string[] = [];
      const addonColumns: string[] = [];
      for (const field of fields) {
        const save = toText(field.fiel_save);
        const column = `${toText(field.fiel_type) === "M" ? "txt" : "input"}_${save}`.toLowerCase();
        if (!/^[A-Za-z0-9_]+$/.test(save) || !have.has(column) || addonColumns.includes(save)) continue;
        addonColumns.push(save);
        addon.push(`COALESCE(aent.${column}::text, '') AS "${save}"`);
      }
      const posting = call.checkQuery.includes("CHK_WITHPOST,");
      const head = `led.led_key AS "SMART_LED_KEY", led.book AS "BOOK", btrim(ac1.name) AS "SMART_NAME", btrim(ac1.name) AS "BOOK_NAME", ${dmy("led.doc_date")} AS "SELECTED_DATE", btrim(led.doc_no) AS "DOC_NO", btrim(led.doc_no1) AS "NO", led.doc_series AS "SERIES", led.full_docno AS "FULL_DOCNO", ac.name AS "NAME",`;
      const sides = posting
        ? `CASE WHEN ledpost.post_dbcode = 1 THEN ledpost.post_amt::numeric ELSE 0.00 END AS "DR_AMOUNT", CASE WHEN ledpost.post_dbcode = 2 THEN ledpost.post_amt::numeric ELSE 0.00 END AS "CR_AMOUNT"`
        : `CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE 0.00 END AS "DR_AMOUNT", CASE WHEN led.ac_dbcode = 2 THEN led.amount::numeric ELSE 0.00 END AS "CR_AMOUNT"`;
      // The entry's addon row is joined once (the procedure's subselect for every column of every line reads the table over and over).
      const aentry = addon.length > 0 ? ` LEFT JOIN (SELECT DISTINCT ON (aona_ledid) * FROM ${schema}.addon_aentry WHERE aona_ledid > 0 ORDER BY aona_ledid, aona_key) aent ON aent.aona_ledid = led.led_key` : "";
      const from = posting
        ? `FROM ${schema}.ledger led${aentry} LEFT JOIN ${schema}.ledger_post ledpost ON ledpost.led_id = led.led_key LEFT JOIN ${schema}.account ac ON ac.code = ledpost.post_code LEFT JOIN ${schema}.account ac1 ON ac1.code = led.book_code`
        + ` WHERE led.doc_date >= $1::date AND led.doc_date <= $2::date AND led.doc_pos = 'A' AND ledpost.post_code <> ledpost.post_bookcd AND ledpost.post_code <> ledpost.post_book`
        + ` ORDER BY btrim(ac1.name), led.book, led.doc_date, led.doc_no, ledpost.post_amt DESC, ac.name`
        : `FROM ${schema}.ledger led${aentry} LEFT JOIN ${schema}.account ac ON ac.code = led.code LEFT JOIN ${schema}.account ac1 ON ac1.code = led.book_code WHERE led.doc_date >= $1::date AND led.doc_date <= $2::date AND led.doc_pos = 'A' ORDER BY btrim(ac1.name), led.book, led.doc_date, led.doc_no`;
      text = `SELECT ${head} ${sides}${addon.length > 0 ? `, ${addon.join(", ")}` : ""} ${from}`;
      const columns = ["SMART_LED_KEY", "BOOK", "SMART_NAME", "BOOK_NAME", "SELECTED_DATE", "DOC_NO", "NO", "SERIES", "FULL_DOCNO", "NAME", "DR_AMOUNT", "CR_AMOUNT", ...addonColumns];
      for (const column of columns) table.addColumn(column);
      for (const column of ["DR_AMOUNT", "CR_AMOUNT"]) table.setKind(column, "decimal");
      for (const column of ["SMART_LED_KEY", "BOOK"]) table.setKind(column, "int");
      table.rows = (await runReportSql(loader, text, period)).rows.map((row) => {
        const out: ResultRow = {};
        for (const column of columns) out[column] = ["DR_AMOUNT", "CR_AMOUNT", "SMART_LED_KEY", "BOOK"].includes(column) ? num(row[column]) : row[column];
        return out;
      });
      return table;
    }

    const bookName = "CASE WHEN prodled.process_id > 0 THEN btrim(ac2.book_desc) ELSE btrim(ac1.name) END";
    text = `SELECT prodled.led_id AS "SMART_LED_KEY", prodled.process_id AS "PROCESS_ID", prodled.book AS "BOOK", ${bookName} AS "SMART_NAME", ${bookName} AS "BOOK_NAME", ${dmy("prodled.il_date")} AS "SELECTED_DATE", prodled.full_docno AS "FULL_DOCNO",`
      + ` ac.name AS "NAME", prodmas.prod_desc AS "DESCRIPTION", prodled.quantity AS "QUANTITY", round(prodled.rate::numeric, 2) AS "RATE" FROM ${schema}.prod_ledger prodled LEFT JOIN ${schema}.account ac ON ac.code = prodled.code`
      + ` LEFT JOIN ${schema}.account ac1 ON ac1.code = prodled.book_code AND prodled.led_id > 0 LEFT JOIN ${schema}.book_properties ac2 ON ac2.book_key = prodled."TYPE" AND prodled.process_id > 0`
      + ` LEFT JOIN ${schema}.product_master prodmas ON prodmas.prod_key = prodled.prod_id WHERE prodled.il_date >= $1::date AND prodled.il_date <= $2::date AND prodled.il_pos = 'A' ORDER BY ${bookName}, prodled.il_date`;
    const columns = ["SMART_LED_KEY", "PROCESS_ID", "BOOK", "SMART_NAME", "BOOK_NAME", "SELECTED_DATE", "FULL_DOCNO", "NAME", "DESCRIPTION", "QUANTITY", "RATE"];
    for (const column of columns) table.addColumn(column);
    for (const column of ["QUANTITY", "RATE"]) table.setKind(column, "decimal");
    for (const column of ["SMART_LED_KEY", "PROCESS_ID", "BOOK"]) table.setKind(column, "int");
    table.rows = (await runReportSql(loader, text, period)).rows.map((row) => {
      const out: ResultRow = {};
      for (const column of columns) out[column] = ["QUANTITY", "RATE", "SMART_LED_KEY", "PROCESS_ID", "BOOK"].includes(column) ? num(row[column]) : row[column];
      return out;
    });
    return table;
  } catch (error) {
    if (error instanceof ReportRefusal) throw error;
    // The procedure's CATCH: the message, the query and "Error No : 505 / Internal Program Failure" as the result.
    const failed = new ResultTable();
    for (const column of ["QUERY_ERROR", "QUERY", "ERROR_DETAILS"]) failed.addColumn(column);
    failed.rows = [{ QUERY_ERROR: error instanceof Error ? error.message : String(error), QUERY: text, ERROR_DETAILS: "Error No : 505\nInternal Program Failure" }];
    return failed;
  }
}
