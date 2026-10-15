import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 172: HV PURCHASE (REPORT_HV_PURCHASE, SP_FRT_RPT_RPI_HV_PURCHASE; SPECIAL > Extra Report (RP) > HV Purchase): the purchase lines (book 13) of the period
 * from the ticked suppliers (the Account group), with the weight bought: PURCH_KGS = quantity x the product's standard weight (3 decimals).
 *  - Detail: a line each: invoice date and number (the supplier's), entry date and number, supplier, product, STD_WEIGHT, PURCH_QTY, RATE, VALUE, PURCH_KGS; by entry date then number.
 *  - Summary: a line for each supplier and product with the quantity and kilos.
 * One read.
 */
export async function hvPurchase(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const keys = call.selectKey[4].trim();
  if (!/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys)) throw new ReportRefusal("Select the suppliers (Account group)", "INTERNAL PROGRAM FAILURE");
  const params = [desktopDate(call.from), desktopDate(call.upto)];
  const summary = call.formating.toUpperCase() === "SUMMARY";
  const kilos = (quantity: unknown, weight: unknown) => Math.round((num(quantity) * num(weight) + 1e-9) * 1000) / 1000;
  const table = new ResultTable();

  if (summary) {
    const rows = (await runReportSql(loader, `SELECT ac.name, prodmas.prod_desc, prodmas.base_weight::numeric AS base_weight, sum(prodled.quantity::numeric) AS quantity`
      + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}account ac ON ac.code = prodled.code`
      + ` WHERE prodled.il_pos = 'A' AND prodmas.prod_pos = 'A' AND ac.a_pos = 'A' AND prodled.book = 13 AND prodled.led_id IS NOT NULL AND prodled.code IN ${keys} AND prodled.il_date BETWEEN $1::date AND $2::date`
      + ` GROUP BY ac.name, prodmas.prod_desc, prodmas.base_weight ORDER BY ac.name, prodmas.prod_desc`, params)).rows;
    for (const column of ["NAME", "Description", "STD_WEIGHT", "PURCH_QTY", "PURCH_KGS"]) table.addColumn(column);
    for (const column of ["STD_WEIGHT", "PURCH_QTY", "PURCH_KGS"]) table.setKind(column, "decimal");
    table.rows = rows.map((row): ResultRow => ({ NAME: toText(row.name), Description: toText(row.prod_desc), STD_WEIGHT: row.base_weight === null ? null : num(row.base_weight), PURCH_QTY: num(row.quantity), PURCH_KGS: kilos(row.quantity, row.base_weight) }));
    return table;
  }

  const rows = (await runReportSql(loader, `SELECT led.chln_date, ltrim(rtrim(led.doc_no1)) AS invoice_no, led.doc_date, ltrim(rtrim(led.doc_no)) AS entry_no, ac.name, prodmas.prod_desc, prodmas.base_weight::numeric AS base_weight,`
    + ` prodled.quantity::numeric AS quantity, prodled.rate::numeric AS rate, prodled.il_value::numeric AS value`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}account ac ON ac.code = prodled.code LEFT JOIN ${db}ledger led ON led.led_key = prodled.led_id`
    + ` WHERE prodled.il_pos = 'A' AND led.doc_pos = 'A' AND prodmas.prod_pos = 'A' AND ac.a_pos = 'A' AND prodled.book = 13 AND prodled.led_id IS NOT NULL AND prodled.code IN ${keys} AND prodled.il_date BETWEEN $1::date AND $2::date`
    + ` ORDER BY led.doc_date, led.doc_no`, params)).rows;
  for (const column of ["Invoice_Date", "Invoice_No", "Entry_Date", "Entry_No", "NAME", "Description", "STD_WEIGHT", "PURCH_QTY", "RATE", "VALUE", "PURCH_KGS"]) table.addColumn(column);
  for (const column of ["STD_WEIGHT", "PURCH_QTY", "RATE", "VALUE", "PURCH_KGS"]) table.setKind(column, "decimal");
  table.rows = rows.map((row): ResultRow => ({
    Invoice_Date: row.chln_date === null ? "" : dateStyle6(row.chln_date as Date), Invoice_No: toText(row.invoice_no), Entry_Date: dateStyle6(row.doc_date as Date), Entry_No: toText(row.entry_no), NAME: toText(row.name), Description: toText(row.prod_desc),
    STD_WEIGHT: row.base_weight === null ? null : num(row.base_weight), PURCH_QTY: num(row.quantity), RATE: num(row.rate), VALUE: row.value === null ? null : num(row.value), PURCH_KGS: kilos(row.quantity, row.base_weight),
  }));
  return table;
}
