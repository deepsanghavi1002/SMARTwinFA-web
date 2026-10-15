import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 160 PRODUCTION SUMMARY (REPORT_PRODUCTION_SUMMARY) and 216 DAILY PACKING (REPORT_RPI_DAILY_PACKING): SP_FRT_RPT_RPI_PRODUCTION_SUMMARY
 * (SPECIAL > Extra Report (RP)). The runtime boxes of the sorting give the net rates: Other Perc (75 %) and Export Perc (68 %).
 *
 *  - 160 Summary: one line PRODUCTION: the target of the period's months (TARGET without an account), the gross production (the Finish Goods
 *    entries PROD-FG of the period at the sale rate of their day, Export items apart), the outsourced production (the Finish Goods bought:
 *    book 13 lines, at the product's last rate up to Upto), the net of each at the percentages, the shortfall against the target and the
 *    percentage achieved. With no target, no line. As the procedure works it out: the other net uses Other Perc, the outsourced other net uses
 *    Export Perc, Export's nets use Other Perc, and the final figure takes Export's gross (not its net) with the outsourced.
 *  - 160 Detail: a line for each Finish Goods entry (date, document, job card, item, quantity, rate, gross and net production at the
 *    percentages) and for each outsourced purchase (outsourced gross and net), with the ticked addon groups, by addon then date.
 *  - 216 Daily Packing: each Finish Goods entry of the period with its job card and process remark, the lot (the plan's quantity) and what is
 *    still to be packed (the plan less the production before From, then less each entry in turn of its job card), the cartons and loose
 *    pieces (the standard pack), the total packed, the percentage complete and the gross and net value (at the rate of the day).
 *    A line with no lot shows no percentage (the procedure divides by zero). A product with no standard pack counts as 0 per carton.
 * The work tables are in memory from a few reads; nothing is written.
 */
const r2 = (value: number, places = 2) => { const factor = 10 ** places; return Math.round((value + Math.sign(value) * 1e-9) * factor) / factor; };
const isExport = (text: unknown) => toText(text).slice(0, 6) === "Export";
const compare = (a: unknown, b: unknown) => toText(a).toLowerCase().localeCompare(toText(b).toLowerCase());

const RATE_OF_DAY = (db: string) => `LEFT JOIN LATERAL (SELECT round(pl.pl_srate::numeric, 2) AS sale_rate FROM ${db}pricelist pl WHERE pl.prod_id = prodled.prod_id AND pl.pl_wefrom <= prodled.il_date`
  + ` AND (pl.pl_weupto >= prodled.il_date OR pl.pl_weupto IS NULL) AND pl.pl_srate > 0 AND pl.pl_pos <> 'D' ORDER BY pl.pl_wefrom DESC LIMIT 1) sale ON true`;

export async function productionSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const other = call.text[0].trim() === "" ? 75 : num(call.text[0]);
  const exportRate = call.text[1].trim() === "" ? 68 : num(call.text[1]);
  const where = pgFragment(call.where.split("|sys.yearid|").join(call.yearId), plan, loader.session.companySchema);
  const range = ` AND prodled.il_date BETWEEN $1 AND $2`;
  const period = [desktopDate(call.from), desktopDate(call.upto)];
  const finished = `prodled.il_pos = 'A' AND prodled.stock_nat = 'A' AND btrim(prodled.trn_module) = 'PROD-FG' AND upper(btrim(adata.txt_prodtype)) = 'FINISH GOODS'`;
  const bought = `prodled.il_pos = 'A' AND prodled.stock_nat = 'A' AND prodled.book = 13 AND prodled.led_id IS NOT NULL AND upper(btrim(adata.txt_prodtype)) = 'FINISH GOODS'`;

  if (call.reportKey === 216) return dailyPacking(loader, plan, db, where, period, other, exportRate);

  const table = new ResultTable();
  if (call.formating.toUpperCase() === "SUMMARY") {
    for (const column of ["Particulars", "Target", "GR_Production", "OS_GR_Production", "NT_Production", "OS_NT_Production", "Shortfall", "Achieved_%"]) table.addColumn(column);
    for (const column of table.columns.slice(1)) table.setKind(column, "decimal");
    const target = r2(num((await runReportSql(loader, `SELECT coalesce(sum(trg_value::numeric), 0) AS target FROM ${db}target WHERE trg_value::numeric > 0 AND trg_aaocode IS NULL AND extract(month FROM trg_from) >= extract(month FROM $1::date) AND extract(month FROM trg_upto) <= extract(month FROM $2::date)`, period)).rows[0]?.target));
    if (!(target > 0)) return table;
    const from = `FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodled.prod_id`;
    // Gross production at the sale rate of the day.
    const made = (await runReportSql(loader, `SELECT prodmas.prod_desc, prodled.quantity * coalesce(sale.sale_rate, 0) AS amount ${from} ${RATE_OF_DAY(db)} ${where}${range} AND ${finished} AND prodmas.prod_desc IS NOT NULL`, period)).rows;
    // Bought: at the last rate of the product up to Upto.
    const purchased = (await runReportSql(loader, `SELECT prodmas.prod_desc, prodled.quantity * coalesce(last.rate, 0) AS amount ${from}`
      + ` LEFT JOIN (SELECT DISTINCT ON (prod_id) prod_id, round(rate::numeric, 2) AS rate FROM ${db}prod_ledger WHERE il_pos = 'A' AND rate::numeric > 0 AND il_date <= $2 ORDER BY prod_id, il_date DESC) last ON last.prod_id = prodled.prod_id`
      + ` ${where}${range} AND ${bought} AND prodmas.prod_desc IS NOT NULL`, period)).rows;
    const sum = (rows: ResultRow[], exporting: boolean) => r2(rows.filter((row) => isExport(row.prod_desc) === exporting).reduce((total, row) => total + num(row.amount), 0));
    const production = sum(made, false);
    const exportProduction = sum(made, true);
    const osProduction = sum(purchased, false);
    const exportOs = sum(purchased, true);
    if (!(production > 0 || exportProduction > 0 || osProduction > 0 || exportOs > 0)) return table;

    const net = r2(Math.round(production * other / 100));
    const exportNet = exportProduction > 0 ? r2(Math.round(exportProduction * other / 100)) : 0;
    const totalNet = r2(net + exportNet);
    const totalOs = r2(osProduction + exportOs);
    const totalProduction = r2(production + exportProduction);
    let osNet = 0;
    let totalOsNet = 0;
    let final = totalNet;
    if (totalOs > 0) {
      osNet = r2(Math.round(osProduction * exportRate / 100));
      const exportOsNet = exportProduction > 0 ? r2(Math.round(exportOs * other / 100)) : 0;
      totalOsNet = r2(osNet + exportOsNet);
      final = r2(net + exportProduction + osNet + exportOsNet);
    }
    table.rows = [{ Particulars: "PRODUCTION", Target: target, GR_Production: totalProduction, OS_GR_Production: totalOs > 0 ? totalOs : 0, NT_Production: totalNet, OS_NT_Production: totalOsNet, Shortfall: r2(target - final), "Achieved_%": r2(final / target * 100) }];
    return table;
  }

  // Detail.
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "");
  if (levels.some((at) => /aentry/i.test(call.addon[at]))) throw new ReportRefusal("An entry addon group is not available in the web version of this report yet.", "Not ported yet");
  const aliasOf = (at: number) => /as\s+"([^"]+)"/i.exec(call.headingAddon[at])?.[1] ?? `ADDON${at + 1}`;
  const addonSelect = levels.map((at, index) => `, ${call.addon[at].trim()}::text AS a${index}`).join("");
  for (const column of ["Ent_date", "DOC_NO", "JOB_CARD", "Description", "Quantity", "Rate", "GR_Production", "OS_GR_Production", "NT_Production", "OS_NT_Production"]) table.addColumn(column);
  for (const column of ["Quantity", "Rate", "GR_Production", "OS_GR_Production", "NT_Production", "OS_NT_Production"]) table.setKind(column, "decimal");
  for (const at of levels) table.addColumn(aliasOf(at));
  for (const at of levels) table.addColumn(`SMART_SELECTED_ADDON${at + 1}`);

  type Entry = { row: ResultRow; date: Date; order: number };
  const entries: Entry[] = [];
  const addons = (row: ResultRow) => Object.fromEntries([...levels.map((at, index) => [aliasOf(at), toText(row[`a${index}`])]), ...levels.map((at, index) => [`SMART_SELECTED_ADDON${at + 1}`, toText(row[`a${index}`])])]);
  const base = `FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodled.prod_id = prodmas.prod_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key`;
  for (const row of (await runReportSql(loader, `SELECT prodled.il_date, prodled.full_docno, aent.input_job_card AS job_card, prodmas.prod_desc, prodled.quantity, coalesce(sale.sale_rate, 0) AS rate${addonSelect}`
    + ` ${base} LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id ${RATE_OF_DAY(db)} ${where}${range} AND ${finished}`, period)).rows) {
    const quantity = num(row.quantity);
    const rate = num(row.rate);
    const gross = r2(quantity * rate);
    let net = 0;
    if (gross !== 0 && !isExport(row.prod_desc)) net = Math.round(gross * other / 100);
    if (gross !== 0 && isExport(row.prod_desc)) net += Math.round(gross * exportRate / 100);
    entries.push({ date: row.il_date as Date, order: entries.length, row: { Ent_date: dateStyle6(row.il_date as Date), DOC_NO: toText(row.full_docno), JOB_CARD: toText(row.job_card), Description: toText(row.prod_desc), Quantity: quantity, Rate: rate,
      GR_Production: gross, OS_GR_Production: 0, NT_Production: net, OS_NT_Production: 0, ...addons(row) } });
  }
  for (const row of (await runReportSql(loader, `SELECT prodled.il_date, prodled.full_docno, prodmas.prod_desc, prodled.quantity, prodled.rate::numeric AS rate${addonSelect}`
    + ` ${base} ${where}${range} AND prodled.il_pos = 'A' AND prodled.stock_nat = 'A' AND prodled.book = 13 AND prodled.led_id IS NOT NULL AND prodled.prod_id IN`
    + ` (SELECT prod_id FROM ${db}addon_data WHERE key_prodtype IN (SELECT sub_code FROM ${db}addon_sub WHERE sub_pos = 'A' AND upper(btrim(sub_name)) = 'FINISH GOODS'))`, period)).rows) {
    const quantity = num(row.quantity);
    const rate = num(row.rate);
    const osGross = r2(quantity * rate);
    let osNet = 0;
    if (osGross !== 0 && !isExport(row.prod_desc)) osNet = Math.round(osGross * other / 100);
    if (osGross !== 0 && isExport(row.prod_desc)) osNet += Math.round(osGross * exportRate / 100);
    entries.push({ date: row.il_date as Date, order: entries.length, row: { Ent_date: dateStyle6(row.il_date as Date), DOC_NO: toText(row.full_docno), JOB_CARD: "", Description: toText(row.prod_desc), Quantity: quantity, Rate: rate,
      GR_Production: 0, OS_GR_Production: osGross, NT_Production: 0, OS_NT_Production: osNet, ...addons(row) } });
  }
  // The outsourced gross of a line that already has a gross production is not worked out again (the procedure's "where both are 0").
  const order = (a: Entry, b: Entry) => {
    for (const at of levels) { const result = compare(a.row[aliasOf(at)], b.row[aliasOf(at)]); if (result !== 0) return result; }
    return a.date.getTime() - b.date.getTime() || a.order - b.order;
  };
  table.rows = entries.sort(order).map((entry) => entry.row);
  return table;
}

/** 216: the Finish Goods entries of the period against the plan of their job card. */
async function dailyPacking(loader: Loader, plan: ReportPlan, db: string, where: string, period: string[], other: number, exportRate: number): Promise<ResultTable> {
  const { call } = plan;
  const plant22 = db.toLowerCase().includes("rishabh_plastic22");

  // The plan of each job card and product: the quantity, and what was still to be made before From.
  const plans = new Map<string, { lot: number; pending: number }>();
  for (const row of (await runReportSql(loader, `SELECT prodplan.job_card_no, prodplan.prod_id, coalesce(sum(prodplan.plan_qty), 0) AS plan_qty, coalesce(sum(prodplan.plan_qty - coalesce(prodplan.plan_sort, 0)), 0) - coalesce(pq.production_qty, 0) AS plan_pend`
    + ` FROM ${db}production_planing prodplan LEFT JOIN (SELECT prodled.prod_id, aent.input_job_card, sum(CASE WHEN prodled.stock_nat = 'A' AND ((prodled.trn_module = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD')`
    + ` OR (prodled.trn_module = 'PROD-FG' AND proce.ent_approve = 'Yes') OR (prodled.trn_module = 'PROD-SFG') OR (prodled.trn_module = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> ''))`
    + ` AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN (prodled.quantity - prodled.ag_qty) ELSE 0 END) AS production_qty FROM ${db}prod_ledger prodled`
    + ` LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id`
    + ` WHERE prodled.il_pos = 'A' AND coalesce(aent.input_job_card, '') <> '' AND prodled.il_date < $1 GROUP BY prodled.prod_id, aent.input_job_card) pq ON pq.prod_id = prodplan.prod_id AND pq.input_job_card = prodplan.job_card_no`
    + ` WHERE coalesce(prodplan.job_card_no, '') <> '' GROUP BY prodplan.prod_id, prodplan.job_card_no, pq.production_qty`, [period[0]])).rows) {
    plans.set(`${toText(row.job_card_no)}\u0000${num(row.prod_id)}`, { lot: num(row.plan_qty), pending: num(row.plan_pend) });
  }

  // The entries.
  type Entry = { job: string; date: Date; entryNo: string; row: ResultRow; prodId: number; sr: number; total: number | null; gross: number; rate: number };
  const entries: Entry[] = [];
  for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, prodled.il_date, adata.txt_produnit AS unit, btrim(aent.input_job_card) AS job_card, prodled.full_docno, prodmas.prod_desc, prodled.quantity,`
    + ` trunc(prodmas.base_pack::numeric) AS base_pack, coalesce(sale.sale_rate, 0) AS rate, adata.txt_prodgroup AS prod_group, adata.txt_prodcat AS category, proce.stk_remark AS remarks`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodled.prod_id = prodmas.prod_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key`
    + ` LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id ${RATE_OF_DAY(db)}`
    + ` ${where} AND prodled.il_date BETWEEN $1 AND $2 AND prodled.il_pos = 'A' AND proce.il_pos = 'A' AND prodled.stock_nat = 'A' AND btrim(prodled.trn_module) = 'PROD-FG' AND upper(btrim(adata.txt_prodtype)) = 'FINISH GOODS'`, period)).rows) {
    const quantity = num(row.quantity);
    const pack = row.base_pack === null ? 0 : num(row.base_pack);
    const cartons = pack > 1 ? Math.trunc(Math.trunc(quantity) / pack) : 0;
    const loose = pack > 1 ? quantity - pack * cartons : 0;
    const total = r2(cartons * pack + loose);
    const rate = num(row.rate);
    const name = toText(row.prod_desc);
    const netRate = rate !== 0 ? r2(rate * (isExport(name) ? exportRate : other) / 100) : 0;
    const job = toText(row.job_card);
    const planned = plans.get(`${job}\u0000${num(row.prod_id)}`);
    entries.push({
      job, date: row.il_date as Date, entryNo: toText(row.full_docno), prodId: num(row.prod_id), sr: 0, total, gross: Math.round(total * rate), rate,
      row: { Date: dateStyle6(row.il_date as Date), PACKING_UNIT: toText(row.unit), JOB_CARD: job, FG_ENTRY_NO: toText(row.full_docno), FG_NAME: name, LOT_QTY: planned ? planned.lot : 0, PLAN_QTY: planned ? planned.pending : 0,
        Entry_Qty: r2(quantity), NO_OF_CTN: cartons, STD_PACK: pack, LOOSE_QTY: r2(loose), TOTAL_PACKING: total, Balance_Qty: 0, Complete_Perc: "", Gross_Value: Math.round(total * rate), Net_Value: Math.round(total * netRate),
        Prod_Group: toText(row.prod_group), Product_Category: toText(row.category), Remarks: toText(row.remarks) },
    });
  }

  // The numbering within each job card (by date, then entry number), and the running balance of the lot.
  const byJob = new Map<string, Entry[]>();
  for (const entry of entries) { const list = byJob.get(entry.job) ?? []; list.push(entry); byJob.set(entry.job, list); }
  for (const [job, list] of byJob) {
    if (plant22 && job === "") continue;
    list.sort((a, b) => a.date.getTime() - b.date.getTime() || a.entryNo.localeCompare(b.entryNo));
    list.forEach((entry, index) => { entry.sr = index + 1; });
  }
  const jobs = [...byJob.keys()].sort();
  let pendingPlan = 0;
  let previous = "";
  for (const job of jobs) {
    if (plant22 && job === "") continue;
    const list = byJob.get(job)!;
    for (let index = 0; index < list.length; index += 1) {
      const entry = list[index];
      if (plant22 && !(num(entry.row.PLAN_QTY) > 0 && num(entry.row.LOT_QTY) > 0)) continue;
      if (previous !== job && entry.sr === 1) pendingPlan = num(entry.row.PLAN_QTY) === 0 ? num(entry.row.LOT_QTY) : num(entry.row.PLAN_QTY);
      pendingPlan = r2(pendingPlan - (entry.total ?? 0));
      if (job !== "") {
        entry.row.Balance_Qty = pendingPlan;
        const following = list[index + 1];
        if (following) following.row.PLAN_QTY = pendingPlan;
      }
      previous = job;
    }
  }
  for (const entry of entries) {
    const lot = num(entry.row.LOT_QTY);
    const balance = num(entry.row.Balance_Qty);
    if (plant22 ? balance === 0 || lot === 0 || entry.job === "" : lot === 0) { entry.row.Complete_Perc = plant22 ? "" : "0.00 %"; continue; }
    entry.row.Complete_Perc = `${r2((lot - balance) / lot * 100).toFixed(2)} %`;
  }

  const table = new ResultTable();
  for (const column of ["Date", "PACKING_UNIT", "JOB_CARD", "FG_ENTRY_NO", "FG_NAME", "LOT_QTY", "PLAN_QTY", "Entry_Qty", "NO_OF_CTN", "STD_PACK", "LOOSE_QTY", "TOTAL_PACKING", "Balance_Qty", "Complete_Perc", "Gross_Value", "Net_Value", "Prod_Group", "Product_Category", "Remarks"]) table.addColumn(column);
  for (const column of ["LOT_QTY", "PLAN_QTY", "Entry_Qty", "NO_OF_CTN", "LOOSE_QTY", "TOTAL_PACKING", "Balance_Qty", "Gross_Value", "Net_Value"]) table.setKind(column, "decimal");
  table.setKind("STD_PACK", "int");
  table.rows = entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.date.getTime() - b.entry.date.getTime() || a.entry.entryNo.localeCompare(b.entry.entryNo) || a.index - b.index).map(({ entry }) => entry.row);
  return table;
}
