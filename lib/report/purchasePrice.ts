import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 198: PURCHASE PRICE ANALYSIS (REPORT_RPI_PURCHASE_PRICE, SP_FRT_RPT_RPI_PURCHASE_PRICE; SPECIAL > Extra Report (RP) > Purchase Price Analysis): the purchase lines
 * (book 13) of the period from the ticked suppliers (the Account group), a line each (invoice and entry dates and numbers, supplier, item, received quantity and
 * rate, the invoice's value), against the lowest rate that item was bought at in the period from ANY supplier (Min_Bill / MIN_ENT date and number, MIN_party_name,
 * MIN_Qty, MIN_Rate): Diff_Rate (received less lowest rate), Min_Val_Act_Rate (the lowest rate x the quantity received) and Diff_Value (the value less that), by
 * supplier, item and entry date. The lowest rate line is the first of the lowest rate (the procedure takes any of them). One read for the lines, one for the lows.
 */
export async function purchasePrice(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const suppliers = call.selectKey[4].trim();
  if (!/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(suppliers)) throw new ReportRefusal("Select the suppliers (Account group)", "INTERNAL PROGRAM FAILURE");
  const params = [desktopDate(call.from), desktopDate(call.upto)];
  const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  const from = `FROM ${db}ledger led LEFT JOIN ${db}prod_ledger prodled ON prodled.led_id = led.led_key LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}account ac ON ac.code = led.code`;
  const where = `WHERE led.doc_date BETWEEN $1::date AND $2::date AND led.doc_pos <> 'D' AND prodled.il_pos <> 'D' AND led.book = 13`;

  const lines = (await runReportSql(loader, `SELECT led.chln_date, btrim(led.doc_no1) AS invoice_no, led.doc_date, btrim(led.doc_no) AS entry_no, prodled.prod_id, ac.name AS party, prodmas.prod_desc AS item, prodled.factor::numeric AS qty,`
    + ` prodled.rate::numeric AS rate, prodled.il_value::numeric AS value ${from} ${where} AND led.code IN ${suppliers}`, params)).rows;
  const lows = new Map<number, ResultRow>();
  const keys = [...new Set(lines.map((row) => num(row.prod_id)))];
  if (keys.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prodled.prod_id) prodled.prod_id, led.doc_date, btrim(led.doc_no) AS doc_no, ac.name AS party, prodled.factor::numeric AS qty, prodled.rate::numeric AS rate`
      + ` ${from} ${where} AND prodled.prod_id = ANY($3::int[]) ORDER BY prodled.prod_id, prodled.rate, led.doc_date, led.led_key`, [...params, keys])).rows) lows.set(num(row.prod_id), row);
  }

  const table = new ResultTable();
  for (const column of ["Invoice_Date", "Invoice_No", "Entry_Date", "Entry_No", "prod_id", "Party_Name", "Item", "Recd_Qty", "Recd_Rate", "Inv_Total_Value", "Min_Bill_Date", "Min_Bill_No", "MIN_ENT_DATE", "MIN_ENT_NO", "min_party_name", "MIN_Qty", "MIN_Rate",
    "Min_Val_Act_Rate", "Diff_Rate", "Diff_Value"]) table.addColumn(column);
  for (const column of ["Recd_Qty", "Recd_Rate", "Inv_Total_Value", "MIN_Qty", "MIN_Rate", "Min_Val_Act_Rate", "Diff_Rate", "Diff_Value"]) table.setKind(column, "decimal");
  table.rows = lines.map((row, index) => {
    const low = lows.get(num(row.prod_id));
    const received = num(row.qty);
    const rate = num(row.rate);
    const lowRate = low ? round2(num(low.rate)) : 0;
    const lowDate = low ? dateStyle6(low.doc_date as Date) : "";
    const actual = round2(lowRate * received);
    return { index, party: toText(row.party), item: toText(row.item), date: (row.doc_date as Date).getTime(), entryNo: toText(row.entry_no), row: {
      Invoice_Date: row.chln_date === null ? "" : dateStyle6(row.chln_date as Date), Invoice_No: toText(row.invoice_no), Entry_Date: dateStyle6(row.doc_date as Date), Entry_No: toText(row.entry_no), prod_id: num(row.prod_id), Party_Name: toText(row.party), Item: toText(row.item),
      Recd_Qty: received, Recd_Rate: rate, Inv_Total_Value: row.value === null ? null : num(row.value), Min_Bill_Date: lowDate, Min_Bill_No: low ? toText(low.doc_no) : "", MIN_ENT_DATE: lowDate, MIN_ENT_NO: low ? toText(low.doc_no) : "", min_party_name: low ? toText(low.party) : "",
      MIN_Qty: low ? round2(num(low.qty)) : 0, MIN_Rate: lowRate, Min_Val_Act_Rate: actual, Diff_Rate: round2(rate - lowRate), Diff_Value: row.value === null ? null : round2(num(row.value) - actual),
    } };
  }).sort((a, b) => a.party.toLowerCase().localeCompare(b.party.toLowerCase()) || a.item.toLowerCase().localeCompare(b.item.toLowerCase()) || a.date - b.date || a.entryNo.localeCompare(b.entryNo, undefined, { numeric: true }) || a.index - b.index).map((entry) => entry.row);
  return table;
}
