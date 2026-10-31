import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 301: LOCATION STOCK (SP_FRT_RPT_RPI_LOCATION_STOCK; SPECIAL > Extra Report (RP1) > Location Stock).
 * The stock of the products held in each location (the entry addon's Location, "UNIT - 1" when empty), from the challans (CHLN-IN / CHLN-OUT lines marked Lot No
 * "Yes"; the dates are not used): the opening lines plus what was added less what was taken, for each location of the Location addon list (addon_sub of
 * para 94), one column each. Then the total of the locations, the product's closing stock (in its report unit) and the difference of the two.
 * Products with no closing stock and no stock in any location are left out unless "Print Zero" (CHK_PRNT_ZERO) is ticked. By product code.
 */
const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
const ids = (keys: string) => (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys.trim()) ? keys.trim() : "");

/** The quantity of a challan line in the product's report unit, with the part still against (ag_qty) taken off. */
const reportQuantity = "case when product.rep1_uom = product.pcs_uom then prodled.trn_pcs::numeric - prodled.ag_qty::numeric"
  + [["qty1_uom", "trn_qty1"], ["qty2_uom", "trn_qty2"], ["qty3_uom", "trn_qty3"], ["pack_uom", "trn_pack"], ["weight_uom", "trn_weight"]]
    .map(([unit, column]) => ` when product.rep1_uom = product.${unit} then prodled.${column}::numeric - round(prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.${column}::numeric, 4)`).join("")
  + " else prodled.quantity::numeric - prodled.ag_qty::numeric end";
const closingStock = "case when product.rep1_uom = product.pcs_uom then prodbal.clsg_pcs when product.rep1_uom = product.qty1_uom then prodbal.clsg_qty1 when product.rep1_uom = product.qty2_uom then prodbal.clsg_qty2"
  + " when product.rep1_uom = product.qty3_uom then prodbal.clsg_qty3 when product.rep1_uom = product.pack_uom then prodbal.clsg_pack when product.rep1_uom = product.weight_uom then prodbal.clsg_weight else prodbal.clsg_pcs end";

export async function locationStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;

  // The locations (one column each), by name.
  const locations = (await runReportSql(loader, `SELECT sub_name FROM ${db}addon_sub WHERE sub_pos <> 'D' AND para_id = 94 ORDER BY sub_name`)).rows.map((row) => toText(row.sub_name));

  const filters = [ids(call.selectKey[4]) !== "" ? ` AND prodled.prod_id IN ${ids(call.selectKey[4])}` : ""];
  for (const at of [0, 1, 2, 3].filter((index) => ids(call.selectKey[index]) !== "")) filters.push(` AND ${call.addon[at].trim().replace(/^(p?adata)\.txt_/i, "adata.key_")} IN ${ids(call.selectKey[at])}`);

  // The entry addon's Location field exists only in a company that defined it.
  const hasLocation = (await runReportSql(loader, "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'addon_ientry' AND column_name = 'txt_location'", [loader.session.companySchema])).rows.length > 0;
  const location = hasLocation ? "coalesce(aient.txt_location, '')" : "''";
  const lines = (await runReportSql(loader, `SELECT product.prod_short, product.prod_desc, adata.txt_prodgroup AS prod_group, adata.txt_prodcat AS prod_cat, adata.txt_prodtype AS prod_type, adata.txt_prodclass AS prod_class,`
    + ` CASE WHEN ${location} = '' THEN 'UNIT - 1' ELSE ${location} END AS location,`
    + ` sum(CASE WHEN prodled.order_no = 'OPENING' AND btrim(prodled.trn_module) = 'CHLN-IN' THEN prodled.quantity::numeric WHEN prodled.order_no = 'OPENING' AND btrim(prodled.trn_module) = 'CHLN-OUT' THEN prodled.quantity::numeric * -1 ELSE 0 END) AS open_qty,`
    + ` sum(CASE WHEN prodled.stock_nat = 'A' AND prodled.order_no <> 'OPENING' THEN ${reportQuantity} ELSE 0 END) AS add_qty,`
    + ` sum(CASE WHEN prodled.stock_nat = 'L' AND prodled.order_no <> 'OPENING' THEN ${reportQuantity} ELSE 0 END) AS less_qty,`
    + ` (${closingStock})::numeric AS total_clsg_stk`
    + ` FROM ${db}prod_ledger prodled RIGHT JOIN ${db}product_master product ON prodled.prod_id = product.prod_key LEFT JOIN ${db}prod_balance prodbal ON prodled.prod_id = prodbal.prod_id`
    + ` LEFT JOIN ${db}addon_data adata ON prodled.prod_id = adata.prod_id LEFT JOIN ${db}addon_ientry aient ON prodled.prod_id = aient.aoni_prodid AND prodled.il_key = aient.aoni_il_id`
    + ` WHERE product.inventory = 'Y' AND product.prod_pos <> 'D' AND prodled.il_pos = 'A' AND prodbal.prec_flag = 'RP' AND btrim(prodled.trn_module) IN ('CHLN-OUT', 'CHLN-IN') AND coalesce(prodled.lot_no, '') = 'Yes'${filters.join("")}`
    + ` GROUP BY product.prod_short, product.prod_desc, adata.txt_prodgroup, adata.txt_prodcat, adata.txt_prodtype, adata.txt_prodclass, 7, prodbal.clsg_pcs, prodbal.clsg_qty1, prodbal.clsg_qty2, prodbal.clsg_qty3, prodbal.clsg_pack, prodbal.clsg_weight,`
    + ` product.rep1_uom, product.pcs_uom, product.qty1_uom, product.qty2_uom, product.qty3_uom, product.pack_uom, product.weight_uom`)).rows;

  // One row for each product, the locations across (a location out of the list is left out, as the procedure's pivot does).
  const products = new Map<string, ResultRow>();
  for (const row of lines) {
    const key = [row.prod_short, row.prod_desc, row.prod_group, row.prod_cat, row.prod_type, row.prod_class, row.total_clsg_stk].map(toText).join("|");
    let record = products.get(key);
    if (!record) {
      record = { PROD_CODE: row.prod_short, PROD_DESC: row.prod_desc, PROD_GROUP: row.prod_group, PROD_CAT: row.prod_cat, PROD_TYPE: row.prod_type, PROD_CLASS: row.prod_class, ...Object.fromEntries(locations.map((name) => [name, null])), TOTAL: 0,
        Total_Clsg_Stk: row.total_clsg_stk === null ? null : r2(num(row.total_clsg_stk)), ROW_DATA_TYPE: "LED", DIFF_STK: 0 };
      products.set(key, record);
    }
    const name = locations.find((candidate) => candidate === toText(row.location));
    if (name === undefined) continue;
    record[name] = r2(num(record[name]) + r2(num(row.open_qty) + num(row.add_qty) - num(row.less_qty)));
  }

  const table = new ResultTable();
  const columns = ["PROD_CODE", "PROD_DESC", "PROD_GROUP", "PROD_CAT", "PROD_TYPE", "PROD_CLASS", ...locations, "TOTAL", "Total_Clsg_Stk", "ROW_DATA_TYPE", "DIFF_STK"];
  for (const column of columns) table.addColumn(column);
  for (const column of [...locations, "TOTAL", "Total_Clsg_Stk", "DIFF_STK"]) table.setKind(column, "decimal");
  const printZero = call.checkQuery.includes("CHK_PRNT_ZERO,");
  const rows: ResultRow[] = [];
  for (const record of products.values()) {
    record.TOTAL = r2(locations.reduce((sum, name) => sum + num(record[name]), 0));
    record.DIFF_STK = r2(num(record.TOTAL) - num(record.Total_Clsg_Stk));
    if (!printZero && num(record.Total_Clsg_Stk) === 0 && num(record.TOTAL) === 0) continue;
    rows.push(record);
  }
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => toText(a.row.PROD_CODE).toLowerCase().localeCompare(toText(b.row.PROD_CODE).toLowerCase()) || a.index - b.index).map(({ row }) => row);
  return table;
}
