import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 212: STOCK FLOW (REPORT_RPI_STOCK_FLOW, SP_FRT_RPT_RPI_STOCK_FLOW; SPECIAL > Extra Report (RP1) > Stock Flow).
 * The raw materials and the like (inventory products of the selection other than Finish Goods) with, for the financial year: the opening, what came in
 * (packing = production, credit notes, purchases, stock additions, stock journal additions, job work in) and went out (debit notes, sales, stock less,
 * stock journal less, job work out, consumption), in the product's report unit; the closing, its value at the master rate; the quantity the pending plans
 * need of it through the latest BOMs (Pend_Prod_Plan: what is still to make on each job card x the BOM quantity), the pending purchase orders, and the
 * balance (closing less the plans plus the orders) with its value. A product with nothing in any of these is left out. By item.
 * The procedure's work tables are held in memory; the plan, BOM and order tables are one read each.
 */
const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
const whereAnd = (where: string, condition: string) => (where.trim().toLowerCase() === "where" ? `${where} ${condition}` : `${where} and ${condition}`);

export async function stockFlow(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const baseWhere = frag(call.where.split("|sys.yearid|").join(call.yearId));
  const where = whereAnd(whereAnd(baseWhere, "prodbal.prec_flag = 'RP'"), "txt_prodtype <> 'FINISH GOODS'");
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "");
  const aliasOf = (at: number) => /as\s+"([^"]+)"/i.exec(call.headingAddon[at])?.[1] ?? `ADDON${at + 1}`;
  const uom = (pcs: string, q1: string, q2: string, q3: string, pack: string, weight: string, other: string) => `case when product.rep1_uom = product.pcs_uom then ${pcs} when product.rep1_uom = product.qty1_uom then ${q1} when product.rep1_uom = product.qty2_uom then ${q2}`
    + ` when product.rep1_uom = product.qty3_uom then ${q3} when product.rep1_uom = product.pack_uom then ${pack} when product.rep1_uom = product.weight_uom then ${weight} else ${other} end`;

  // The products with their opening in the report unit.
  const addonSelect = levels.map((at, index) => `, ${call.addon[at].trim()}::text AS a${index}`).join("");
  const opening = uom("prodbal.open_pcs::numeric", "prodbal.open_qty1::numeric", "prodbal.open_qty2::numeric", "prodbal.open_qty3::numeric", "prodbal.open_pack::numeric", "prodbal.open_weight::numeric", "prodbal.open_pcs::numeric");
  const products = (await runReportSql(loader, `SELECT product.prod_key, product.prod_desc, ${opening} AS open_qty, coalesce(prodbal.excise_rate::numeric, 0) AS rate, product.min_qty, product.lead_days, product.prod_message${addonSelect}`
    + ` ${frag(call.from_)} ${where}`)).rows;
  const seen = new Set<string>();
  const base = products.filter((row) => {
    const key = JSON.stringify([row.prod_key, row.prod_desc, row.open_qty, row.rate, row.min_qty, row.lead_days, row.prod_message, ...levels.map((_at, index) => row[`a${index}`])]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // The year's movements of each product.
  const net = (column: string, withdraw = true) => (withdraw ? `prodled.${column}::numeric - prodled.ag_qty::numeric` : `prodled.${column}::numeric`);
  const simple = (other: string, withdraw = true) => uom(net("trn_pcs", withdraw), net("trn_qty1", withdraw), net("trn_qty2", withdraw), net("trn_qty3", withdraw), net("trn_pack", withdraw), net("trn_weight", withdraw), other);
  const share = (column: string) => `prodled.${column}::numeric - round(prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.${column}::numeric, 4)`;
  const trnModule = "btrim(prodled.trn_module)";
  const done = "prodled.inventory = 'Y'";
  const processed = "prodled.process_id IS NOT NULL";
  const sum = (condition: string, value: string, name: string) => `sum(CASE WHEN ${condition} THEN ${value} ELSE 0 END) AS ${name}`;
  const flows = (await runReportSql(loader, `SELECT product.prod_key, `
    + [
      sum(`prodled.stock_nat = 'A' AND ((${trnModule} = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD' AND proce.ent_approve = 'Yes') OR (${trnModule} = 'PROD-FG' AND proce.ent_approve = 'Yes') OR ${trnModule} = 'PROD-SFG' OR ${trnModule} = 'PROD-MULTI') AND ${done} AND ${processed}`, `(${simple("0")})`, "packing"),
      sum(`prodled.book = 16 AND prodled.stock_nat = 'A' AND ${done} AND prodled.led_id IS NOT NULL`, "(prodled.quantity::numeric - prodled.ag_qty::numeric)", "cr_qty"),
      sum(`prodled.book IN (13, 14, 15) AND prodled.stock_nat = 'A' AND ${done} AND prodled.led_id IS NOT NULL`, `(${uom(net("trn_pcs"), share("trn_qty1"), share("trn_qty2"), share("trn_qty3"), share("trn_pack"), share("trn_weight"), "prodled.quantity::numeric")})`, "purch_qty"),
      sum(`prodled.stock_nat = 'A' AND ${trnModule} = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) <> 'PROD' AND ${done} AND ${processed}`, `(${simple("prodled.trn_pcs::numeric")})`, "stock_add"),
      sum(`prodled.stock_nat = 'A' AND ${trnModule} = 'STK-JV' AND proce.ent_approve = 'Yes' AND ${done} AND ${processed}`, `(${simple("prodled.trn_pcs::numeric")})`, "stock_jv_add"),
      sum(`prodled.stock_nat = 'A' AND ${trnModule} = 'JOB-IN' AND ${done} AND ${processed}`, `(${simple("0", false)})`, "job_in"),
      sum(`prodled.book = 11 AND prodled.stock_nat = 'L' AND ${done} AND prodled.led_id IS NOT NULL`, "(prodled.quantity::numeric - prodled.ag_qty::numeric)", "dr_qty"),
      sum(`prodled.book IN (8, 9) AND prodled.stock_nat = 'L' AND ${done} AND prodled.led_id IS NOT NULL`, "(prodled.quantity::numeric - prodled.ag_qty::numeric)", "sale_qty"),
      sum(`prodled.stock_nat = 'L' AND ((${trnModule} = 'PROD-FG' AND proce.ent_approve = 'Yes') OR ${trnModule} = 'PROD-SFG' OR ${trnModule} = 'PROD-MULTI') AND ${done} AND ${processed}`, `(${simple("prodled.trn_pcs::numeric - prodled.ag_qty::numeric")})`, "consumption"),
      sum(`prodled.stock_nat = 'L' AND ${trnModule} = 'SVOU-LESS' AND ${done} AND ${processed}`, "(prodled.quantity::numeric - prodled.ag_qty::numeric)", "stock_less"),
      sum(`prodled.stock_nat = 'L' AND ${trnModule} = 'STK-JV' AND proce.ent_approve = 'Yes' AND ${done} AND ${processed}`, `(${simple("prodled.trn_pcs::numeric")})`, "stock_jv_less"),
      sum(`prodled.stock_nat = 'L' AND ${trnModule} = 'JOB-OUT' AND proce.ent_approve = 'Yes' AND ${done} AND ${processed}`, "prodled.quantity::numeric", "job_out"),
    ].join(", ")
    + ` FROM ${db}product_master product LEFT JOIN ${db}idopt_master idopt ON product.prod_group = idopt.idopt_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = product.prod_key`
    + ` LEFT JOIN ${db}prod_ledger prodled ON prodled.prod_id = product.prod_key LEFT JOIN ${db}prod_balance prodbal ON prodbal.prod_id = product.prod_key LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id`
    + ` ${whereAnd(whereAnd(where, "product.prod_key = prodled.prod_id"), "prodled.inventory = 'Y' AND prodled.il_pos = 'A' AND prodled.il_date >= $1::date AND prodled.il_date <= $2::date")} GROUP BY product.prod_key`,
  [desktopDate(call.tarikh1), desktopDate(call.tarikh2)])).rows;
  const flowOf = new Map<number, ResultRow>(flows.map((row) => [num(row.prod_key), row]));

  // The BOMs: what each takes (the quantity of a product in a BOM) and the BOM each product is made by.
  const lessBom = (await runReportSql(loader, `SELECT prod_id, full_docno, quantity::numeric AS quantity FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos = 'A' AND stock_nat = 'L' ORDER BY il_key`)).rows;
  const takenIn = new Map<number, number>();
  const takenByDoc = new Map<string, { prod: number; qty: number }[]>();
  for (const row of lessBom) {
    takenIn.set(num(row.prod_id), num(row.quantity));
    if (num(row.quantity) > 0) {
      const list = takenByDoc.get(toText(row.full_docno)) ?? [];
      list.push({ prod: num(row.prod_id), qty: num(row.quantity) });
      takenByDoc.set(toText(row.full_docno), list);
    }
  }
  const madeBy = new Map<number, string>();
  for (const row of (await runReportSql(loader, `SELECT prod_id, full_docno FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' AND stock_nat = 'A' ORDER BY il_key`)).rows) madeBy.set(num(row.prod_id), toText(row.full_docno));

  // Still to make on each job card (planned less made), as the BOM it follows needs.
  const pending = (await runReportSql(loader, `SELECT prodplan.prod_id, coalesce(sum(prodplan.plan_qty::numeric - coalesce(prodplan.plan_sort, 0)::numeric), 0) - coalesce(pq.production_qty, 0) AS plan_pend FROM ${db}production_planing prodplan`
    + ` LEFT JOIN (SELECT prodled.prod_id, aent.input_job_card, sum(CASE WHEN prodled.stock_nat = 'A' AND ((btrim(prodled.trn_module) = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD') OR (btrim(prodled.trn_module) = 'PROD-FG' AND proce.ent_approve = 'Yes')`
    + ` OR btrim(prodled.trn_module) = 'PROD-SFG' OR (btrim(prodled.trn_module) = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN (prodled.quantity::numeric - prodled.ag_qty::numeric) ELSE 0 END) AS production_qty`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id`
    + ` WHERE prodled.il_pos = 'A' AND coalesce(aent.input_job_card, '') <> '' GROUP BY prodled.prod_id, aent.input_job_card) pq ON pq.prod_id = prodplan.prod_id AND pq.input_job_card = prodplan.job_card_no`
    + ` WHERE coalesce(prodplan.job_card_no, '') <> '' GROUP BY prodplan.prod_id, prodplan.job_card_no, pq.production_qty`)).rows;
  const needs = new Map<number, number>();
  for (const row of pending) {
    const remaining = num(row.plan_pend);
    const doc = madeBy.get(num(row.prod_id));
    if (remaining <= 0 || doc === undefined) continue;
    for (const line of takenByDoc.get(doc) ?? []) needs.set(line.prod, (needs.get(line.prod) ?? 0) + remaining * line.qty);
  }

  // Pending purchase orders of each product.
  const orders = new Map<number, number>();
  for (const row of (await runReportSql(loader, `SELECT product.prod_key, coalesce(sum(prodled.quantity::numeric - prodled.ag_qty::numeric), 0) AS pending FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master product ON product.prod_key = prodled.prod_id`
    + ` LEFT JOIN ${db}addon_data adata ON product.prod_key = adata.prod_id LEFT JOIN ${db}account ac ON ac.code = prodled.code ${whereAnd(baseWhere, "ac.book = 3 AND prodled.il_pos = 'A' AND btrim(prodled.trn_module) = 'ORD-IN' AND prodled.quantity::numeric - (prodled.ag_qty::numeric + coalesce(prodled.setof_qty, 0)::numeric) > 0")} GROUP BY product.prod_key`)).rows) orders.set(num(row.prod_key), num(row.pending));

  const table = new ResultTable();
  const text = ["ITEM", ...levels.map(aliasOf), "STL_WARNING_MESSAGE"];
  const columns = ["ITEM", ...levels.map(aliasOf), "OPEN_QTY", "OPEN_AMT", "PACKING", "CR_QTY", "PURCH_QTY", "PRODUCTION", "STOCK_ADD", "STOCK_JV_ADD", "JOB_IN", "DR_QTY", "SALE_QTY", "CONSUMPTION", "JOB_OUT", "STOCK_LESS", "STOCK_JV_LESS", "CLSG_QTY", "Rate", "Amount", "Pend_Prod_Plan", "Pend_Purchase_Order", "Balance_Stock", "Balance_Stock_Amt", "MIN_QTY", "LEAD_TIME", "STL_WARNING_MESSAGE"];
  for (const column of columns) table.addColumn(column);
  for (const column of columns.filter((name) => !text.includes(name))) table.setKind(column, "decimal");
  const rows: ResultRow[] = [];
  for (const row of base) {
    const flow = flowOf.get(num(row.prod_key));
    const value = (name: string) => (flow ? num(flow[name.toLowerCase()]) : 0);
    const open = num(row.open_qty);
    const rate = num(row.rate);
    const closing = open + value("PACKING") + value("CR_QTY") + value("PURCH_QTY") + value("STOCK_ADD") + value("STOCK_JV_ADD") + value("JOB_IN") - value("DR_QTY") - value("SALE_QTY") - value("STOCK_LESS") - value("STOCK_JV_LESS") - value("JOB_OUT") - value("CONSUMPTION");
    const planNeed = (takenIn.get(num(row.prod_key)) ?? 0) > 0 ? r2(needs.get(num(row.prod_key)) ?? 0) : 0;
    const ordered = orders.get(num(row.prod_key)) ?? 0;
    if ([open, value("PACKING"), value("CR_QTY"), value("PURCH_QTY"), value("STOCK_ADD"), value("STOCK_JV_ADD"), value("JOB_IN"), value("DR_QTY"), value("SALE_QTY"), value("STOCK_LESS"), value("STOCK_JV_LESS"), value("JOB_OUT"), planNeed, ordered].every((number) => r2(number) === 0)) continue;
    const balance = closing - planNeed + ordered;
    const out: ResultRow = { ITEM: row.prod_desc };
    levels.forEach((at, index) => { out[aliasOf(at)] = toText(row[`a${index}`]); });
    Object.assign(out, {
      OPEN_QTY: r2(open), OPEN_AMT: r2(open * rate), PACKING: r2(value("PACKING")), CR_QTY: r2(value("CR_QTY")), PURCH_QTY: r2(value("PURCH_QTY")), PRODUCTION: 0, STOCK_ADD: r2(value("STOCK_ADD")), STOCK_JV_ADD: r2(value("STOCK_JV_ADD")), JOB_IN: r2(value("JOB_IN")),
      DR_QTY: r2(value("DR_QTY")), SALE_QTY: r2(value("SALE_QTY")), CONSUMPTION: r2(value("CONSUMPTION")), JOB_OUT: r2(value("JOB_OUT")), STOCK_LESS: r2(value("STOCK_LESS")), STOCK_JV_LESS: r2(value("STOCK_JV_LESS")), CLSG_QTY: r2(closing), Rate: r2(rate), Amount: r2(closing * rate),
      Pend_Prod_Plan: planNeed, Pend_Purchase_Order: r2(ordered), Balance_Stock: r2(balance), Balance_Stock_Amt: r2(balance * rate), MIN_QTY: row.min_qty === null ? null : num(row.min_qty), LEAD_TIME: row.lead_days === null ? null : num(row.lead_days), STL_WARNING_MESSAGE: row.prod_message,
    });
    rows.push(out);
  }
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => toText(a.row.ITEM).toLowerCase().localeCompare(toText(b.row.ITEM).toLowerCase()) || a.index - b.index).map(({ row }) => row);
  return table;
}
