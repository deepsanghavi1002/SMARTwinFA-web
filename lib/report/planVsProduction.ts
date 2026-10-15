import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 189: PLANNING V/S PRODUCTION (REPORT_RPI_PLANNING_PRODUCTION, SP_FRT_RPT_RPI_PRODUCTION_VS_PLANING; SPECIAL > Extra Report (RP) > Planning V/S Production).
 * For ONE product (the Product Code group's single pick) and the plans of the Upto day (type PP): the plan's lines (item, entry date, planned quantity and short)
 * and below it a line for each component of the product's BOM with what the plan needs of it (FORMULA_QTY: the BOM's; REQ_QTY: planned less short x it), what was
 * moulded of it (MOULDING_QTY: the quantity of that component taken on the processes that made this product on the plan's job cards), EXTRA_MOULDING_QTY
 * (moulded less needed) and PLAN_VS_MOULDING (the extra over the need); the plan's line shows FG_PRODUCTION_QTY (the product's finished good entries on those job
 * cards, of all dates, to whole numbers) and PLAN_VS_FG_PRODUCTION (over the planned quantity). The quantities of MOULDING / EXTRA / FG are whole numbers, as the
 * procedure keeps them. By the sorting text (the product, then "<product>  zz" for its components). One read of each.
 */
export async function planVsProduction(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const key = call.selectKey[4].trim();
  if (key.includes(",")) throw new ReportRefusal("Multiple Product Selection Not Allowed", "INTERNAL PROGRAM FAILURE");
  const productKey = /^\(\s*(\d+)\s*\)$/.exec(key)?.[1];
  if (productKey === undefined) throw new ReportRefusal("Select the product (Product Code group)", "INTERNAL PROGRAM FAILURE");
  const wholeNumber = (value: number) => Math.round(value + Math.sign(value) * 1e-9);
  const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

  const table = new ResultTable();
  for (const column of ["sr_no", "SORTING_FIELD", "Description", "Plan_Entry_Date", "Planing_Qty", "Planing_Short", "CONSUME_PRODUCT", "FORMULA_QTY", "REQ_QTY", "MOULDING_QTY", "EXTRA_MOULDING_QTY", "PLAN_VS_MOULDING", "FG_PRODUCTION_QTY", "PLAN_VS_FG_PRODUCTION"]) table.addColumn(column);
  for (const column of ["Planing_Qty", "Planing_Short", "FORMULA_QTY", "REQ_QTY", "MOULDING_QTY", "EXTRA_MOULDING_QTY", "PLAN_VS_MOULDING", "PLAN_VS_FG_PRODUCTION"]) table.setKind(column, "decimal");
  table.setKind("sr_no", "int");
  table.setKind("FG_PRODUCTION_QTY", "int");

  const plans = (await runReportSql(loader, `SELECT prodmas.prod_key, prodmas.prod_desc, prodplan.ent_date, prodplan.plan_qty::numeric AS plan_qty, coalesce(prodplan.plan_sort, 0) AS plan_sort FROM ${db}production_planing prodplan`
    + ` LEFT JOIN ${db}product_master prodmas ON prodplan.prod_id = prodmas.prod_key WHERE prodplan.ent_date = $1::date AND prodplan.ent_type = 'PP' AND prodplan.plan_qty > 0 AND prodmas.prod_pos = 'A' AND prodplan.prod_id = ${productKey}`
    + ` ORDER BY prodplan.prod_plan_key`, [desktopDate(call.upto)])).rows;
  if (plans.length === 0) return table;
  const last = plans[plans.length - 1];
  const description = toText(last.prod_desc);
  const need = num(last.plan_qty) - num(last.plan_sort);

  // The product's BOM and its components.
  const bom = toText((await runReportSql(loader, `SELECT full_docno FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' AND stock_nat = 'A' AND prod_id = ${productKey} ORDER BY il_key DESC LIMIT 1`)).rows[0]?.full_docno);
  const components = bom === "" ? [] : (await runReportSql(loader, `SELECT prodmas.prod_key, prodmas.prod_desc, prodled.quantity::numeric AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
    + ` WHERE btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' AND prodmas.prod_pos = 'A' AND prodmas.inventory = 'Y' AND prodled.full_docno = $1 ORDER BY prodled.il_key`, [bom])).rows;

  // The finished good entries of the product on the job cards of its plans, and what those processes took.
  const made = (await runReportSql(loader, `SELECT prodled.process_id, prodled.quantity::numeric AS quantity FROM ${db}product_master prodmas LEFT JOIN ${db}prod_ledger prodled ON prodmas.prod_key = prodled.prod_id`
    + ` LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id LEFT JOIN ${db}production_planing prodplan ON prodplan.prod_id = prodled.prod_id`
    + ` WHERE prodled.il_pos = 'A' AND btrim(prodled.trn_module) = 'PROD-FG' AND prodled.stock_nat = 'A' AND aent.input_job_card = prodplan.job_card_no AND prodled.prod_id = ${productKey} AND prodmas.prod_pos = 'A'`)).rows;
  const finished = wholeNumber(made.reduce((total, row) => total + num(row.quantity), 0));
  const processes = [...new Set(made.map((row) => num(row.process_id)).filter((id) => id !== 0))];
  const moulded = new Map<number, number>();
  if (processes.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT prod_id, quantity::numeric AS quantity, process_id FROM ${db}prod_ledger WHERE il_pos = 'A' AND stock_nat = 'L' AND process_id = ANY($1::int[]) ORDER BY process_id`, [processes])).rows) {
      moulded.set(num(row.prod_id), wholeNumber((moulded.get(num(row.prod_id)) ?? 0) + num(row.quantity)));
    }
  }

  const rows: ResultRow[] = [];
  const entry = (date: unknown) => { const value = date as Date; return `${String(value.getDate()).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][value.getMonth()]}-${String(value.getFullYear()).slice(-2)}`; };
  for (const row of plans) {
    const planned = num(row.plan_qty);
    rows.push({ sr_no: num(row.prod_key), SORTING_FIELD: description, Description: toText(row.prod_desc), Plan_Entry_Date: entry(row.ent_date), Planing_Qty: planned, Planing_Short: num(row.plan_sort), CONSUME_PRODUCT: "", FORMULA_QTY: 0, REQ_QTY: 0,
      MOULDING_QTY: 0, EXTRA_MOULDING_QTY: 0, PLAN_VS_MOULDING: 0, FG_PRODUCTION_QTY: toText(row.prod_desc) === description ? finished : 0,
      PLAN_VS_FG_PRODUCTION: toText(row.prod_desc) === description && finished !== 0 ? round2(finished / planned) : 0 });
  }
  for (const component of components) {
    const formula = round2(num(component.quantity));
    const required = round2(need * num(component.quantity));
    const moulding = moulded.get(num(component.prod_key)) ?? 0;
    const extra = wholeNumber(moulding - required);
    rows.push({ sr_no: num(component.prod_key), SORTING_FIELD: `${description}  zz`, Description: null, Plan_Entry_Date: null, Planing_Qty: null, Planing_Short: 0, CONSUME_PRODUCT: toText(component.prod_desc), FORMULA_QTY: formula, REQ_QTY: required,
      MOULDING_QTY: moulding, EXTRA_MOULDING_QTY: extra, PLAN_VS_MOULDING: extra !== 0 && required !== 0 ? round2(extra / required) : 0, FG_PRODUCTION_QTY: 0, PLAN_VS_FG_PRODUCTION: 0 });
  }
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => toText(a.row.SORTING_FIELD).toLowerCase().localeCompare(toText(b.row.SORTING_FIELD).toLowerCase()) || a.index - b.index).map(({ row }) => row);
  return table;
}
