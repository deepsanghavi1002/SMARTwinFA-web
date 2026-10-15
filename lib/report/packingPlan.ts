import type { Loader } from "../master-program/load";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { tableFromResult } from "./library";
import { runReportSql } from "./run";

/**
 * 153: PACKING PLANING (REPORT_RPI_PACKING_PLAING, SP_FRT_RPT_RPI_PACKING_PLANING; SPECIAL > Extra Report (RP) > Packing Planning).
 *
 * The production plans (type PP, a planned quantity above 0) whose packing date falls From .. Upto (the entry date with "Entry Date Wise
 * Require"), a line each: item, product group, entry and packing dates, job card, planned and short quantity, the sale rate in force on the
 * entry date (the latest price list row of the product with a sale rate), Amount (rate x planned) and Net Value (75 % of it, 68 % for the
 * Export items), product class, unit, remark and the product's warning message; by packing date, then product group. One read.
 */
export async function packingPlan(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const byEntry = call.checkQuery.includes("CHK_ENTDATE,");
  const sql = `SELECT prodmas.prod_desc AS "Item", adata.txt_prodgroup AS "Product_Group", to_char(prodplan.ent_date, 'DD-Mon-YY') AS "Entry_Date", to_char(prodplan.packing_date, 'DD-Mon-YY') AS "Packing_Date",`
    + ` coalesce(prodplan.job_card_no, '') AS "Job_Card_No", prodplan.plan_qty AS "Planing", coalesce(prodplan.plan_sort, 0) AS "Plan_Short", coalesce(sale.sale_rate, 0) AS "Rate",`
    + ` round(coalesce(sale.sale_rate, 0) * prodplan.plan_qty, 2) AS "Amount",`
    + ` CASE WHEN prodmas.prod_desc IS NULL THEN 0.00 ELSE coalesce(round(prodplan.plan_qty * coalesce(sale.sale_rate, 0) * (CASE WHEN left(prodmas.prod_desc, 6) = 'Export' THEN 68 ELSE 75 END) / 100, 2), 0) END AS "Net_Value",`
    + ` adata.txt_prodclass AS "Product_Class", adata.txt_produnit AS "UNIT", prodplan.ent_remark AS "Remark", coalesce(prodmas.prod_message, '') AS "Product_Warning_Message"`
    + ` FROM ${db}production_planing prodplan LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodplan.prod_id LEFT JOIN ${db}addon_data adata ON prodmas.prod_key = adata.prod_id`
    + ` LEFT JOIN LATERAL (SELECT round(pl.pl_srate::numeric, 2) AS sale_rate FROM ${db}pricelist pl WHERE pl.prod_id = prodmas.prod_key AND pl.pl_wefrom <= prodplan.ent_date`
    + ` AND (pl.pl_weupto >= prodplan.ent_date OR pl.pl_weupto IS NULL) AND pl.pl_srate > 0 AND pl.pl_pos <> 'D' ORDER BY pl.pl_wefrom DESC LIMIT 1) sale ON true`
    + ` WHERE prodplan.${byEntry ? "ent_date" : "packing_date"} BETWEEN $1 AND $2 AND prodplan.plan_qty > 0 AND prodplan.ent_type = 'PP'`
    + ` ORDER BY prodplan.packing_date, adata.txt_prodgroup`;
  const table = tableFromResult(await runReportSql(loader, sql, [desktopDate(call.from), desktopDate(call.upto)]));
  for (const column of ["Planing", "Plan_Short", "Rate", "Amount", "Net_Value"]) if (table.has(column)) table.setKind(column, "decimal");
  return table;
}
