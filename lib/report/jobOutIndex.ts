import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import type { ReportPlan } from "./generate";
import { style6 } from "./productionSetoff";
import { num, runReportSql } from "./run";

/**
 * 254: JOB OUT INDEX (REPORT_RPI_JOBOUT_INDEX, SP_FRT_RPT_RPI_JOBOUT_INDEX; SPECIAL > Extra Report (RP1) > Job Out Index).
 *  - JOB OUT INDEX: the approved job work out vouchers (the ticked ones) with the party and its address, a line for each product: description, quantity,
 *    transport and vehicle; by the voucher's document number (its last 10 characters) and date.
 *  - Otherwise (the check): the job work out vouchers not yet approved, a line for each product (A: what comes out of stock for the job worker, L: what goes with it):
 *    quantity, In_Stock (closing in the report unit, A lines), Pend_Plan (what the pending plans need of it through the BOMs: still to make on each job card x the
 *    BOM quantity), With_Job_Worker (the job out lines of the product not yet received, less this voucher's own quantity), Required (pending plan less stock less
 *    what the job worker has), As_Per_BOM (the BOM's quantity of a component x the quantity of the A line of the voucher) and Difference (quantity less
 *    As_Per_BOM, L lines). The procedure's cursors are in memory here; the BOMs, plans and job work lines are one grouped read each.
 */
const r4 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 10000) / 10000;
const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
const last10 = (text: unknown) => `                    ${toText(text)}`.slice(-10).toLowerCase();
const byDoc = (a: unknown, b: unknown) => (last10(a) < last10(b) ? -1 : last10(a) > last10(b) ? 1 : 0);

export async function jobOutIndex(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const table = new ResultTable();

  if (call.fcText.trim().toUpperCase() === "JOB OUT INDEX") {
    const keys = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? call.selectKey[4].trim() : "";
    const lines = (await runReportSql(loader, `SELECT led.process_key, led.full_docno, led.doc_no2, led.p_date, ac.name, addr.address_1, addr.address_2, addr.address_3, addr.city, addr.pin_code, prodmas.prod_desc, round(prodled.quantity::numeric, 4) AS quantity, aent.input_despatch, aent.input_vehno`
      + ` FROM ${db}process led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}prod_ledger prodled ON prodled.process_id = led.process_key LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
      + ` LEFT JOIN ${db}address addr ON addr.code = ac.code LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = led.process_key`
      + ` WHERE led.il_pos <> 'D' AND addr.address_id = led.ent_address_id AND prodled.il_pos <> 'D' AND ac.a_pos <> 'D' AND prodmas.prod_pos <> 'D' AND prodled.inventory = 'Y' AND led.ent_approve = 'Yes' AND btrim(led.stk_module) = 'JOB-OUT'${keys === "" ? "" : ` AND led.process_key IN ${keys}`}`
      + ` ORDER BY led.process_key, prodled.il_key`)).rows;
    for (const column of ["full_docno", "Date", "name", "address_1", "address_2", "address_3", "city", "pin_code", "Description", "Quantity", "Transport", "Vehicle"]) table.addColumn(column);
    table.setKind("Quantity", "decimal");
    table.rows = lines.map((row, index) => ({ row, index })).sort((a, b) => byDoc(a.row.doc_no2, b.row.doc_no2) || (a.row.p_date as Date).getTime() - (b.row.p_date as Date).getTime() || a.index - b.index)
      .map(({ row }) => ({ full_docno: row.full_docno, Date: style6(row.p_date as Date | null), name: row.name, address_1: row.address_1, address_2: row.address_2, address_3: row.address_3, city: row.city, pin_code: row.pin_code, Description: row.prod_desc,
        Quantity: num(row.quantity), Transport: row.input_despatch, Vehicle: row.input_vehno }));
    return table;
  }

  // The vouchers waiting for approval.
  const stock = "case when prodmas.rep1_uom = prodmas.pcs_uom then prodbal.clsg_pcs when prodmas.rep1_uom = prodmas.qty1_uom then prodbal.clsg_qty1 when prodmas.rep1_uom = prodmas.qty2_uom then prodbal.clsg_qty2"
    + " when prodmas.rep1_uom = prodmas.qty3_uom then prodbal.clsg_qty3 when prodmas.rep1_uom = prodmas.pack_uom then prodbal.clsg_pack when prodmas.rep1_uom = prodmas.weight_uom then prodbal.clsg_weight else prodbal.clsg_pcs end";
  type Line = { prod: number; doc: string; sort: unknown; date: Date; serial: number; party: unknown; desc: unknown; quantity: number; pendPlan: number; inStock: number; withWorker: number | null; required: number; asPerBom: number; difference: number; nature: string; at: number };
  const temp: Line[] = (await runReportSql(loader, `SELECT prodled.prod_id, led.full_docno, led.doc_no2, led.p_date, prodled.il_serial, ac.name AS party_name, prodmas.prod_desc, round(prodled.quantity::numeric, 4) AS quantity, prodled.stock_nat,`
    + ` round(CASE WHEN prodled.stock_nat = 'A' THEN (${stock})::numeric ELSE 0 END, 4) AS in_stock FROM ${db}process led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}prod_ledger prodled ON prodled.process_id = led.process_key`
    + ` LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}prod_balance prodbal ON prodmas.prod_key = prodbal.prod_id`
    + ` WHERE led.il_pos <> 'D' AND prodled.il_pos <> 'D' AND ac.a_pos <> 'D' AND prodmas.prod_pos <> 'D' AND (coalesce(led.ent_approve, '') = '' OR led.ent_approve = 'NO') AND btrim(led.stk_module) = 'JOB-OUT' AND prodbal.prec_flag = 'RP'`
    + ` ORDER BY led.process_key, prodled.il_key`)).rows.map((row, at) => ({ prod: num(row.prod_id), doc: toText(row.full_docno), sort: row.doc_no2, date: row.p_date as Date, serial: num(row.il_serial), party: row.party_name, desc: row.prod_desc, quantity: num(row.quantity),
      pendPlan: 0, inStock: num(row.in_stock), withWorker: 0, required: 0, asPerBom: 0, difference: 0, nature: toText(row.stock_nat), at }));
  temp.sort((a, b) => byDoc(a.sort, b.sort) || a.date.getTime() - b.date.getTime() || a.serial - b.serial || a.at - b.at);
  const issued = new Set(temp.filter((line) => line.nature === "A").map((line) => line.prod));

  // The BOMs: each document's products made (A) and taken (L).
  const bomLines = (await runReportSql(loader, `SELECT prod_id, full_docno, quantity::numeric AS quantity, stock_nat, il_pos FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' ORDER BY il_key`)).rows;
  const madeBy = new Map<string, number>();
  const takes: { prod: number; doc: string; quantity: number }[] = [];
  const bomOf = new Map<number, string>();
  for (const row of bomLines) {
    if (toText(row.stock_nat) === "A") { madeBy.set(toText(row.full_docno), num(row.prod_id)); if (toText(row.il_pos) === "A") bomOf.set(num(row.prod_id), toText(row.full_docno)); }
    else if (toText(row.stock_nat) === "L" && toText(row.il_pos) === "A") takes.push({ prod: num(row.prod_id), doc: toText(row.full_docno), quantity: num(row.quantity) });
  }
  // The products with a BOM that takes a product of the vouchers, and what their plans still need to make.
  const finished = new Set<number>();
  for (const line of takes) if (issued.has(line.prod)) { const made = madeBy.get(line.doc); if (made !== undefined && bomOf.get(made) === line.doc) finished.add(made); }
  const pendingPlan = new Map<number, number>();
  if (finished.size > 0) {
    for (const row of (await runReportSql(loader, `SELECT prodplan.prod_id, coalesce(sum(prodplan.plan_qty::numeric - coalesce(prodplan.plan_sort, 0)::numeric), 0) - coalesce(pq.pending, 0) AS plan_pend FROM ${db}production_planing prodplan`
      + ` LEFT JOIN (SELECT prodled.prod_id, aent.input_job_card, sum(CASE WHEN prodled.stock_nat = 'A' AND ((btrim(prodled.trn_module) = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD') OR btrim(prodled.trn_module) = 'PROD-FG' OR btrim(prodled.trn_module) = 'PROD-SFG'`
      + ` OR (btrim(prodled.trn_module) = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN (prodled.quantity::numeric - prodled.ag_qty::numeric) ELSE 0 END) AS pending`
      + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id WHERE prodled.il_pos = 'A' AND coalesce(aent.input_job_card, '') <> '' GROUP BY prodled.prod_id, aent.input_job_card) pq ON pq.prod_id = prodplan.prod_id AND pq.input_job_card = prodplan.job_card_no`
      + ` WHERE coalesce(prodplan.job_card_no, '') <> '' AND prodplan.prod_id = ANY($1::int[]) GROUP BY prodplan.prod_id, prodplan.job_card_no, pq.pending`, [[...finished]])).rows) {
      if (num(row.plan_pend) > 0) pendingPlan.set(num(row.prod_id), (pendingPlan.get(num(row.prod_id)) ?? 0) + num(row.plan_pend));
    }
  }
  // Pend_Plan: the plan of the product each BOM makes x its BOM quantity, summed by product (the procedure adds a product's BOMs one after the other).
  const needs = new Map<number, number>();
  for (const line of takes) {
    if (!temp.some((entry) => entry.prod === line.prod)) continue;
    const made = madeBy.get(line.doc);
    if (made === undefined || !pendingPlan.has(made)) continue;
    const planned = r2(pendingPlan.get(made)!);
    if (planned > 0) needs.set(line.prod, r4((needs.get(line.prod) ?? 0) + planned * line.quantity));
  }
  for (const line of temp) { const need = needs.get(line.prod); if (need !== undefined && need > 0) line.pendPlan = need; }

  // With the job worker: the job work lines of each product not yet received.
  const withWorker = new Map<number, number>();
  if (issued.size > 0) {
    for (const row of (await runReportSql(loader, `SELECT prod_id, sum(quantity::numeric - CASE WHEN ag_fact IS NOT NULL AND cost_rate IS NOT NULL THEN ag_fact::numeric + cost_rate::numeric + coalesce(setof_qty, 0)::numeric ELSE 0 END) AS pending`
      + ` FROM ${db}prod_ledger WHERE il_pos = 'A' AND btrim(trn_module) = 'JOB-OUT' AND prod_id = ANY($1::int[]) GROUP BY prod_id`, [[...issued]])).rows) withWorker.set(num(row.prod_id), num(row.pending));
  }
  for (const line of temp) {
    if (line.nature !== "A") continue;
    const has = withWorker.get(line.prod);
    line.withWorker = has === undefined ? null : r4(has - line.quantity);
    line.required = line.withWorker === null ? 0 : r4(line.pendPlan - line.inStock - line.withWorker);
  }

  // As per BOM: each component of the BOM of an A line's product, x the A line's quantity, on the lines of that voucher.
  const components = new Map<string, { prod: number; quantity: number }[]>();
  for (const line of takes) { const list = components.get(line.doc) ?? []; list.push({ prod: line.prod, quantity: line.quantity }); components.set(line.doc, list); }
  for (const line of temp.filter((entry) => entry.nature === "A")) {
    const bom = bomOf.get(line.prod);
    if (!bom) continue;
    for (const component of components.get(bom) ?? []) for (const target of temp) if (target.doc === line.doc && target.prod === component.prod) target.asPerBom = r4(component.quantity * line.quantity);
  }
  for (const line of temp) if (line.nature === "L") line.difference = r4(line.quantity - line.asPerBom);

  for (const column of ["prod_id", "full_docno", "Date", "party_name", "Description", "Quantity", "Pend_Plan", "In_Stock", "With_Job_Worker", "Required", "As_Per_BOM", "Difference"]) table.addColumn(column);
  table.setKind("prod_id", "int");
  for (const column of ["Quantity", "Pend_Plan", "In_Stock", "With_Job_Worker", "Required", "As_Per_BOM", "Difference"]) table.setKind(column, "decimal");
  table.rows = temp.map((line): ResultRow => ({ prod_id: line.prod, full_docno: line.doc, Date: style6(line.date), party_name: line.party, Description: line.desc, Quantity: line.quantity, Pend_Plan: line.pendPlan, In_Stock: line.inStock, With_Job_Worker: line.withWorker,
    Required: line.required, As_Per_BOM: line.asPerBom, Difference: line.difference }));
  return table;
}
