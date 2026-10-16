import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { style6 } from "./productionSetoff";
import { num, runReportSql } from "./run";

/**
 * 228: STEEL PLANT CHALLAN (REPORT_RPI_STEEL_PLANT_CHALLAN, SP_FRT_RPT_RPI_STEEL_PLANT_CHALLAN; SPECIAL > Extra Report (RP1) > Steel Plant Challan).
 * For the processes (production vouchers) ticked in the Description help: a line for each product added on the voucher: serial no (by process key), job card,
 * voucher no and date, description, added quantity and the process name; by the voucher's document number (its last 10 characters).
 */
export async function steelPlantChallan(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const keys = call.selectIdoptKey.trim();
  if (!/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys)) throw new ReportRefusal("Select the vouchers (Description)", "INTERNAL PROGRAM FAILURE");
  const lines = (await runReportSql(loader, `SELECT proce.process_key, prodled.il_key, aent.input_job_card, proce.full_docno, proce.doc_no2, proce.p_date, prodmas.prod_desc, round(prodled.quantity::numeric, 4) AS quantity, aent.txt_procname`
    + ` FROM ${db}process proce LEFT JOIN ${db}prod_ledger prodled ON prodled.process_id = proce.process_key LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = proce.process_key`
    + ` WHERE proce.il_pos = 'A' AND prodled.il_pos = 'A' AND prodmas.prod_pos = 'A' AND prodled.stock_nat = 'A' AND proce.process_key IN ${keys} ORDER BY proce.process_key, prodled.il_key`)).rows;
  const table = new ResultTable();
  for (const column of ["Sr", "Job_Card_No", "Voucher_No", "Voucher_Date", "Description", "Add_Qty", "Process_Name"]) table.addColumn(column);
  table.setKind("Sr", "int");
  table.setKind("Add_Qty", "decimal");
  const last10 = (text: unknown) => `          ${toText(text)}`.slice(-10).toLowerCase();
  table.rows = lines.map((row, index) => ({ row, index }))
    .sort((a, b) => (last10(a.row.doc_no2) < last10(b.row.doc_no2) ? -1 : last10(a.row.doc_no2) > last10(b.row.doc_no2) ? 1 : 0) || a.index - b.index)
    .map(({ row, index }) => ({ Sr: index + 1, Job_Card_No: row.input_job_card, Voucher_No: row.full_docno, Voucher_Date: style6(row.p_date as Date | null), Description: row.prod_desc, Add_Qty: num(row.quantity), Process_Name: row.txt_procname }));
  return table;
}
