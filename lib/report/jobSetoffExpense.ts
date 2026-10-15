import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 199: JOB SETOFF EXPENSE BILL (REPORT_JOB_SETOFF_EXPENSE_BILL, SP_FRT_RPT_RPI_JOB_SETOFF_EXPENSE; SPECIAL > Extra Report (RP) > Job Setoff Expense Bill): the job
 * work entries (JOB-IN) of the year against the expense bills of the job workers (the Account group) that were set off against them.
 *  - Expense Bill (first combo 1): each bill line of the period (the expense voucher's product lines that name a job-in entry: ORDER_NO) with the job-in entry it
 *    is for; a bill's lines of the same job-in entry and quantity are one (the procedure keeps the first); the bill's party, number and date are on its first line.
 *  - Job In (first combo 2): each job-in entry line of the period with the bills set against it (PROD_LINK: the bill number and date, the challan, the bill quantity);
 *    only the first line of a job-in entry of one product and quantity keeps the entry number and quantity; BALANCE is the quantity less what the bills took.
 * By the sorting text (the bill date and number; for Job In the party, entry date and number, serial). One read of each side, joined in memory.
 */
export async function jobSetoffExpense(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const parties = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? call.selectKey[4].trim() : "";
  const filter = (column: string) => (parties !== "" ? ` AND ${column} IN ${parties}` : "");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const style6 = (date: unknown) => (date === null || date === undefined ? "" : (() => { const value = date as Date; return `${String(value.getDate()).padStart(2, "0")}-${MONTHS[value.getMonth()]}-${String(value.getFullYear()).slice(-2)}`; })());
  const ymd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  const compare = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
  const table = new ResultTable();

  if (Math.trunc(call.fcValue) === 1) {
    const bills = (await runReportSql(loader, `SELECT e.led_key, e.chln_date, btrim(e.doc_no1) AS bill_no, e.doc_date, e.full_docno, b.name, c.prod_desc, a.quantity::numeric AS qty, a.rate::numeric AS rate, a.il_value::numeric AS amount, a.order_no`
      + ` FROM ${db}prod_ledger a, ${db}account b, ${db}product_master c, ${db}prod_uom d, ${db}ledger e WHERE a.led_id = e.led_key AND a.code = b.code AND a.prod_id = c.prod_key AND d.uom_key = a.uomentry_id`
      + ` AND e.doc_date BETWEEN $1::date AND $2::date AND e.doc_pos <> 'D' AND a.il_pos = 'A' AND c.prod_pos = 'A' AND a.stock_nat = 'A' AND e.year_id = $3 AND a.quantity > 0 AND coalesce(a.order_no, '') <> ''${filter("a.code")}`
      + ` ORDER BY e.led_key, a.il_key`, [desktopDate(call.from), desktopDate(call.upto), call.yearId])).rows;
    const jobIns = new Map<string, { date: unknown; no: string }[]>();
    for (const row of (await runReportSql(loader, `SELECT a.process_key, a.p_date, a.full_docno FROM ${db}process a, ${db}account b WHERE a.code = b.code AND a.il_pos = 'A' AND a.year_id = $1 AND a.stk_module = 'JOB-IN'${filter("a.code")} ORDER BY a.process_key`, [call.yearId])).rows) {
      const list = jobIns.get(toText(row.full_docno)) ?? [];
      list.push({ date: row.p_date, no: toText(row.full_docno) });
      jobIns.set(toText(row.full_docno), list);
    }
    type Line = { index: number; sort: string; values: ResultRow; bill: string; job: string; qty: number };
    const lines: Line[] = [];
    for (const bill of bills) {
      const found = jobIns.get(toText(bill.order_no)) ?? [null];
      for (const job of found) {
        const doc = bill.doc_date as Date;
        lines.push({ index: lines.length, sort: `${ymd(doc)} ${toText(bill.full_docno)}`, bill: toText(bill.bill_no), job: job ? job.no : "", qty: num(bill.qty), values: {
          name: toText(bill.name), EXP_BILL_NO: toText(bill.bill_no), EXP_BILL_DATE: style6(bill.chln_date), CHALLAN_NO: toText(bill.full_docno), CHALLAN_DATE: style6(doc), JOB_IN_NO: job ? job.no : null, JOB_IN_DATE: job ? style6(job.date) : null,
          PROD_DESC: toText(bill.prod_desc), Qty: num(bill.qty), Rate: num(bill.rate), Net_Amount: bill.amount === null ? null : num(bill.amount), SORTING_DATE: `${ymd(doc)} ${toText(bill.full_docno)}` } });
      }
    }
    // The first line of a bill's job-in entry and quantity only; then the bill's party, number and date on its first line.
    const seen = new Set<string>();
    const kept = lines.filter((line) => { const key = `${line.bill}\u0000${line.job}\u0000${line.qty}`; if (seen.has(key)) return false; seen.add(key); return true; });
    const position = new Map<string, number>();
    for (const line of kept) {
      const at = (position.get(line.bill) ?? 0) + 1;
      position.set(line.bill, at);
      line.values.Sr_No = at;
      if (at !== 1) Object.assign(line.values, { name: "", EXP_BILL_NO: "", EXP_BILL_DATE: null });
    }
    for (const column of ["Sr_No", "name", "EXP_BILL_NO", "EXP_BILL_DATE", "CHALLAN_NO", "CHALLAN_DATE", "JOB_IN_NO", "JOB_IN_DATE", "PROD_DESC", "Qty", "Rate", "Net_Amount", "SORTING_DATE"]) table.addColumn(column);
    for (const column of ["Qty", "Rate", "Net_Amount"]) table.setKind(column, "decimal");
    table.setKind("Sr_No", "int");
    table.rows = kept.sort((a, b) => compare(a.sort, b.sort) || a.index - b.index).map((line) => line.values);
    return table;
  }

  // Job In: the entry lines against the bill lines linked to them.
  const entries = (await runReportSql(loader, `SELECT a.process_key, a.p_date, a.full_docno, a.post_date, btrim(a.entry_no) AS bill_no, b.name, e.prod_desc, d.quantity::numeric AS in_qty, d.il_serial, d.il_key, c.led_rec2, c.iled_rec2`
    + ` FROM ${db}process a LEFT JOIN ${db}account b ON a.code = b.code LEFT JOIN ${db}prod_ledger d ON d.process_id = a.process_key LEFT JOIN ${db}product_master e ON e.prod_key = d.prod_id`
    + ` LEFT JOIN ${db}prod_link c ON c.led_rec1 = a.process_key AND c.iled_rec1 = d.il_key WHERE a.p_date BETWEEN $1::date AND $2::date AND a.il_pos = 'A' AND a.year_id = $3 AND a.stk_module = 'JOB-IN'`
    + ` AND d.stock_nat = 'A' AND d.il_pos = 'A' AND e.prod_pos = 'A'${filter("a.code")} ORDER BY a.process_key, d.il_key`, [desktopDate(call.from), desktopDate(call.upto), call.yearId])).rows;
  const billLines = new Map<string, ResultRow[]>();
  for (const row of (await runReportSql(loader, `SELECT a.led_key, a.chln_date, btrim(a.doc_no1) AS bill_no, a.doc_date, a.full_docno, d.quantity::numeric AS bill_qty, c.led_rec1, c.iled_rec1, d.il_key FROM ${db}ledger a LEFT JOIN ${db}account b ON a.code = b.code`
    + ` LEFT JOIN ${db}prod_ledger d ON d.led_id = a.led_key LEFT JOIN ${db}prod_link c ON c.led_rec2 = a.led_key AND c.iled_rec2 = d.il_key WHERE a.doc_pos = 'A' AND a.year_id = $1 AND d.stock_nat = 'A' AND d.il_pos = 'A'${filter("a.code")}`, [call.yearId])).rows) {
    const key = `${num(row.led_key)}\u0000${num(row.led_rec1)}\u0000${num(row.il_key)}\u0000${num(row.iled_rec1)}`;
    const list = billLines.get(key) ?? [];
    list.push(row);
    billLines.set(key, list);
  }
  type Row = { index: number; sr: number; ilKey: number; values: ResultRow };
  const rows: Row[] = [];
  for (const entry of entries) {
    const key = `${num(entry.led_rec2)}\u0000${num(entry.process_key)}\u0000${num(entry.iled_rec2)}\u0000${num(entry.il_key)}`;
    const found = billLines.get(key) ?? [null];
    for (const bill of found) {
      const date = entry.p_date as Date;
      rows.push({ index: rows.length, sr: 0, ilKey: num(entry.il_key), values: {
        name: toText(entry.name), JOB_IN_ENT_NO: toText(entry.full_docno), JOB_IN_ENT_DATE: style6(date), JOB_IN_NO: toText(entry.bill_no), JOB_IN_DATE: style6(entry.post_date), Description: toText(entry.prod_desc), IN_QTY: num(entry.in_qty),
        EXP_BILL_NO: bill ? toText(bill.bill_no) : null, EXP_BILL_DATE: bill ? style6(bill.chln_date) : null, CHALLAN_NO: bill ? toText(bill.full_docno) : null, CHALLAN_DATE: bill ? style6(bill.doc_date) : null, Bill_Qty: bill ? num(bill.bill_qty) : null,
        SORTING_DATE: `${toText(entry.name)} ${ymd(date)} ${toText(entry.full_docno)} ${num(entry.il_serial)} ${num(entry.il_key)}`, BALANCE: null } });
    }
  }
  // The numbering of the lines of one product, job-in number and quantity; the lines after the first show no entry and no quantity.
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = [row.values.Description, row.values.JOB_IN_NO, row.values.IN_QTY].join("\u0000");
    const at = (counts.get(key) ?? 0) + 1;
    counts.set(key, at);
    row.sr = at;
    row.values.Sr_No = at;
    if (at !== 1) Object.assign(row.values, { IN_QTY: 0, JOB_IN_ENT_NO: "", JOB_IN_ENT_DATE: "" });
  }
  const taken = new Map<number, number>();
  for (const row of rows) if (row.values.Bill_Qty !== null && num(row.values.Bill_Qty) > 0) taken.set(row.ilKey, (taken.get(row.ilKey) ?? 0) + num(row.values.Bill_Qty));
  for (const row of rows) {
    if (num(row.values.IN_QTY) > 0) row.values.BALANCE = round2(num(row.values.IN_QTY) - (taken.get(row.ilKey) ?? 0));
    if (row.values.Bill_Qty === null || num(row.values.Bill_Qty) === 0) row.values.BALANCE = num(row.values.IN_QTY);
  }
  for (const column of ["Sr_No", "name", "JOB_IN_ENT_NO", "JOB_IN_ENT_DATE", "JOB_IN_NO", "JOB_IN_DATE", "Description", "IN_QTY", "EXP_BILL_NO", "EXP_BILL_DATE", "CHALLAN_NO", "CHALLAN_DATE", "Bill_Qty", "SORTING_DATE", "BALANCE"]) table.addColumn(column);
  for (const column of ["IN_QTY", "Bill_Qty", "BALANCE"]) table.setKind(column, "decimal");
  table.setKind("Sr_No", "int");
  table.rows = rows.sort((a, b) => compare(toText(a.values.SORTING_DATE), toText(b.values.SORTING_DATE)) || a.index - b.index).map((row) => row.values);
  return table;
}
