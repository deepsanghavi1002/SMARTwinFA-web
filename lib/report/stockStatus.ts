import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 244: STOCK STATUS (REPORT_RPI_STOCK_STATUS, SP_FRT_RPT_RPI_STOCK_STATUS; SPECIAL > Extra Report (RP1) > Stock Status).
 * The Finish Goods products (of the ticked addon) with their status from the cartons in stock (closing pieces / standard pack, whole cartons) and the cartons
 * still to be made (planned less made, over the standard pack): Available (Upto 20 / More than 20 / 30 / 50 / 100 CTN) from 10 cartons up, Low Stock (Less
 * than 10 CTN) when stock and plans together are over 3, Under Process when something is planned, else Not Available (0 CTN); the standard pack and the latest
 * MRP beside it, by product group then description. As the procedure's grouped join does, the planned quantity of a product row repeated by the join is summed
 * for each repeat.
 */
const whole = (value: number) => Math.trunc(value);

export async function stockStatus(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const keys = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[0].trim()) ? call.selectKey[0].trim() : "";
  const addon = keys === "" || call.addon[0].trim() === "" ? "" : ` AND ${call.addon[0].trim().replace(/^(p?adata)\.txt_/i, "adata.key_")} IN ${keys}`;

  const products = (await runReportSql(loader, `SELECT prodmas.prod_key, prodmas.prod_desc, adata.txt_prodgroup AS prod_group, adata.txt_prodcat AS prod_cat, prodmas.base_pack::numeric AS base_pack, prodbal.clsg_pcs::numeric AS clsg_pcs`
    + ` FROM ${db}product_master prodmas LEFT JOIN ${db}prod_balance prodbal ON prodbal.prod_id = prodmas.prod_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key`
    + ` WHERE prodmas.prod_pos <> 'D' AND prodbal.prec_flag = 'RP' AND lower(rtrim(adata.txt_prodtype)) = 'finish goods'${addon}`)).rows;
  const planned = new Map<number, number>();
  const made = new Map<number, number>();
  const mrp = new Map<number, number>();
  if (products.length > 0) {
    const ids = [...new Set(products.map((row) => num(row.prod_key)))];
    for (const row of (await runReportSql(loader, `SELECT prod_id, sum(plan_qty::numeric - coalesce(plan_sort, 0)::numeric) AS pending FROM ${db}production_planing WHERE prod_id = ANY($1::int[]) GROUP BY prod_id`, [ids])).rows) planned.set(num(row.prod_id), num(row.pending));
    for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, sum(CASE WHEN prodled.stock_nat = 'A' AND ((btrim(prodled.trn_module) = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD') OR (btrim(prodled.trn_module) = 'PROD-FG' AND proce.ent_approve = 'Yes')`
      + ` OR btrim(prodled.trn_module) = 'PROD-SFG' OR (btrim(prodled.trn_module) = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN (prodled.quantity::numeric - prodled.ag_qty::numeric) ELSE 0 END) AS made`
      + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id WHERE prodled.il_pos = 'A' AND proce.il_pos = 'A' AND prodled.prod_id = ANY($1::int[]) GROUP BY prodled.prod_id`, [ids])).rows) made.set(num(row.prod_id), num(row.made));
    for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, round(pl_mrp::numeric, 2) AS mrp FROM ${db}pricelist WHERE prod_id = ANY($1::int[]) AND pl_mrp::numeric > 0 AND pl_pos <> 'D' ORDER BY prod_id, pl_wefrom DESC`, [ids])).rows) mrp.set(num(row.prod_id), num(row.mrp));
  }

  // The grouped rows: the product rows that agree on every grouped column are one line, whose planned quantity is summed over its repeats.
  const groups = new Map<string, { row: ResultRow; repeats: number }>();
  for (const row of products) {
    const key = JSON.stringify([row.prod_key, row.prod_desc, row.prod_group, row.prod_cat, row.base_pack, row.clsg_pcs]);
    const found = groups.get(key);
    if (found) found.repeats += 1; else groups.set(key, { row, repeats: 1 });
  }
  const table = new ResultTable();
  for (const column of ["Description", "Product_Group", "Product_Category", "STD_PACK", "PROD_STATUS", "MRP"]) table.addColumn(column);
  table.setKind("STD_PACK", "int");
  table.setKind("MRP", "decimal");
  const rows: ResultRow[] = [];
  for (const { row, repeats } of groups.values()) {
    const key = num(row.prod_key);
    const stdPack = row.base_pack === null ? null : whole(num(row.base_pack));
    const clsgBox: number | null = num(row.base_pack) > 1 ? (row.clsg_pcs === null ? null : whole(whole(num(row.clsg_pcs)) / (stdPack as number))) : 0;
    const pending = (planned.get(key) ?? 0) * repeats - (made.get(key) ?? 0);
    const pendBox = stdPack !== null && stdPack > 1 ? whole(whole(pending) / stdPack) : 0;
    const box = clsgBox;
    let status: string;
    if (box !== null && box >= 10 && box <= 20) status = "Available (Upto 20 CTN)";
    else if (box !== null && box >= 20 && box <= 30) status = "Available (More than 20 CTN)";
    else if (box !== null && box >= 30 && box <= 50) status = "Available (More than 30 CTN)";
    else if (box !== null && box >= 50 && box <= 75) status = "Available (More than 50 CTN)";
    else if (box !== null && box >= 75) status = "Available (More than 100 CTN)";
    else if (box !== null && box + pendBox > 3 && box + pendBox < 10) status = "Low Stock (Less than 10 CTN)";
    else if (pendBox > 0) status = "Under Process";
    else status = "Not Available (0 CTN)";
    rows.push({ Description: row.prod_desc, Product_Group: row.prod_group, Product_Category: row.prod_cat, STD_PACK: stdPack, PROD_STATUS: status, MRP: mrp.get(key) ?? 0 });
  }
  const low = (value: unknown) => toText(value).toLowerCase();
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => low(a.row.Product_Group).localeCompare(low(b.row.Product_Group)) || low(a.row.Description).localeCompare(low(b.row.Description)) || a.index - b.index).map(({ row }) => row);
  return table;
}
