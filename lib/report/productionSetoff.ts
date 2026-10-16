import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 175 PRODUCTION PLANING SETOFF (REPORT_PRODUCTION_PLANING_SETOF) and 177 PRODUCTION PMP ASSEMBLE (REPORT_PRODUCTION_PMP_ASSEMBLE):
 * SP_FRT_RPT_RPI_PRODUCTION_PLANING_SETOFF (SPECIAL > Extra Report (RP)). The plans (type PP with a job card and a quantity) of the ticked products /
 * addons against what was produced on their job cards:
 *  - 175, first combo 1 (FG): the approved finished good entries (PROD-FG) of the job card and product; combo 2 (SFG): the semi-finished entries
 *    (PROD-SFG, or PROD-MULTI with a close remark) of the job card, each with its SFG_PRODUCT. A plan line and a production line each; the plan's dates by
 *    entry date (or packing date; with "Production Date Wise Require" the production lines lead, in the period, and the plan dates are not tested).
 *    BALANCE is what is left of the plan (quantity less short, FG; or the quantity the BOM asks for the SFG, SFG) after the entries, on the first line of
 *    the product and job card; the other lines show 0. FG adds FG_Rate, FG_Value and Net_Value (75 %, 68 % for Export). Summary: a line for each plan with
 *    a balance (FG: with the balance's value and net value).
 *  - 177: the same plans as FG, then for each plan not fully produced the components of its BOM that are moulded / plated parts (with a standard
 *    pieces-an-hour) and chemicals: BOM_QTY, CONSUME_QTY (BOM quantity x what is left to make), the standard pieces an hour and the hours; under a moulded /
 *    plated part the semi-finished components of its own BOM ("-- <item>", CONSUME_KGS).
 * The procedure's quirks are kept: the SFG plan quantity is changed only for a second product of the same job card, the plan's production quantity in 177
 * is that of its first line, and a component with no BOM takes the semi-finished BOM of the one before it. "Pending Plan Transfer To New Year" (it writes the
 * new year's database) is not done: a report does not write.
 */
type Plan = { key: number; desc: string; entry: Date | null; pack: Date | null; job: string; phn: string; unit: string; cls: string; group: string; qty: number; short: number; rate: number; remark: string };
type Prod = { key: number; desc: string; unit: string; cls: string; group: string; date: Date; no: string; qty: number; job: string };
type Row = { sr: number; plan: Plan | null; prod: Prod | null; qty: number | null; short: number | null; fgValue: number | null; net: number | null; balance: number; rate: number | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const style6 = (date: Date | null) => (date === null ? null : `${String(date.getDate()).padStart(2, "0")}-${MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`);
const round = (value: number, places: number) => { const factor = 10 ** places; return Math.round((value + Math.sign(value) * 1e-9) * factor) / factor; };
const isExport = (text: string | null | undefined) => (text ?? "").slice(0, 6) === "Export";
const compareText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").toLowerCase().localeCompare((b ?? "").toLowerCase());
const day = (date: Date | null) => (date === null ? -Infinity : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
const ymd = (text: string | null) => { const match = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(text ?? ""); return match ? `20${match[3]}${String(MONTHS.findIndex((name) => name.toLowerCase() === match[2].toLowerCase()) + 1).padStart(2, "0")}${match[1]}` : "19000101"; };

/** The addon text of the plan's product date (input_phn_date: dd/mon/yyyy or mm/dd/yyyy) as dd/mm/yyyy. */
export function phnDate(text: string): string {
  const named = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/.exec(text.trim());
  if (named) { const month = MONTHS.findIndex((name) => name.toLowerCase() === named[2].toLowerCase()) + 1; return month > 0 ? `${named[1].padStart(2, "0")}/${String(month).padStart(2, "0")}/${named[3]}` : ""; }
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return numeric ? `${numeric[2].padStart(2, "0")}/${numeric[1].padStart(2, "0")}/${numeric[3]}` : "";
}
const phnShort = (text: string) => { const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text); return match ? `${match[1]}-${MONTHS[Number(match[2]) - 1]}-${match[3].slice(-2)}` : text; };

export async function productionSetoff(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const rk = call.reportKey;
  const combo = rk === 175 ? Math.trunc(call.fcValue) : 1;
  const sfg = rk === 175 && combo !== 1;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const productionDate = check("CHK_PRODUCTIONDATE");
  const packDate = check("CHK_PACKPLANDATE");
  const params = [desktopDate(call.from), desktopDate(call.upto)];
  const ids = (keys: string) => (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys.trim()) ? keys.trim() : "");
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "" && ids(call.selectKey[at]) !== "");
  if (levels.some((at) => /aentry/i.test(call.addon[at]))) throw new ReportRefusal("An entry addon group is not available in the web version of this report yet.", "Not ported yet");
  const addonKeys = levels.map((at) => ` AND ${call.addon[at].trim().replace(/^(adata)\.txt_/i, "$1.key_")} IN ${ids(call.selectKey[at])}`).join("");
  const products = (column: string) => (ids(call.selectKey[4]) !== "" ? ` AND ${column} IN ${ids(call.selectKey[4])}` : "");

  // The plan lines.
  const planDate = rk === 175 ? (packDate ? ` AND prodplan.packing_date BETWEEN $1::date AND $2::date` : productionDate ? "" : ` AND prodplan.ent_date BETWEEN $1::date AND $2::date`) : ` AND prodplan.ent_date BETWEEN $1::date AND $2::date`;
  const planRows = (await runReportSql(loader, `SELECT prodmas.prod_key, prodmas.prod_desc, prodplan.ent_date, prodplan.packing_date, coalesce(prodplan.job_card_no, '') AS job, adata.input_phn_date, adata.txt_produnit, adata.txt_prodclass, adata.txt_prodgroup,`
    + ` prodplan.plan_qty::numeric AS plan_qty, coalesce(prodplan.plan_sort, 0) AS plan_sort, coalesce(prodplan.ent_remark, '') AS remark`
    + ` FROM ${db}production_planing prodplan LEFT JOIN ${db}product_master prodmas ON prodplan.prod_id = prodmas.prod_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key`
    + ` WHERE prodplan.ent_type = 'PP' AND prodplan.plan_qty > 0 AND coalesce(prodplan.job_card_no, '') <> ''${addonKeys}${planDate}${products("prodplan.prod_id")} ORDER BY prodplan.prod_plan_key`,
  planDate === "" ? [] : params)).rows;
  const rateRows = new Map<number, { from: number; upto: number | null; rate: number }[]>();
  if (planRows.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT prod_id, pl_wefrom, pl_weupto, pl_srate::numeric AS rate FROM ${db}pricelist WHERE pl_pos <> 'D' AND pl_srate::numeric > 0 AND pl_wefrom IS NOT NULL AND prod_id = ANY($1::int[]) ORDER BY prod_id, pl_wefrom DESC`, [[...new Set(planRows.map((row) => num(row.prod_key)))]])).rows) {
      const list = rateRows.get(num(row.prod_id)) ?? [];
      list.push({ from: day(row.pl_wefrom as Date), upto: row.pl_weupto === null ? null : day(row.pl_weupto as Date), rate: num(row.rate) });
      rateRows.set(num(row.prod_id), list);
    }
  }
  const plans: Plan[] = planRows.map((row) => {
    const entry = row.ent_date as Date | null;
    const found = (rateRows.get(num(row.prod_key)) ?? []).find((price) => entry !== null && price.from <= day(entry) && (price.upto === null || price.upto >= day(entry)));
    return { key: num(row.prod_key), desc: toText(row.prod_desc), entry, pack: row.packing_date as Date | null, job: toText(row.job).trim(), phn: phnDate(toText(row.input_phn_date)), unit: toText(row.txt_produnit), cls: toText(row.txt_prodclass), group: toText(row.txt_prodgroup),
      qty: num(row.plan_qty), short: num(row.plan_sort), rate: round(found?.rate ?? 0, 2), remark: toText(row.remark) };
  });

  // The production lines.
  const moduleSql = sfg
    ? `prodled.il_pos = 'A' AND (btrim(prodled.trn_module) = 'PROD-SFG' OR (btrim(prodled.trn_module) = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.stock_nat = 'A'${productionDate && rk === 175 ? " AND prodled.il_date BETWEEN $1::date AND $2::date" : ""}`
    : `prodled.il_pos = 'A' AND btrim(prodled.trn_module) = 'PROD-FG' AND prodled.stock_nat = 'A' AND proce.ent_approve = 'Yes'${products("prodled.prod_id")}${addonKeys}${productionDate && rk === 175 ? " AND prodled.il_date BETWEEN $1::date AND $2::date" : ""}`;
  const prods: Prod[] = (await runReportSql(loader, `SELECT prodmas.prod_key, prodmas.prod_desc, adata.txt_produnit, adata.txt_prodclass, adata.txt_prodgroup, prodled.il_date, prodled.full_docno, prodled.quantity::numeric AS quantity, aent.input_job_card AS job`
    + ` FROM ${db}product_master prodmas LEFT JOIN ${db}prod_ledger prodled ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id`
    + ` LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodled.prod_id LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id WHERE ${moduleSql} AND prodmas.prod_pos = 'A'`,
  productionDate && rk === 175 ? params : [])).rows.map((row) => ({ key: num(row.prod_key), desc: toText(row.prod_desc), unit: toText(row.txt_produnit), cls: toText(row.txt_prodclass), group: toText(row.txt_prodgroup), date: row.il_date as Date, no: toText(row.full_docno), qty: num(row.quantity), job: toText(row.job).trim() }));
  const prodsByJob = new Map<string, Prod[]>();
  for (const prod of prods) { const list = prodsByJob.get(prod.job); if (list) list.push(prod); else prodsByJob.set(prod.job, [prod]); }
  const plansByJob = new Map<string, Plan[]>();
  for (const item of plans) { const list = plansByJob.get(item.job); if (list) list.push(item); else plansByJob.set(item.job, [item]); }

  // The two sides joined as the procedure's join says.
  const matches = (item: Plan, prod: Prod) => item.job === prod.job && (sfg || item.key === prod.key);
  const rows: Row[] = [];
  const make = (item: Plan | null, prod: Prod | null): Row => ({ sr: item ? item.key : 0, plan: item, prod, qty: item ? item.qty : null, short: item ? item.short : null, fgValue: item ? 0 : null, net: item ? 0 : null, balance: 0, rate: item ? item.rate : null });
  if (rk === 175 && productionDate) {
    for (const prod of prods) { const found = (plansByJob.get(prod.job) ?? []).filter((item) => matches(item, prod)); if (found.length === 0) rows.push(make(null, prod)); else for (const item of found) rows.push(make(item, prod)); }
  } else {
    for (const item of plans) { const found = (prodsByJob.get(item.job) ?? []).filter((prod) => matches(item, prod)); if (found.length === 0) rows.push(make(item, null)); else for (const prod of found) rows.push(make(item, prod)); }
  }
  const nullFirst = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
  const order = (a: Row, b: Row) => compareText(a.plan?.job ?? null, b.plan?.job ?? null) || nullFirst(day(a.plan?.entry ?? null), day(b.plan?.entry ?? null)) || (sfg && !productionDate ? 0 : nullFirst(day(a.prod?.date ?? null), day(b.prod?.date ?? null)))
    || compareText(a.plan?.desc ?? null, b.plan?.desc ?? null) || (sfg ? compareText(a.prod?.desc ?? null, b.prod?.desc ?? null) : 0);
  const sorted = rows.map((row, index) => ({ row, index })).sort((a, b) => order(a.row, b.row) || a.index - b.index).map(({ row }) => row);

  // The values of a finished good plan line, then the numbering of the lines of a plan.
  if (!sfg) {
    for (const row of sorted) {
      row.sr = 0;
      if (row.qty !== null && row.rate !== null) {
        row.fgValue = round(row.qty * row.rate, 2);
        if (row.plan && !isExport(row.plan.desc)) row.net = round(row.qty * row.rate * 75 / 100, 2);
        else if (row.plan) row.net = round(row.qty * row.rate * 68 / 100, 2);
      }
    }
  }
  const seen = new Map<string, number>();
  for (const row of sorted) {
    const key = [style6(row.plan?.entry ?? null), row.plan?.key ?? null, row.qty, row.plan?.job ?? null, sfg ? row.prod?.desc ?? null : ""].join("\u0000");
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    row.sr = next;
  }

  const table = new ResultTable();
  if (rk === 177) return pmpAssemble(loader, plan, table, sorted, db);

  // The balance of each plan on its first line: the plan less the short and what was produced, or for an SFG what its BOM asks for.
  const bomDocs = new Map<number, string>();
  const lessBom = new Map<string, number>();
  if (sfg) {
    for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, full_docno FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' AND stock_nat = 'A' ORDER BY prod_id, il_key DESC`)).rows) bomDocs.set(num(row.prod_id), toText(row.full_docno));
    for (const row of (await runReportSql(loader, `SELECT prodled.full_docno, prodmas.prod_desc, prodled.quantity::numeric AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
      + ` WHERE btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' AND prodmas.prod_pos = 'A' AND prodmas.inventory = 'Y' ORDER BY prodled.il_key`)).rows) lessBom.set(`${toText(row.full_docno)}\u0000${toText(row.prod_desc)}`, num(row.quantity));
  }
  const cursor = sorted.map((row, index) => ({ row, index })).sort((a, b) => compareText(a.row.plan?.job ?? null, b.row.plan?.job ?? null)
    || (sfg ? compareText(a.row.prod?.desc ?? null, b.row.prod?.desc ?? null) : nullFirst(a.row.plan?.key ?? -1, b.row.plan?.key ?? -1) || compareText(style6(a.row.plan?.entry ?? null), style6(b.row.plan?.entry ?? null)))
    || a.row.sr - b.row.sr || a.index - b.index).map(({ row }) => row);
  const keyOf = (row: Row) => (sfg ? row.prod?.desc ?? null : row.plan?.desc ?? null);
  const setBalance = (key: string | null, job: string, value: number) => { for (const row of sorted) if (row.sr === 1 && (sfg ? row.prod?.desc ?? null : row.plan?.desc ?? null) === key && (row.plan?.job ?? "") === job) row.balance = value; };
  let balance = 0;
  let jobQty = 0;
  let findKey: string | null = "";
  let findJob = "";
  for (const row of cursor) {
    const job = row.plan?.job ?? "";
    const key = keyOf(row);
    if ((findKey !== key && findKey !== "") || findJob !== job) {
      const total = round(jobQty - balance, 4);
      if (total !== 0) setBalance(findKey, findJob, total);
      balance = 0;
    }
    if (row.sr === 1) {
      const planQty = row.qty ?? 0;
      const short = row.short ?? 0;
      jobQty = 0;
      if (!sfg) jobQty = planQty - short;
      else {
        const bom = bomDocs.get(row.plan?.key ?? -1) ?? "";
        const bomQty = row.prod ? lessBom.get(`${bom}\u0000${row.prod.desc}`) ?? 0 : 0;
        if (bomQty !== 0) {
          jobQty = planQty * bomQty - short;
          for (const target of sorted) if (target.sr === 1 && target.prod?.desc === row.prod?.desc && (target.plan?.job ?? "") === findJob) target.qty = round(planQty * bomQty, 4);
        } else jobQty = planQty - short;
      }
    }
    balance = round(balance + (row.prod?.qty ?? 0), 4);
    findJob = job;
    findKey = key;
  }
  const total = round(jobQty - balance, 4);
  if (total !== 0) setBalance(findKey, findJob, total);
  for (const row of sorted) if (row.sr !== 1) { row.qty = 0; if (!sfg) { row.short = 0; row.fgValue = 0; row.net = 0; row.rate = 0; } }
  if (!sfg) for (const row of sorted) if (toText(row.prod?.no) === "") row.balance = round((row.qty ?? 0) - (row.short ?? 0), 4);

  const full = (row: Row): ResultRow => (sfg
    ? { sr_no: row.sr, SORTING_FIELD: row.plan?.desc ?? null, Plan_Entry_Date: style6(row.plan?.entry ?? null), Plan_Pack_Date: style6(row.plan?.pack ?? null), PHN_DATE: row.plan ? row.plan.phn : null, Job_Card_No: row.plan?.job ?? null, Description: row.plan?.desc ?? null,
      Planing_Qty: row.qty, Planing_Short: row.short, Production_Date: style6(row.prod?.date ?? null), PRODUCTION_NO: row.prod?.no ?? null, SFG_PRODUCT: row.prod?.desc ?? null, Production_Qty: row.prod?.qty ?? null, BALANCE: row.balance }
    : { sr_no: row.sr, SORTING_FIELD: row.plan?.desc ?? null, Plan_Entry_Date: style6(row.plan?.entry ?? null), Plan_Pack_Date: style6(row.plan?.pack ?? null), PHN_DATE: row.plan ? row.plan.phn : null, Job_Card_No: row.plan?.job ?? null, Description: row.plan?.desc ?? null,
      Production_Unit: row.plan?.unit ?? null, Product_Class: row.plan?.cls ?? null, Product_Group: row.plan?.group ?? null, Planing_Qty: row.qty, Planing_Short: row.short, FG_Rate: row.rate, FG_Value: row.fgValue, Net_Value: row.net,
      Production_Date: style6(row.prod?.date ?? null), PRODUCTION_NO: row.prod?.no ?? null, Production_Qty: row.prod?.qty ?? null, Remark: row.plan?.remark ?? null, BALANCE: row.balance });
  const numbers = ["Planing_Qty", "Planing_Short", "FG_Rate", "FG_Value", "Net_Value", "Production_Qty", "BALANCE", "VALUE", "NET_VALUE"];
  const open = (columns: string[]) => { for (const column of columns) { table.addColumn(column); if (numbers.includes(column)) table.setKind(column, "decimal"); } };

  if (call.formating.toUpperCase() === "SUMMARY") {
    const groups = new Map<string, ResultRow>();
    for (const row of sorted) {
      if (!(row.balance > 0)) continue;
      const base = sfg
        ? { JOB_CARD_NO: row.plan?.job ?? null, Description: row.plan?.desc ?? null, Production_Unit: row.plan?.unit ?? null, Product_Class: row.plan?.cls ?? null, Product_Group: row.plan?.group ?? null, Plan_Pack_Date: style6(row.plan?.pack ?? null), PHN_DATE: row.plan ? row.plan.phn : null, Planing_Qty: row.qty }
        : { JOB_CARD_NO: row.plan?.job ?? null, Description: row.plan?.desc ?? null, Production_Unit: row.plan?.unit ?? null, Product_Class: row.plan?.cls ?? null, Product_Group: row.plan?.group ?? null, Plan_Entry_Date: style6(row.plan?.entry ?? null), Plan_Pack_Date: style6(row.plan?.pack ?? null),
          PHN_DATE: row.plan ? row.plan.phn : null, Planing_Qty: row.qty, FG_Rate: row.rate, Remark: row.plan?.remark ?? null };
      const key = JSON.stringify(base);
      const found = groups.get(key);
      if (found) found.BALANCE = round(num(found.BALANCE) + row.balance, 4);
      else groups.set(key, { ...base, BALANCE: row.balance });
    }
    const out = [...groups.values()].map((row): ResultRow => {
      const shortDate = row.PHN_DATE === null || row.PHN_DATE === undefined ? null : phnShort(toText(row.PHN_DATE));
      if (sfg) return { JOB_CARD_NO: row.JOB_CARD_NO, Description: row.Description, Production_Unit: row.Production_Unit, Product_Class: row.Product_Class, Product_Group: row.Product_Group, Plan_Pack_Date: row.Plan_Pack_Date, PHN_DATE: shortDate, Planing_Qty: row.Planing_Qty, BALANCE: row.BALANCE };
      const balanceValue = num(row.BALANCE);
      const value = round(balanceValue * num(row.FG_Rate), 2);
      const net = round(balanceValue * num(row.FG_Rate) * (isExport(toText(row.Description)) ? 68 : 75) / 100, 2);
      return { JOB_CARD_NO: row.JOB_CARD_NO, Description: row.Description, Production_Unit: row.Production_Unit, Product_Class: row.Product_Class, Product_Group: row.Product_Group, Plan_Entry_Date: row.Plan_Entry_Date, Plan_Pack_Date: row.Plan_Pack_Date, PHN_DATE: shortDate,
        Planing_Qty: row.Planing_Qty, BALANCE: row.BALANCE, FG_Rate: row.FG_Rate, VALUE: value, NET_VALUE: net, Remark: row.Remark };
    });
    open(sfg ? ["JOB_CARD_NO", "Description", "Production_Unit", "Product_Class", "Product_Group", "Plan_Pack_Date", "PHN_DATE", "Planing_Qty", "BALANCE"]
      : ["JOB_CARD_NO", "Description", "Production_Unit", "Product_Class", "Product_Group", "Plan_Entry_Date", "Plan_Pack_Date", "PHN_DATE", "Planing_Qty", "BALANCE", "FG_Rate", "VALUE", "NET_VALUE", "Remark"]);
    const packTime = (text: unknown) => { const match = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(toText(text)); return match ? ymd(toText(text)) : ""; };
    table.rows = out.map((row, index) => ({ row, index })).sort((a, b) => packTime(a.row.Plan_Pack_Date).localeCompare(packTime(b.row.Plan_Pack_Date)) || a.index - b.index).map(({ row }) => row);
    return table;
  }
  open(sfg ? ["sr_no", "SORTING_FIELD", "Plan_Entry_Date", "Plan_Pack_Date", "PHN_DATE", "Job_Card_No", "Description", "Planing_Qty", "Planing_Short", "Production_Date", "PRODUCTION_NO", "SFG_PRODUCT", "Production_Qty", "BALANCE"]
    : ["sr_no", "SORTING_FIELD", "Plan_Entry_Date", "Plan_Pack_Date", "PHN_DATE", "Job_Card_No", "Description", "Production_Unit", "Product_Class", "Product_Group", "Planing_Qty", "Planing_Short", "FG_Rate", "FG_Value", "Net_Value", "Production_Date", "PRODUCTION_NO", "Production_Qty", "Remark", "BALANCE"]);
  table.setKind("sr_no", "int");
  table.rows = sorted.map(full);
  return table;
}

/** 177: the plans' components that are moulded / plated parts and chemicals, hours and what the parts take. */
async function pmpAssemble(loader: Loader, plan: ReportPlan, table: ResultTable, sorted: Row[], db: string): Promise<ResultTable> {
  void plan;
  // The lines of a plan after the first show nothing of the plan; the plans group (on their production quantity of the first line only, as the procedure does).
  const blank = (row: Row) => row.sr !== 1;
  type Base = { key: number; entry: string | null; pack: string | null; job: string | null; desc: string | null; qty: number | null; short: number | null; produced: number };
  const bases = new Map<string, Base>();
  for (const row of sorted) {
    const base: Base = { key: row.plan?.key ?? 0, entry: blank(row) ? "" : style6(row.plan?.entry ?? null), pack: blank(row) ? "" : style6(row.plan?.pack ?? null), job: row.plan?.job ?? null, desc: blank(row) ? "" : row.plan?.desc ?? null, qty: blank(row) ? 0 : row.qty, short: row.short, produced: 0 };
    const key = JSON.stringify([base.key, base.entry, base.pack, base.job, base.desc, base.qty, base.short]);
    const found = bases.get(key);
    if (found) found.produced = round(found.produced + (row.prod?.qty ?? 0), 4); else { base.produced = row.prod?.qty ?? 0; bases.set(key, base); }
  }
  const bomDocs = new Map<number, string>();
  for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, full_docno FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' AND stock_nat = 'A' ORDER BY prod_id, il_key DESC`)).rows) bomDocs.set(num(row.prod_id), toText(row.full_docno));
  const lessBy = new Map<string, { key: number; desc: string; qty: number }[]>();
  for (const row of (await runReportSql(loader, `SELECT prodmas.prod_key, prodmas.prod_desc, prodled.quantity::numeric AS quantity, prodled.full_docno FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
    + ` WHERE btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' AND prodmas.prod_pos = 'A' AND prodmas.inventory = 'Y' ORDER BY prodled.il_key`)).rows) {
    const doc = toText(row.full_docno);
    const list = lessBy.get(doc) ?? [];
    list.push({ key: num(row.prod_key), desc: toText(row.prod_desc), qty: num(row.quantity) });
    lessBy.set(doc, list);
  }
  const wanted = [...new Set([...bases.values()].map((base) => bomDocs.get(base.key)).filter((doc): doc is string => doc !== undefined))];
  const formula = new Map<string, { key: number; desc: string; qty: number; perHour: number }[]>();
  if (wanted.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT prodmas.prod_key, prodmas.prod_desc, prodled.quantity::numeric AS quantity, coalesce(nullif(btrim(adata.input_perhrstdpc), ''), '0')::numeric AS per_hour, prodled.full_docno FROM ${db}prod_ledger prodled`
      + ` LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key`
      + ` WHERE prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' AND (lower(btrim(adata.txt_prodgroup)) IN ('plastic moulded parts', 'plated parts', 'chemicals'))`
      + ` AND (coalesce(nullif(btrim(adata.input_perhrstdpc), ''), '0')::numeric > 0 OR lower(btrim(adata.txt_prodgroup)) = 'chemicals') AND prodled.full_docno = ANY($1::text[]) ORDER BY prodled.il_key`, [wanted])).rows) {
      const doc = toText(row.full_docno);
      const list = formula.get(doc) ?? [];
      list.push({ key: num(row.prod_key), desc: toText(row.prod_desc), qty: num(row.quantity), perHour: num(row.per_hour) });
      formula.set(doc, list);
    }
  }

  type Out = { plan_entry_date: string | null; plan_pack_date: string | null; Job_Card_No: string | null; description: string | null; planing_qty: number | null; planing_short: number | null; Production_Qty: number | null; PMP_PRODUCT: string; BOM_QTY: number; CONSUME_QTY: number; CONSUME_KGS: number;
    STD_PC_PER_HOUR: number; TOT_HOUR: number; SORTING_FIELD: string };
  const out: Out[] = [];
  for (const base of bases.values()) out.push({ plan_entry_date: base.entry, plan_pack_date: base.pack, Job_Card_No: base.job, description: base.desc, planing_qty: base.qty, planing_short: base.short, Production_Qty: base.produced, PMP_PRODUCT: "", BOM_QTY: 0, CONSUME_QTY: 0, CONSUME_KGS: 0,
    STD_PC_PER_HOUR: 0, TOT_HOUR: 0, SORTING_FIELD: `${base.desc ?? ""} ${ymd(base.entry)}` });
  let semiDoc = "";
  for (const base of [...bases.values()]) {
    const bom = bomDocs.get(base.key) ?? "";
    const diff = round((base.qty ?? 0) - base.produced, 4);
    if (!((base.qty ?? 0) - base.produced > 0) || !(diff > 0)) continue;
    for (const component of formula.get(bom) ?? []) {
      const prefix = `${base.desc} ${ymd(base.entry)} P ${component.desc}`;
      const consume = round(component.qty * diff, 4);
      if (component.perHour > 0) {
        out.push({ plan_entry_date: null, plan_pack_date: null, Job_Card_No: null, description: null, planing_qty: null, planing_short: null, Production_Qty: null, PMP_PRODUCT: component.desc, BOM_QTY: round(component.qty, 3), CONSUME_QTY: round(consume, 3), CONSUME_KGS: 0,
          STD_PC_PER_HOUR: round(component.perHour, 2), TOT_HOUR: round(consume / component.perHour, 2), SORTING_FIELD: prefix });
        const found = bomDocs.get(component.key);
        if (found !== undefined) semiDoc = found;
        for (const semi of lessBy.get(semiDoc) ?? []) {
          out.push({ plan_entry_date: null, plan_pack_date: null, Job_Card_No: null, description: null, planing_qty: null, planing_short: null, Production_Qty: null, PMP_PRODUCT: `-- ${semi.desc}`, BOM_QTY: round(semi.qty, 3), CONSUME_QTY: 0,
            CONSUME_KGS: round(consume * semi.qty, 3), STD_PC_PER_HOUR: 0, TOT_HOUR: 0, SORTING_FIELD: `${prefix} ${semi.desc}` });
        }
      } else {
        out.push({ plan_entry_date: null, plan_pack_date: null, Job_Card_No: null, description: null, planing_qty: null, planing_short: null, Production_Qty: null, PMP_PRODUCT: component.desc, BOM_QTY: round(component.qty, 3), CONSUME_QTY: round(consume, 3), CONSUME_KGS: 0,
          STD_PC_PER_HOUR: 0, TOT_HOUR: 0, SORTING_FIELD: prefix });
      }
    }
  }
  for (const column of ["plan_entry_date", "plan_pack_date", "Job_Card_No", "description", "planing_qty", "planing_short", "Production_Qty", "PMP_PRODUCT", "BOM_QTY", "CONSUME_QTY", "CONSUME_KGS", "STD_PC_PER_HOUR", "TOT_HOUR", "SORTING_FIELD"]) table.addColumn(column);
  for (const column of ["planing_qty", "planing_short", "Production_Qty", "BOM_QTY", "CONSUME_QTY", "CONSUME_KGS", "STD_PC_PER_HOUR", "TOT_HOUR"]) table.setKind(column, "decimal");
  table.rows = out.filter((row) => (row.description ?? "") !== "" || row.PMP_PRODUCT !== "").map((row, index) => ({ row, index })).sort((a, b) => compareText(a.row.SORTING_FIELD, b.row.SORTING_FIELD) || a.index - b.index).map(({ row }) => row as unknown as ResultRow);
  return table;
}
