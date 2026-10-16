import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 227: MFG FORMULA SEARCH (REPORT_RPI_MFG_FORMULA_SEARCH, SP_FRT_RPT_RPI_MFG_FORMULA_SEARCH; SPECIAL > Extra Report (RP1) > MFG Formula Search).
 * The first combo picks the product type: 1 Finish Goods, 2 Semi Finished Material, anything else Raw Material.
 * With "With Formula": the BOMs (MFG-BOM) whose finished product is of that type, a line for the product made (Finish_goods, no component) and a line for
 * each component (the finish goods of the BOM beside it): voucher no, BOM document, finish goods, component, quantity (4 decimals), its report unit,
 * and the group, type and category of the product on the line; by voucher no, finish goods, component.
 * Without it: the products of that type that have no BOM, as ITEM, by description.
 */
export async function mfgFormulaSearch(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const type = call.fcValue === 1 ? "FINISH GOODS" : call.fcValue === 2 ? "Semi Finished Material" : "Raw Material";
  const table = new ResultTable();

  if (!call.checkQuery.includes("CHK_WITH_FORMULA,")) {
    table.addColumn("Item");
    table.rows = (await runReportSql(loader, `SELECT prodmas.prod_desc FROM ${db}product_master prodmas LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key WHERE prodmas.prod_pos = 'A' AND lower(rtrim(adata.txt_prodtype)) = lower($1)`
      + ` AND prodmas.prod_key NOT IN (SELECT prod_id FROM ${db}prod_ledger WHERE il_pos = 'A' AND btrim(trn_module) = 'MFG-BOM' AND stock_nat = 'A' AND prod_id IS NOT NULL)`, [type])).rows
      .map((row) => ({ Item: row.prod_desc } as ResultRow)).sort((a, b) => toText(a.Item).toLowerCase().localeCompare(toText(b.Item).toLowerCase()));
    return table;
  }

  for (const column of ["Voucher_No", "full_docno", "finish_goods", "semi_finish_prod", "Rm_qty", "Uom", "PROD_GROUP", "PROD_TYPE", "CATEGORY"]) table.addColumn(column);
  table.setKind("Rm_qty", "decimal");
  // The BOM lines are read twice (made / used) and joined here: the procedure looked up the finished product of every line (and the type of its BOM) with a query each.
  const read = async (nature: string) => (await runReportSql(loader, `SELECT prodled.il_key, prodled.full_docno, prodmas.prod_pos, prodmas.prod_desc, btrim(proce.doc_no2) AS voucher_no, round(prodled.quantity::numeric, 4) AS rm_qty, puom.uom_short AS uom,`
    + ` adata.txt_prodgroup AS prod_group, adata.txt_prodtype AS prod_type, adata.txt_prodcat AS category FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
    + ` LEFT JOIN ${db}addon_data adata ON prodmas.prod_key = adata.prod_id LEFT JOIN ${db}process proce ON prodled.process_id = proce.process_key LEFT JOIN ${db}prod_uom puom ON prodmas.rep1_uom = puom.uom_key`
    + ` WHERE btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.il_pos <> 'D' AND prodled.stock_nat = '${nature}' ORDER BY prodled.il_key`)).rows;
  const made = await read("A");
  const used = await read("L");
  const wanted = type.toLowerCase();
  const typed = (row: ResultRow) => toText(row.prod_type).replace(/\s+$/, "").toLowerCase() === wanted;
  const documents = new Set(made.filter(typed).map((row) => toText(row.full_docno)));
  const finishGoods = new Map<string, string>();
  for (const row of made) if (toText(row.prod_pos) === "A" && !finishGoods.has(toText(row.full_docno))) finishGoods.set(toText(row.full_docno), toText(row.prod_desc));
  const line = (row: ResultRow, goods: string, component: string) => ({ Voucher_No: row.voucher_no, full_docno: row.full_docno, finish_goods: goods, semi_finish_prod: component, Rm_qty: row.rm_qty === null ? null : num(row.rm_qty),
    Uom: row.uom, PROD_GROUP: row.prod_group, PROD_TYPE: row.prod_type, CATEGORY: row.category });
  const rows: ResultRow[] = [
    ...used.filter((row) => toText(row.prod_pos) === "A" && documents.has(toText(row.full_docno))).map((row) => line(row, finishGoods.get(toText(row.full_docno)) ?? "", toText(row.prod_desc))),
    ...made.filter((row) => toText(row.prod_pos) === "A" && typed(row)).map((row) => line(row, toText(row.prod_desc), "")),
  ];
  const low = (value: unknown) => toText(value).toLowerCase();
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => low(a.row.Voucher_No).localeCompare(low(b.row.Voucher_No)) || low(a.row.finish_goods).localeCompare(low(b.row.finish_goods)) || low(a.row.semi_finish_prod).localeCompare(low(b.row.semi_finish_prod)) || a.index - b.index).map(({ row }) => row);
  return table;
}
