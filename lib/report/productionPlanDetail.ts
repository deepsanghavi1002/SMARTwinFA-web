import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 170 PRODUCTION PLANING DETAIL, 207 ... MOULDING, 208 ... FILLING, 209 ... STAMPING (SP_FRT_RPT_RPI_PRODUCTION_PLANING_DETAIL; SPECIAL > Extra Report
 * (RP)): the production plans (type PP) of the ticked products whose entry date (or packing date, with "Packing Plan Date Wise Require") falls
 * From .. Upto, a line for the finished good under each BOM of its product (BOM number + 'z' + item for the order) and under it a line for each
 * component of that BOM ("<BOM>zz<component>   L", quantity = the BOM's quantity x the planned quantity, rounded to whole numbers).
 *  - 170 adds the standard packing, the cartons, the finished good's rate (the product's latest sale rate up to Upto) and value, and the purchase order
 *    (quantity, vendor, date, number, schedule) and bill (quantity, received date) of the line's product against the plan's job card.
 *  - 207, 208 and 209 are the same lines for one group of products only: Plastic Moulded / Plated / Metalizing parts, Insulated - Filling, Stamping Foils
 *    (by the line's own group or category), without the rate, value and purchase columns.
 *  - "Only Pending Job Card Require" leaves out the job cards whose plan has been produced (FG process quantity up to the plan less short) or has no
 *    quantity left (plan = short); lines with no job card go with them, as the procedure's variables start at 0.
 * By the sorting text. The work tables are in memory from a few reads.
 */
type Fg = { key: number; bom: string; desc: string; entry: Date | null; job: string; plan: number; short: number; pack: Date | null; group: string; category: string; type: string; unit: string; uom: string; base: number | null };
type Component = { doc: string; key: number; desc: string; qty: number; group: string; category: string; type: string; unit: string; uom: string };
type Line = ResultRow & { _job: string };

const style6 = (date: Date | null) => (date === null ? "" : `${String(date.getDate()).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`);
const round = (value: number, places = 2) => { const factor = 10 ** places; return Math.round((value + Math.sign(value) * 1e-9) * factor) / factor; };
const WHOLE = (value: number) => (value < 0 ? -Math.floor(-value) : Math.floor(value));

export async function productionPlanDetail(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const rk = call.reportKey;
  const params = [desktopDate(call.from), desktopDate(call.upto)];
  const byPacking = call.checkQuery.includes("CHK_PACKPLANDATE,");
  const products = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? ` AND prodmas.prod_key IN ${call.selectKey[4].trim()}` : "";

  // The finished good lines: a plan under each BOM (the A line) of its product.
  const fgs: Fg[] = (await runReportSql(loader, `SELECT prodmas.prod_key, prodled.full_docno AS bom, prodmas.prod_desc, prodplan.ent_date, prodplan.job_card_no, prodplan.plan_qty::numeric AS plan_qty, coalesce(prodplan.plan_sort, 0) AS plan_sort,`
    + ` prodplan.packing_date, adata.txt_prodgroup, adata.txt_prodcat, adata.txt_prodtype, adata.txt_produnit, produom.uom_short, prodmas.base_pack::numeric AS base_pack`
    + ` FROM ${db}production_planing prodplan LEFT JOIN ${db}prod_ledger prodled ON prodled.prod_id = prodplan.prod_id LEFT JOIN ${db}product_master prodmas ON prodled.prod_id = prodmas.prod_key`
    + ` LEFT JOIN ${db}prod_uom produom ON prodled.uomentry_id = produom.uom_key LEFT JOIN ${db}addon_data adata ON prodled.prod_id = adata.prod_id`
    + ` WHERE btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'A' AND prodplan.${byPacking ? "packing_date" : "ent_date"} BETWEEN $1::date AND $2::date AND prodplan.ent_type = 'PP'${products}`, params)).rows
    .map((row) => ({ key: num(row.prod_key), bom: toText(row.bom), desc: toText(row.prod_desc), entry: row.ent_date as Date | null, job: toText(row.job_card_no).trim(), plan: num(row.plan_qty), short: num(row.plan_sort), pack: row.packing_date as Date | null,
      group: toText(row.txt_prodgroup), category: toText(row.txt_prodcat), type: toText(row.txt_prodtype), unit: toText(row.txt_produnit), uom: toText(row.uom_short), base: row.base_pack === null ? null : num(row.base_pack) }));

  // The latest sale rate of each product up to Upto (170).
  const rates = new Map<number, number>();
  if (rk === 170 && fgs.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, pl_srate::numeric AS rate FROM ${db}pricelist WHERE prod_id = ANY($1::int[]) AND pl_pos <> 'D' AND pl_srate::numeric > 0 AND pl_wefrom <= $2::date ORDER BY prod_id, pl_wefrom DESC`,
      [[...new Set(fgs.map((fg) => fg.key))], params[1]])).rows) rates.set(num(row.prod_id), num(row.rate));
  }

  // The components of those BOMs.
  const bomOf = new Map<string, Component[]>();
  const docs = [...new Set(fgs.map((fg) => fg.bom))];
  if (docs.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT prodled.full_docno AS doc, prodmas.prod_key, prodmas.prod_desc, prodled.quantity::numeric AS quantity, adata.txt_prodgroup, adata.txt_prodcat, adata.txt_prodtype, adata.txt_produnit, produom.uom_short`
      + ` FROM ${db}prod_ledger prodled JOIN ${db}product_master prodmas ON prodled.prod_id = prodmas.prod_key JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key JOIN ${db}prod_uom produom ON prodled.uomentry_id = produom.uom_key`
      + ` WHERE prodmas.prod_pos <> 'D' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'L' AND btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.full_docno = ANY($1::text[])`, [docs])).rows) {
      const component: Component = { doc: toText(row.doc), key: num(row.prod_key), desc: toText(row.prod_desc), qty: num(row.quantity), group: toText(row.txt_prodgroup), category: toText(row.txt_prodcat), type: toText(row.txt_prodtype), unit: toText(row.txt_produnit), uom: toText(row.uom_short) };
      const list = bomOf.get(component.doc);
      if (list) list.push(component); else bomOf.set(component.doc, [component]);
    }
  }

  // The purchase orders and bills against the plans' job cards (170).
  const orders = new Map<string, ResultRow>();
  const bills = new Map<string, ResultRow>();
  const jobs = [...new Set(fgs.map((fg) => fg.job).filter((job) => job !== ""))];
  if (rk === 170 && jobs.length > 0) {
    const keys = [...new Set([...fgs.map((fg) => fg.key), ...[...bomOf.values()].flat().map((component) => component.key)])];
    for (const row of (await runReportSql(loader, `SELECT prodmas.prod_key, ient.input_pjobcard AS job, prodled.quantity::numeric AS quantity, ac.name AS vendor, to_char(prodled.il_date, 'DD-Mon-YY') AS po_date, prodled.full_docno AS po_no, to_char(ient.input_sch_date, 'DD-Mon-YY') AS schedule`
      + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id LEFT JOIN ${db}addon_ientry ient ON ient.aoni_il_id = prodled.il_key LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
      + ` LEFT JOIN ${db}account ac ON ac.code = prodled.code WHERE prodled.il_pos = 'A' AND prodled.book = 13 AND btrim(prodled.trn_module) = 'ORD-IN' AND proce.il_pos = 'A' AND ac.book = 3`
      + ` AND ient.input_pjobcard = ANY($1::text[]) AND prodled.prod_id = ANY($2::int[]) ORDER BY prodled.il_key`, [jobs, keys])).rows) { const key = `${num(row.prod_key)}\u0000${toText(row.job).trim()}`; if (!orders.has(key)) orders.set(key, row); }
    for (const row of (await runReportSql(loader, `SELECT prodmas.prod_key, ient.input_pjobcard AS job, prodled.quantity::numeric AS quantity, to_char(led.doc_date, 'DD-Mon-YY') AS received`
      + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}ledger led ON led.led_key = prodled.led_id LEFT JOIN ${db}addon_ientry ient ON ient.aoni_il_id = prodled.il_key LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
      + ` WHERE prodled.il_pos = 'A' AND prodled.book = 13 AND led.doc_pos = 'A' AND ient.input_pjobcard = ANY($1::text[]) AND prodled.prod_id = ANY($2::int[]) ORDER BY prodled.il_key`, [jobs, keys])).rows) { const key = `${num(row.prod_key)}\u0000${toText(row.job).trim()}`; if (!bills.has(key)) bills.set(key, row); }
  }

  const lines: Line[] = [];
  const purchase = (key: number, job: string) => {
    const order = orders.get(`${key}\u0000${job}`);
    const bill = bills.get(`${key}\u0000${job}`);
    return { ORDER_QTY: order ? num(order.quantity) : 0, VENDOR_NAME: order ? toText(order.vendor) : "", PO_DATE: order ? toText(order.po_date) : "", PO_NO: order ? toText(order.po_no) : "", SCHEDULE_DATE: order ? toText(order.schedule) : "",
      RECEIVED_DATE: bill ? toText(bill.received) : "", BILL_QTY: bill ? num(bill.quantity) : 0 };
  };
  for (const fg of fgs) {
    const cartons = fg.base !== null && fg.base > 0 ? WHOLE(fg.plan / fg.base) : WHOLE(fg.plan);
    const rate = rates.get(fg.key) ?? 0;
    lines.push({ _job: fg.job, SORTING_FIELD: `${fg.bom}z${fg.desc}`, Plan_Entry_Date: style6(fg.entry), Job_Card_No: fg.job, FG_Product: fg.desc, Description: fg.desc, Planing_Qty: fg.plan, PRODUCT_GROUP: fg.group, PRODUCT_CATEGORY: fg.category,
      PRODUCT_TYPE: fg.type, PRODUCTION_UNIT: fg.unit, Planing_Short: fg.short, UOM: fg.uom, Std_Packing: fg.base === null ? null : WHOLE(fg.base), Noof_cartoon: cartons, Plan_Pack_Date: style6(fg.pack), FG_Rate: rate, FG_Value: round(fg.plan * rate, 2), ...purchase(fg.key, fg.job) });
    for (const component of bomOf.get(fg.bom) ?? []) {
      lines.push({ _job: fg.job, SORTING_FIELD: `${fg.bom}zz${component.desc}   L`, Plan_Entry_Date: style6(fg.entry), Job_Card_No: fg.job, FG_Product: fg.desc, Description: component.desc, Planing_Qty: Math.round(component.qty * fg.plan), PRODUCT_GROUP: component.group,
        PRODUCT_CATEGORY: component.category, PRODUCT_TYPE: component.type, PRODUCTION_UNIT: component.unit, Planing_Short: 0, UOM: component.uom, Std_Packing: 0, Noof_cartoon: 0, Plan_Pack_Date: style6(fg.pack), FG_Rate: 0, FG_Value: 0, ...purchase(component.key, fg.job) });
    }
  }

  // Only pending job cards.
  let kept = lines;
  if (call.checkQuery.includes("CHK_PENDJOB,")) {
    const plans = new Map<string, { plan: number; short: number }>();
    for (const row of (await runReportSql(loader, `SELECT job_card_no, plan_qty::numeric AS plan_qty, coalesce(plan_sort, 0) AS plan_sort FROM ${db}production_planing WHERE job_card_no = ANY($1::text[]) ORDER BY prod_plan_key`, [jobs])).rows) plans.set(toText(row.job_card_no).trim(), { plan: num(row.plan_qty), short: num(row.plan_sort) });
    const produced = new Map<string, number>();
    if (jobs.length > 0) {
      for (const row of (await runReportSql(loader, `SELECT prodplan.job_card_no, coalesce(sum(prodled.quantity::numeric), 0) AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id`
        + ` LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = proce.process_key LEFT JOIN ${db}production_planing prodplan ON prodplan.job_card_no = aent.input_job_card`
        + ` WHERE prodled.il_pos = 'A' AND proce.il_pos = 'A' AND btrim(proce.stk_module) = 'PROD-FG' AND prodled.prod_id = prodplan.prod_id AND prodplan.job_card_no = ANY($1::text[]) AND proce.p_date BETWEEN $2::date AND $3::date AND prodplan.ent_type = 'PP' GROUP BY prodplan.job_card_no`,
        [jobs, params[0], params[1]])).rows) produced.set(toText(row.job_card_no).trim(), num(row.quantity));
    }
    // The procedure's variables stay as they were when a job card has no plan row; they start at 0, so lines without a job card go.
    let planQty = 0;
    let planShort = 0;
    const dropped = new Set<string>();
    for (const job of [...new Set(lines.map((line) => line._job))].sort()) {
      const found = plans.get(job);
      if (found) { planQty = found.plan; planShort = found.short; }
      const made = produced.get(job) ?? 0;
      if (made >= planQty - planShort || planQty === planShort) dropped.add(job);
    }
    kept = lines.filter((line) => !dropped.has(line._job));
  }

  const filters: Record<number, (line: Line) => boolean> = {
    207: (line) => ["Plastic Moulded Parts", "Plated Parts", "Plated Parts Metalizing", "Metalizing Parts"].some((group) => group.toLowerCase() === toText(line.PRODUCT_GROUP).trim().toLowerCase()),
    208: (line) => toText(line.PRODUCT_CATEGORY).trim().toLowerCase() === "insulated - filling",
    209: (line) => toText(line.PRODUCT_GROUP).trim().toLowerCase() === "stamping foils",
  };
  if (filters[rk]) kept = kept.filter(filters[rk]);

  const columns = rk === 170
    ? ["SORTING_FIELD", "Plan_Entry_Date", "Job_Card_No", "FG_Product", "Description", "Planing_Qty", "PRODUCT_GROUP", "PRODUCT_CATEGORY", "PRODUCT_TYPE", "PRODUCTION_UNIT", "Planing_Short", "UOM", "Std_Packing", "Noof_cartoon", "Plan_Pack_Date", "FG_Rate", "FG_Value",
      "ORDER_QTY", "VENDOR_NAME", "PO_DATE", "PO_NO", "SCHEDULE_DATE", "RECEIVED_DATE", "BILL_QTY"]
    : ["SORTING_FIELD", "Plan_Entry_Date", "Job_Card_No", "FG_Product", "Description", "Planing_Qty", "PRODUCT_GROUP", "PRODUCT_CATEGORY", "PRODUCT_TYPE", "PRODUCTION_UNIT", "Planing_Short", "UOM", "Noof_cartoon", "Plan_Pack_Date"];
  const table = new ResultTable();
  for (const column of columns) table.addColumn(column);
  for (const column of ["Planing_Qty", "Planing_Short", "FG_Rate", "FG_Value", "ORDER_QTY", "BILL_QTY"]) if (table.has(column)) table.setKind(column, "decimal");
  for (const column of ["Std_Packing", "Noof_cartoon"]) if (table.has(column)) table.setKind(column, "int");
  table.rows = kept.map((line, index) => ({ line, index })).sort((a, b) => toText(a.line.SORTING_FIELD).toLowerCase().localeCompare(toText(b.line.SORTING_FIELD).toLowerCase()) || a.index - b.index)
    .map(({ line }) => Object.fromEntries(columns.map((column) => [column, line[column] ?? null])));
  return table;
}
