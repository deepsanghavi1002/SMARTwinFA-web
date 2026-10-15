import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 171: SS CIRCLE PURCHASE / SALE (REPORT_SS_CIRCLE, SP_FRT_RPT_RPI_SS_CIRCLE_PURCHASE_SALE; SPECIAL > Extra Report (RP) > SS Circle).
 *
 * The purchase lines (book 13) of the period of the products of the group "SS Circles", a line each with the sale lines (book 8) that took the
 * purchase's number as their invoice number (the sale entry's INPUT_INVOICENO) for the same product: supplier, purchase date, entry and invoice
 * number, rate, product, quantity, then the party, sale invoice number and date, sale quantity and rate; BAL_QTY is the purchase quantity less the sale
 * quantity of the line. A purchase with no sale shows its own half. DN_DATE and DN_QTY are empty, as the procedure leaves them.
 * By purchase date (the procedure sorts the day and month text; here the dates), then number. One read.
 */
export async function ssCircle(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const rows = (await runReportSql(loader, `SELECT sc.doc_date AS purch_date, sc.doc_no, sc.name AS supplier, sc.full_docno AS entry_no, ltrim(rtrim(sc.doc_no1)) AS purch_inv, sc.rate AS purch_rate, sc.prod_desc, sc.quantity AS purch_qty,`
    + ` tc.name AS party, tc.doc_no AS sales_inv, tc.doc_date AS sales_date, tc.quantity AS sale_qty, tc.rate AS sale_rate`
    + ` FROM (SELECT ac.name, led.full_docno, led.doc_date, ltrim(rtrim(led.doc_no1)) AS doc_no1, ltrim(rtrim(led.doc_no)) AS doc_no, prodled.rate::numeric AS rate, prodmas.prod_desc, prodled.quantity::numeric AS quantity, prodled.prod_id`
    + ` FROM ${db}ledger led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}prod_ledger prodled ON prodled.led_id = led.led_key LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
    + ` LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodled.prod_id WHERE led.doc_pos <> 'D' AND prodled.il_pos = 'A' AND led.book = 13 AND lower(btrim(adata.txt_prodgroup)) = 'ss circles'`
    + ` AND led.doc_date BETWEEN $1::date AND $2::date) sc`
    + ` LEFT JOIN (SELECT ac1.name, ltrim(rtrim(led1.doc_no)) AS doc_no, led1.doc_date, prodled1.rate::numeric AS rate, prodled1.quantity::numeric AS quantity, prodled1.prod_id, ltrim(rtrim(aent1.input_invoiceno)) AS invoice_no`
    + ` FROM ${db}ledger led1 LEFT JOIN ${db}account ac1 ON ac1.code = led1.code LEFT JOIN ${db}prod_ledger prodled1 ON prodled1.led_id = led1.led_key LEFT JOIN ${db}addon_aentry aent1 ON aent1.aona_ledid = led1.led_key`
    + ` WHERE led1.doc_pos <> 'D' AND prodled1.il_pos = 'A' AND led1.book = 8) tc ON sc.doc_no = tc.invoice_no AND sc.prod_id = tc.prod_id`
    + ` ORDER BY sc.doc_date, tc.doc_date`, [desktopDate(call.from), desktopDate(call.upto)])).rows;

  const table = new ResultTable();
  for (const column of ["SORTING_DATE", "PURCH_DATE", "SUPPLIERS_NAME", "PURCH_ENTRY_NO", "PURCH_INV_NO", "PURCH_RATE", "PRODUCT_DESCRIPTION", "PURCH_QTY", "DN_DATE", "DN_QTY", "PARTY_NAME", "SALES_INV_NO", "SALES_DATE", "SALE_QTY", "SALE_RATE", "BAL_QTY"]) table.addColumn(column);
  for (const column of ["PURCH_RATE", "PURCH_QTY", "DN_QTY", "SALE_QTY", "SALE_RATE", "BAL_QTY"]) table.setKind(column, "decimal");
  const round = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  table.rows = rows.map((row, index) => {
    const date = row.purch_date as Date;
    const sold = row.sale_qty === null ? null : num(row.sale_qty);
    return { index, time: date.getTime(), doc: toText(row.doc_no), row: {
      SORTING_DATE: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}${toText(row.doc_no)}`, PURCH_DATE: dateStyle6(date), SUPPLIERS_NAME: toText(row.supplier), PURCH_ENTRY_NO: toText(row.entry_no),
      PURCH_INV_NO: toText(row.purch_inv), PURCH_RATE: num(row.purch_rate), PRODUCT_DESCRIPTION: toText(row.prod_desc), PURCH_QTY: num(row.purch_qty), DN_DATE: null, DN_QTY: null, PARTY_NAME: toText(row.party), SALES_INV_NO: toText(row.sales_inv),
      SALES_DATE: row.sales_date === null ? "" : dateStyle6(row.sales_date as Date), SALE_QTY: sold, SALE_RATE: row.sale_rate === null ? null : num(row.sale_rate), BAL_QTY: round(num(row.purch_qty) - (sold ?? 0)),
    } };
  }).sort((a, b) => a.time - b.time || a.doc.localeCompare(b.doc, undefined, { numeric: true }) || a.index - b.index).map((entry) => entry.row);
  return table;
}
