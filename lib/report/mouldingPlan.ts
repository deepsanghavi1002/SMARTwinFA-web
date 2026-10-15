import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 203: MOULDING PRODUCTION PLAN (REPORT_RPI_MOULDING_PRODUCTION_PLAN, SP_FRT_RPT_RPI_MOULDING_PRODUCTION_PLAN; SPECIAL > Extra Report (RP) > Moulding Production Plan):
 * the production plans (type PP, packing date in the period, the ticked products) with, for each, the components of the plan's BOM (the semi-finished lines, MFG-BOM):
 * mould code, machine, standard weight and pieces an hour; Planing_Qty (plan x BOM quantity), Production (what the job card has produced of the component: PROD-SFG, or
 * PROD-MULTI with a close remark), Pending_Plan_Qty, HOUR_REQ (pending / (pieces an hour x 0.85)) and TOTAL_WT (pending x standard weight / 1000). A machine's start time
 * (its Addon master margin, as hh.mm) lays the lines of the machine one after the other from today: START_DATE / START_TIME and END_DATE / END_TIME.
 * The procedure's rules are kept: the figures are whole numbers (the temp table columns are int); a component the job card has no production for, or without a
 * standard weight / pieces an hour / BOM item, makes no line (the procedure's dynamic text was then empty); only the lines with pieces an hour are shown. The cursors
 * are done in memory; the BOM, the production and the machine margins are each read once.
 */
type Line = {
  index: number; packing: string; machine: string; machineKey: number; job: string; mould: string; description: string; item: string;
  stdWt: number; pcsHour: number; planing: number; production: number; pending: number; hourReq: number; totalWt: number;
  startDate: string; startTime: string; endDate: string; endTime: string;
};

export async function mouldingPlan(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const products = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? call.selectKey[4].trim() : "";
  const lower = (text: string) => text.trim().toLowerCase();
  const two = (value: number) => String(value).padStart(2, "0");
  const dmy = (date: Date) => `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
  const trunc = (value: number) => Math.trunc(value + Math.sign(value) * 1e-9);
  const round0 = (value: number) => Math.round(value + Math.sign(value) * 1e-9);

  const plans = (await runReportSql(loader, `SELECT prodplan.prod_id, prodmas.prod_desc, prodplan.packing_date, prodplan.plan_qty::numeric AS plan_qty, coalesce(prodplan.job_card_no, '') AS job_card_no`
    + ` FROM ${db}production_planing prodplan LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodplan.prod_id WHERE prodplan.packing_date BETWEEN $1::date AND $2::date AND prodplan.ent_type = 'PP'`
    + `${products !== "" ? ` AND prodplan.prod_id IN ${products}` : ""} ORDER BY prodplan.ctid`, [desktopDate(call.from), desktopDate(call.upto)])).rows;
  if (plans.length === 0) return emptyTable();

  // The BOM of a product (its last BOM entry) and the BOM's components, with the product's machine / mould addon.
  const bomOf = new Map<number, string>();
  for (const row of (await runReportSql(loader, `SELECT prod_id, full_docno FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' AND stock_nat = 'A' ORDER BY il_key`)).rows) bomOf.set(num(row.prod_id), toText(row.full_docno));
  const parts = new Map<string, { key: number; desc: string | null; qty: number | null; machineKey: number; machine: string; mould: string; pcsHour: string | null; stdWt: number | null }[]>();
  for (const row of (await runReportSql(loader, `SELECT prodled.full_docno, product.prod_key, product.prod_desc, prodled.quantity::numeric AS qty, coalesce(adata.key_produnit, 0) AS machine_key, coalesce(adata.txt_produnit, '') AS machine_name,`
    + ` coalesce(adata.input_mouldcode, '') AS mould_code, adata.input_perhrstdpc AS pcs_hour, product.base_weight::numeric AS std_wt FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master product ON product.prod_key = prodled.prod_id`
    + ` LEFT JOIN ${db}addon_data adata ON adata.prod_id = product.prod_key WHERE btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' ORDER BY prodled.il_key`)).rows) {
    const list = parts.get(lower(toText(row.full_docno))) ?? [];
    list.push({ key: num(row.prod_key), desc: row.prod_desc === null ? null : toText(row.prod_desc), qty: row.qty === null ? null : num(row.qty), machineKey: num(row.machine_key), machine: toText(row.machine_name), mould: toText(row.mould_code),
      pcsHour: row.pcs_hour === null ? null : toText(row.pcs_hour), stdWt: row.std_wt === null ? null : num(row.std_wt) });
    parts.set(lower(toText(row.full_docno)), list);
  }
  const made = new Map<string, number>();
  for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, lower(btrim(aent.input_job_card)) AS job, sum(prodled.quantity::numeric) AS qty FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id`
    + ` WHERE (btrim(prodled.trn_module) = 'PROD-SFG' OR (btrim(prodled.trn_module) = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.stock_nat = 'A' AND prodled.il_pos = 'A' AND aent.input_job_card IS NOT NULL GROUP BY 1, 2`)).rows) {
    if (row.qty !== null) made.set(`${num(row.prod_id)}\u0000${toText(row.job)}`, num(row.qty));
  }

  const lines: Line[] = [];
  for (const row of plans) {
    const bom = bomOf.get(num(row.prod_id)) ?? "";
    if (bom === "" || row.prod_desc === null || row.packing_date === null) continue;
    for (const part of parts.get(lower(bom)) ?? []) {
      const sum = made.get(`${part.key}\u0000${lower(toText(row.job_card_no))}`);
      if (sum === undefined || part.desc === null || part.pcsHour === null || part.stdWt === null || part.qty === null) continue;
      const total = Math.round(num(row.plan_qty) * part.qty * 10000) / 10000;
      const consumed = round0(sum);
      const pcs = Number.parseFloat(part.pcsHour);
      const packing = row.packing_date as Date;
      lines.push({ index: lines.length, packing: dateStyle6(packing), machine: part.machine, machineKey: part.machineKey, job: toText(row.job_card_no), mould: part.mould, description: toText(row.prod_desc), item: part.desc,
        stdWt: trunc(part.stdWt), pcsHour: Number.isFinite(pcs) ? trunc(pcs) : 0, planing: trunc(total), production: consumed, pending: trunc(round0(total - consumed)), hourReq: 0, totalWt: 0,
        startDate: dmy(packing), startTime: "", endDate: dmy(packing), endTime: "" });
    }
  }
  for (const line of lines) {
    if (line.pcsHour > 0 && line.pending > 0) line.hourReq = trunc(line.pending / (line.pcsHour * 0.85));
    if (line.stdWt > 0 && line.pending > 0) line.totalWt = trunc((line.pending * line.stdWt) / 1000);
  }

  // The machines' start times (the Addon master margin).
  const keys = [...new Set(lines.filter((line) => line.machineKey > 0).map((line) => line.machineKey))];
  const margin = new Map<number, number>();
  if (keys.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT sub_code, coalesce(profit_margin::numeric, 0) AS margin FROM ${db}addon_sub WHERE sub_code = ANY($1::int[]) ORDER BY ctid`, [keys])).rows) if (!margin.has(num(row.sub_code))) margin.set(num(row.sub_code), num(row.margin));
  }
  for (const line of lines) if (margin.has(line.machineKey)) line.startTime = margin.get(line.machineKey)!.toFixed(2);

  const queue = lines.filter((line) => line.startTime !== "" && line.startTime !== "0.00").map((line) => ({ line, start: Number(line.startTime) }))
    .sort((a, b) => lower(a.line.machine).localeCompare(lower(b.line.machine)) || lower(a.line.mould).localeCompare(lower(b.line.mould)) || a.line.index - b.line.index);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let findMachine = "";
  let endDate = "";
  let endTime = "";
  const stamp = (base: Date, hours: number, minutes: number) => {
    const at = new Date(base.getTime());
    at.setHours(at.getHours() + hours);
    at.setMinutes(at.getMinutes() + minutes);
    return { date: dmy(at), time: `${two(at.getHours())}:${two(at.getMinutes())}` };
  };
  for (const { line, start } of queue) {
    if (start === 0) continue;
    let startDate: string;
    let startTime: string;
    let base: Date;
    let hour: number;
    let minute: number;
    if (lower(findMachine) !== lower(line.machine)) {
      startDate = dmy(today);
      startTime = start.toFixed(2).replace(".", ":");
      hour = Math.trunc(start);
      minute = Math.trunc(Math.round((start - hour) * 10000) / 100);
      base = midnight;
    } else {
      startDate = endDate;
      startTime = endTime;
      hour = Number.parseInt(endTime.slice(0, 2), 10);
      minute = Number.parseInt(endTime.slice(-2), 10);
      const [d, m, y] = endDate.split("/").map(Number);
      base = new Date(y, m - 1, d);
    }
    const end = stamp(base, hour + line.hourReq, minute);
    endDate = end.date;
    endTime = end.time;
    for (const other of lines) {
      if (lower(other.job) === lower(line.job) && lower(other.machine) === lower(line.machine) && lower(other.mould) === lower(line.mould) && lower(other.description) === lower(line.description)) {
        other.startDate = startDate; other.startTime = startTime; other.endDate = endDate; other.endTime = endTime;
      }
    }
    findMachine = line.machine;
  }

  const table = emptyTable();
  table.rows = lines.filter((line) => line.pcsHour > 0)
    .sort((a, b) => lower(a.machine).localeCompare(lower(b.machine)) || lower(a.mould).localeCompare(lower(b.mould)) || a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.index - b.index)
    .map((line) => ({ PACKING_DATE: line.packing, MACHINE_NO: line.machine, Job_Card_No: line.job, MOULD_CODE: line.mould, Description: line.description, PMP_ITEM: line.item, STD_WT: line.stdWt, PCS_HOUR: line.pcsHour,
      Planing_Qty: line.planing, Production: line.production, Pending_Plan_Qty: line.pending, HOUR_REQ: line.hourReq, TOTAL_WT: line.totalWt, START_DATE: line.startDate, START_TIME: line.startTime, END_DATE: line.endDate, END_TIME: line.endTime }));
  return table;
}

function emptyTable(): ResultTable {
  const table = new ResultTable();
  for (const column of ["PACKING_DATE", "MACHINE_NO", "Job_Card_No", "MOULD_CODE", "Description", "PMP_ITEM", "STD_WT", "PCS_HOUR", "Planing_Qty", "Production", "Pending_Plan_Qty", "HOUR_REQ", "TOTAL_WT", "START_DATE", "START_TIME", "END_DATE", "END_TIME"]) table.addColumn(column);
  for (const column of ["STD_WT", "PCS_HOUR", "Planing_Qty", "Production", "Pending_Plan_Qty", "HOUR_REQ", "TOTAL_WT"]) table.setKind(column, "int");
  return table;
}
