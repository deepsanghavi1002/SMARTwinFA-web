import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { phnDate, style6 } from "./productionSetoff";
import { num, runReportSql } from "./run";

/**
 * 231: ORDER CLEARANCE (REPORT_RPI_ORDER_CLEARANCE, SP_FRT_RPT_RPI_ORDER_CLEARANCE; SPECIAL > Extra Report (RP1) > Order Clearance).
 * The orders (ORD-IN lines, order date From..Upto, the Account help's picks) with the bills made against each line (PROD_LINK): a line for each order line and bill
 * (a line without a bill when none): order date and no, party, description, group, specification, job card, order quantity (the line's first row only; an
 * order before the year's start comes as what is not yet adjusted), rate and value, short close, the original and revised delivery dates (the days between
 * them), the bill's entry date / no, bill date and no, quantity, rate and value; the balance (ordered less short closed and billed, on the first row), its value
 * and the delay (days from the revised delivery date to the bill, +1). "Pending Order" keeps the lines with a balance. By party, then order date.
 * The bills of all the order lines are one read (the procedure's join of the whole ledger).
 */
const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
const day = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
/** A delivery date text (dd/Mon/yyyy or mm/dd/yyyy) as a date. */
const textDate = (text: string): Date | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(phnDate(text));
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
};

export async function orderClearance(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const codes = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? call.selectKey[4].trim() : "";
  const period = [desktopDate(call.from), desktopDate(call.upto)];
  const pendingOnly = call.checkQuery.includes("CHK_PENDORD,");

  const orders = (await runReportSql(loader, `SELECT prodled.il_key, prodled.process_id, prodled.prod_id, prodled.il_date, prodled.full_docno, btrim(ac.name) AS name, product.prod_short, product.prod_desc, adata.txt_prodgroup AS prod_group, aent.input_remark AS specification,`
    + ` CASE WHEN prodled.il_date < $3::date THEN prodled.quantity::numeric - prodled.act_value::numeric ELSE prodled.quantity::numeric END AS qty, prodled.rate::numeric AS rate, prodled.setof_qty::numeric AS short_close, aent.input_pjobcard AS job_card,`
    + ` aent.input_sch_date AS original, aent.input_revis_date AS revised FROM ${db}prod_ledger prodled RIGHT JOIN ${db}product_master product ON prodled.prod_id = product.prod_key LEFT JOIN ${db}process proces ON prodled.process_id = proces.process_key`
    + ` LEFT JOIN ${db}account ac ON ac.code = proces.code LEFT JOIN ${db}addon_ientry aent ON aent.aoni_il_id = prodled.il_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodled.prod_id`
    + ` WHERE product.prod_pos <> 'D' AND prodled.il_pos = 'A' AND btrim(prodled.trn_module) = 'ORD-IN' AND proces.il_pos = 'A' AND prodled.il_date >= $1::date AND prodled.il_date <= $2::date${codes === "" ? "" : ` AND prodled.code IN ${codes}`}`
    + ` ORDER BY prodled.il_key`, [...period, desktopDate(call.tarikh1)])).rows;

  // The bills linked to those order lines.
  const bills = new Map<string, ResultRow[]>();
  if (orders.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT pl.led_rec1, pl.iled_rec1, prodled.prod_id, prodled.il_key, prodled.il_date, prodled.full_docno, prodled.quantity::numeric AS qty, prodled.rate::numeric AS rate, prodled.il_value::numeric AS il_value, btrim(led.doc_no1) AS bill_no, led.chln_date`
      + ` FROM ${db}prod_link pl JOIN ${db}ledger led ON pl.led_rec2 = led.led_key JOIN ${db}prod_ledger prodled ON prodled.il_key = pl.iled_rec2 AND prodled.led_id = led.led_key JOIN ${db}product_master product ON prodled.prod_id = product.prod_key`
      + ` WHERE product.prod_pos <> 'D' AND led.doc_pos <> 'D' AND prodled.il_pos <> 'D'${codes === "" ? "" : ` AND prodled.code IN ${codes}`} AND pl.iled_rec1 = ANY($1::int[]) ORDER BY prodled.il_date, prodled.il_key`, [orders.map((row) => num(row.il_key))])).rows) {
      const key = `${num(row.led_rec1)}|${num(row.iled_rec1)}|${num(row.prod_id)}`;
      const list = bills.get(key);
      if (list) list.push(row); else bills.set(key, [row]);
    }
  }

  const table = new ResultTable();
  const columns = ["SORTING_COL", "ORD_DATE", "ORDER_NO", "Serial_No", "NAME", "DESCRIPTION", "prod_group", "Specification", "JOB_CARD_NO", "ORD_QTY", "ORDER_RATE", "ORDER_VALUE", "SHORT_CLOSE", "ORIGINAL_DELIVERY_DATE", "REVISED_DELIVERY_DATE", "CHANGE_DAYS",
    "ENTRY_DATE", "ENTRY_NO", "BILL_DATE", "BILL_NO", "BILL_QTY", "BILL_RATE", "BILL_VALUE", "SR_NO", "BALANCE", "BAL_VALUE", "Delay_Days"];
  for (const column of columns) table.addColumn(column);
  for (const column of ["Serial_No", "CHANGE_DAYS", "SR_NO", "Delay_Days"]) table.setKind(column, "int");
  for (const column of ["ORD_QTY", "ORDER_RATE", "ORDER_VALUE", "SHORT_CLOSE", "BILL_QTY", "BILL_RATE", "BILL_VALUE", "BALANCE", "BAL_VALUE"]) table.setKind(column, "decimal");

  type Line = { name: string; date: Date; doc: string; row: ResultRow };
  const lines: Line[] = [];
  const ymd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  for (const order of orders) {
    const date = order.il_date as Date;
    const original = order.original as Date | null;
    const revised = textDate(toText(order.revised));
    const qty = r2(num(order.qty));
    const rate = num(order.rate);
    const list = bills.get(`${num(order.process_id)}|${num(order.il_key)}|${num(order.prod_id)}`) ?? [null];
    const billed = list.reduce((total, bill) => total + (bill && num(bill.qty) > 0 ? num(bill.qty) : 0), 0);
    const hasBill = list.some((bill) => bill !== null && num(bill.qty) > 0);
    list.forEach((bill, index) => {
      const first = index === 0;
      const billDate = bill && bill.chln_date ? (bill.chln_date as Date) : null;
      const billQty = bill ? num(bill.qty) : null;
      const short = order.short_close === null ? null : r2(num(order.short_close));
      const orderQty = first ? qty : 0;
      // The balance: ordered less short closed and billed on the first row (empty when the first row has no bill quantity above 0 to sum), ordered less short closed where no bill quantity.
      let balance: number | null = null;
      if (first && orderQty > 0) balance = hasBill ? r2(orderQty - ((short ?? 0) + billed)) : null;
      if (!billQty) balance = r2(orderQty - (short ?? 0));
      const row: ResultRow = { SORTING_COL: `${toText(order.prod_short)}   P${ymd(date)} ${num(order.il_key)}LED`, ORD_DATE: style6(date), ORDER_NO: toText(order.full_docno), Serial_No: 0, NAME: order.name, DESCRIPTION: order.prod_desc, prod_group: order.prod_group,
        Specification: order.specification, JOB_CARD_NO: order.job_card, ORD_QTY: orderQty, ORDER_RATE: r2(rate), ORDER_VALUE: first ? r2(qty * rate) : 0, SHORT_CLOSE: first ? short : 0, ORIGINAL_DELIVERY_DATE: style6(original), REVISED_DELIVERY_DATE: style6(revised),
        CHANGE_DAYS: original ? (revised ? day(revised) - day(original) : null) : 0, ENTRY_DATE: bill ? style6(bill.il_date as Date) : null, ENTRY_NO: bill ? toText(bill.full_docno) : null, BILL_DATE: style6(billDate), BILL_NO: bill ? toText(bill.bill_no) : null,
        BILL_QTY: billQty, BILL_RATE: bill ? r2(num(bill.rate)) : null, BILL_VALUE: bill ? r2(num(bill.il_value)) : null, SR_NO: index + 1, BALANCE: balance, BAL_VALUE: balance !== null && balance > 0 ? r2(balance * rate) : null,
        Delay_Days: billDate && revised ? day(billDate) - day(revised) + 1 : null };
      lines.push({ name: toText(order.name), date, doc: toText(order.full_docno), row });
    });
  }
  // Serial no: the lines of an order (order date and no) numbered one after the other.
  const serial = new Map<string, number>();
  for (const line of lines) { const key = `${line.row.ORD_DATE}|${line.doc}`; const next = (serial.get(key) ?? 0) + 1; serial.set(key, next); line.row.Serial_No = next; }
  table.rows = lines.map((line, index) => ({ line, index })).filter(({ line }) => !pendingOnly || num(line.row.BALANCE) > 0)
    .sort((a, b) => a.line.name.toLowerCase().localeCompare(b.line.name.toLowerCase()) || day(a.line.date) - day(b.line.date) || a.index - b.index).map(({ line }) => line.row);
  return table;
}
