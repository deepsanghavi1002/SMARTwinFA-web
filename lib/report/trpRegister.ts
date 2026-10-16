import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { style6 } from "./productionSetoff";
import { num, runReportSql } from "./run";

/**
 * 299: TRANSPORT REGISTER (REPORT_RPI_TRP_REGISTER, SP_FRT_RPT_RPI_TRP_REGISTER; SPECIAL > Extra Report (RP1) > Transport Register).
 *  - "Transport Paid" ticked: the transport expense vouchers of the period (the ledger the sale / purchase / challan entries name as their transport expense):
 *    the party, book, document and invoice no, LR no and date, amount, the transport (the expense voucher's account), the transport amount charged to the entry
 *    and the expense entry's no and date; the ledger vouchers (books) and the stock vouchers (job work in / out, challans), each where the database has the
 *    TRP_EXP_LED_ID link on its table.
 *  - Otherwise: the transport details (the entry addon) of the sale, purchase and debit note vouchers (books 8, 13, 15) and the job work / challan vouchers of the
 *    period that have no transport amount charged yet: party, book, document and invoice no, LR no, date, amount, transport. By party.
 */
const STOCK_BOOK = (column: string) => `CASE ${column} WHEN 'JOB-OUT' THEN 'JOB STOCK OUT' WHEN 'JOB-IN' THEN 'JOB STOCK IN' WHEN 'CHLN-IN' THEN 'RISHABH TO MEHER' WHEN 'CHLN-OUT' THEN 'MEHER TO RISHABH' ELSE 'SAMPLE CHALLAN' END`;

export async function trpRegister(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const period = [desktopDate(call.from), desktopDate(call.upto)];
  const paid = call.checkQuery.includes("CHK_TRPPAID,");
  const table = new ResultTable();
  const columns = ["name", "Book_Name", "doc_no", "inv_no", "Lr_no", "doc_date", "amount", ...(paid ? ["Transport_Name", "TRP_AMOUNT", "EXP_ENTRY_NO", "EXP_ENTRY_DATE"] : ["Transport_Name"])];
  for (const column of columns) table.addColumn(column);
  for (const column of ["amount", "TRP_AMOUNT"]) if (columns.includes(column)) table.setKind(column, "decimal");

  let rows: ResultRow[];
  if (paid) {
    // The entries name their transport expense voucher in TRP_EXP_LED_ID; a company database that does not have it on LEDGER / PROCESS has no such entries there.
    const has = async (tableName: string) => (await runReportSql(loader, "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'trp_exp_led_id'", [loader.session.companySchema, tableName])).rows.length > 0;
    const ledgers = !(await has("ledger")) ? [] : (await runReportSql(loader, `SELECT ac.name, coalesce(bp.book_desc, '') AS book_name, coalesce(led.full_docno, '') AS doc_no, btrim(coalesce(led.doc_no1, '')) AS inv_no, btrim(coalesce(aent.input_lrno, '')) AS lr_no, led.doc_date, coalesce(led.amount::numeric, 0) AS amount,`
      + ` ac1.name AS transport_name, coalesce(led.trp_amount::numeric, 0) AS trp_amount, coalesce(led.trp_lrno, '') AS exp_no, led1.doc_date AS exp_date FROM ${db}ledger led1 LEFT JOIN ${db}account ac1 ON ac1.code = led1.code`
      + ` INNER JOIN ${db}ledger led ON led1.led_key = led.trp_exp_led_id AND led.doc_pos = 'A' LEFT JOIN ${db}addon_aentry aent ON led.led_key = aent.aona_ledid LEFT JOIN ${db}book_properties bp ON bp.book_key = led.book`
      + ` LEFT JOIN ${db}account ac ON ac.code = aent.aona_accode WHERE led1.doc_date >= $1::date AND led1.doc_date <= $2::date`, period)).rows;
    const stock = !(await has("process")) ? [] : (await runReportSql(loader, `SELECT ac.name, ${STOCK_BOOK("btrim(proce.stk_module)")} AS book_name, coalesce(proce.full_docno, '') AS doc_no, btrim(coalesce(proce.entry_no, '')) AS inv_no, btrim(coalesce(aent.input_lrno, '')) AS lr_no, proce.p_date AS doc_date,`
      + ` coalesce(proce.p_amount::numeric, 0) AS amount, ac1.name AS transport_name, coalesce(proce.trp_amount::numeric, 0) AS trp_amount, coalesce(proce.trp_lrno, '') AS exp_no, led1.doc_date AS exp_date FROM ${db}ledger led1`
      + ` LEFT JOIN ${db}account ac1 ON ac1.code = led1.code INNER JOIN ${db}process proce ON led1.led_key = proce.trp_exp_led_id AND proce.il_pos = 'A' LEFT JOIN ${db}addon_aentry aent ON proce.process_key = aent.aona_processid`
      + ` LEFT JOIN ${db}account ac ON ac.code = aent.aona_accode WHERE led1.doc_date >= $1::date AND led1.doc_date <= $2::date`, period)).rows;
    rows = [...ledgers, ...stock].map((row) => ({ name: row.name, Book_Name: row.book_name, doc_no: row.doc_no, inv_no: row.inv_no, Lr_no: row.lr_no, doc_date: style6(row.doc_date as Date | null), amount: num(row.amount), Transport_Name: row.transport_name,
      TRP_AMOUNT: num(row.trp_amount), EXP_ENTRY_NO: row.exp_no, EXP_ENTRY_DATE: style6(row.exp_date as Date | null) }));
  } else {
    const lines = (await runReportSql(loader, `SELECT ac.name, CASE WHEN coalesce(proce.full_docno, '') = '' THEN coalesce((SELECT book_desc FROM ${db}book_properties WHERE book_key = led.book LIMIT 1), '') ELSE ${STOCK_BOOK("btrim(proce.stk_module)")} END AS book_name,`
      + ` CASE WHEN coalesce(proce.full_docno, '') = '' THEN coalesce(led.full_docno, '') ELSE coalesce(proce.full_docno, '') END AS doc_no, CASE WHEN coalesce(proce.full_docno, '') = '' THEN coalesce(btrim(led.doc_no1), '') ELSE coalesce(btrim(proce.entry_no), '') END AS inv_no,`
      + ` coalesce(btrim(aent.input_lrno), '') AS lr_no, CASE WHEN coalesce(proce.full_docno, '') = '' THEN led.doc_date ELSE proce.p_date END AS doc_date, CASE WHEN coalesce(proce.full_docno, '') = '' THEN coalesce(led.amount::numeric, 0) ELSE coalesce(proce.p_amount::numeric, 0) END AS amount, aent.txt_trans AS transport_name`
      + ` FROM ${db}addon_aentry aent LEFT JOIN ${db}ledger led ON led.led_key = aent.aona_ledid AND led.doc_pos = 'A' AND led.book IN (8, 13, 15) AND led.doc_date >= $1::date AND led.doc_date <= $2::date`
      + ` LEFT JOIN ${db}process proce ON proce.process_key = aent.aona_processid AND btrim(proce.stk_module) IN ('JOB-OUT', 'JOB-IN', 'CHLN-IN', 'CHLN-OUT', 'AMD-OUT') AND proce.il_pos = 'A' AND proce.p_date >= $1::date AND proce.p_date <= $2::date`
      + ` LEFT JOIN ${db}account ac ON ac.code = aent.aona_accode WHERE ((led.led_key IS NOT NULL AND coalesce(led.trp_amount::numeric, 0) = 0) OR (proce.process_key IS NOT NULL AND coalesce(proce.trp_amount::numeric, 0) = 0))`, period)).rows;
    rows = lines.map((row) => ({ name: row.name, Book_Name: row.book_name, doc_no: row.doc_no, inv_no: row.inv_no, Lr_no: row.lr_no, doc_date: style6(row.doc_date as Date | null), amount: num(row.amount), Transport_Name: row.transport_name }));
  }
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => toText(a.row.name).toLowerCase().localeCompare(toText(b.row.name).toLowerCase()) || a.index - b.index).map(({ row }) => row);
  return table;
}
