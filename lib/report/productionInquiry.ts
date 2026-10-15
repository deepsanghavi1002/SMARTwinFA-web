import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 154 PRODUCTION INQUIRY (REPORT_RPI_INQUIRY) and 168 PLANING CHECKING (REPORT_RPI_PLANING_CHECK): SP_FRT_RPT_RPI_PRODUCTION_INQUIRY
 * (SPECIAL > Extra Report (RP)), in its 07-Oct-2026 form (latest BOM of a product, rows kept whatever is missing, semi-finished items exploded
 * to any depth).
 *
 * The production plans (type PP with a job card, entry date From .. Upto; for 168 type PC entered on Upto) of the ticked products / addons,
 * their finished good line ("<item>  A", the quantity still to be made) and the components of its latest BOM ("<item>  L"): semi-finished
 * components that have a BOM of their own are replaced by their own components (the quantities multiplied down the chain), the other components
 * are listed (as BOM quantity, or the base weight for a product kept in Kgs). Each line has the stock (the closing in the product's report
 * unit), the pending purchase orders, what the pending plans of all products need of it (PLANING_PEND), and the quantity short (stock + orders
 * less need). Finish Goods get the longest lead time of their lines and a tentative date. With "Indent Entry Require" the lines are
 * summed up by product with the last purchase's party, quantity and rate (and the weight of the quantity short). 168 is a sheet of
 * description, planned, stock and quantity (stock less all that is planned).
 *
 * The procedure's work tables are held in memory (a report never writes), from a few grouped reads. 168's delete of its PC plan rows is not done.
 */
type Component = { doc: string; key: number; type: number; typeDesc: string; uomId: number; desc: string; uom: string; qty: number; baseWeight: number; stock: number; lead: number; message: string; min: number; pendingOrder: number; group: string; category: string; spec: string };
type Plan = { seq: number; key: number; type: number; desc: string; qty: number; entry: string; pack: string; group: string; category: string; jobCard: string; message: string; min: number; pend: number; remark: string; bom: string };
type Line = { plan: number; kind: string; level: number; row: ResultRow };

const MONTH = (value: number) => String(value).padStart(2, "0");
const round = (value: number, places: number) => { const factor = 10 ** places; return Math.round((value + Math.sign(value) * 1e-9) * factor) / factor; };

export async function productionInquiry(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const rk = call.reportKey;
  const summary = call.checkQuery.includes("CHK_SUMMARY,");
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);

  // The latest BOM of each product (by date, then key).
  const bomMap = new Map<number, string>();
  for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, full_docno FROM ${db}prod_ledger WHERE trn_module = 'MFG-BOM' AND il_pos <> 'D' AND stock_nat = 'A' AND prod_id IS NOT NULL AND full_docno IS NOT NULL ORDER BY prod_id, il_date DESC, il_key DESC`)).rows) bomMap.set(num(row.prod_id), toText(row.full_docno));

  // What each BOM takes (its LESS lines of inventory products).
  const lessBom = (await runReportSql(loader, `SELECT prodled.prod_id, prodled.full_docno, prodled.quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
    + ` WHERE prodled.trn_module = 'MFG-BOM' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'L' AND prodmas.inventory = 'Y'`)).rows.map((row) => ({ key: num(row.prod_id), doc: toText(row.full_docno), qty: num(row.quantity) }));

  // The components of the BOMs with their stock (closing in the report unit), lead days, pending orders and addons.
  const bomOf = new Map<string, Component[]>();
  for (const row of (await runReportSql(loader, `SELECT prodled.full_docno AS doc, product.prod_key, adata.key_prodtype AS prod_type, adata.txt_prodtype AS prod_type_desc, prodled.rateuom_id AS uom_id, product.prod_desc, produom.uom_short AS uom, prodled.quantity,`
    + ` coalesce(product.base_weight, 0) AS base_weight,`
    + ` CASE WHEN product.rep1_uom = product.pcs_uom THEN prodbal.clsg_pcs WHEN product.rep1_uom = product.qty1_uom THEN prodbal.clsg_qty1 WHEN product.rep1_uom = product.qty2_uom THEN prodbal.clsg_qty2`
    + ` WHEN product.rep1_uom = product.qty3_uom THEN prodbal.clsg_qty3 WHEN product.rep1_uom = product.pack_uom THEN prodbal.clsg_pack WHEN product.rep1_uom = product.weight_uom THEN prodbal.clsg_weight ELSE prodbal.clsg_pcs END AS stock,`
    + ` coalesce(product.lead_days, 0) AS lead_days, coalesce(product.prod_message, '') AS message, coalesce(product.min_qty, 0) AS min_qty, coalesce(po.pending_order, 0) AS pending_order,`
    + ` adata.txt_prodtype AS prod_group, adata.txt_prodgroup AS category, coalesce(adata.input_remark, '') AS spec`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master product ON product.prod_key = prodled.prod_id LEFT JOIN ${db}addon_data adata ON adata.prod_id = product.prod_key`
    + ` LEFT JOIN ${db}prod_balance prodbal ON prodbal.prod_id = product.prod_key LEFT JOIN ${db}prod_uom produom ON produom.uom_key = prodled.rateuom_id`
    + ` LEFT JOIN (SELECT pl.prod_id, coalesce(sum(pl.quantity - pl.ag_qty), 0) AS pending_order FROM ${db}prod_ledger pl LEFT JOIN ${db}account ac ON ac.code = pl.code`
    + ` WHERE pl.trn_module = 'ORD-IN' AND ac.book = 3 AND pl.il_pos <> 'D' AND pl.quantity - (pl.ag_qty + coalesce(pl.setof_qty, 0)) > 0 GROUP BY pl.prod_id) po ON po.prod_id = prodled.prod_id`
    + ` WHERE prodled.trn_module = 'MFG-BOM' AND prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' AND product.inventory = 'Y'`)).rows) {
    const component: Component = {
      doc: toText(row.doc), key: num(row.prod_key), type: num(row.prod_type), typeDesc: toText(row.prod_type_desc), uomId: num(row.uom_id), desc: toText(row.prod_desc), uom: toText(row.uom), qty: num(row.quantity),
      baseWeight: num(row.base_weight), stock: num(row.stock), lead: num(row.lead_days), message: toText(row.message), min: num(row.min_qty), pendingOrder: num(row.pending_order),
      group: toText(row.prod_group), category: toText(row.category), spec: toText(row.spec),
    };
    const list = bomOf.get(component.doc);
    if (list) list.push(component); else bomOf.set(component.doc, [component]);
  }

  // What is still to be made on each plan (per product and job card) less what was produced against the job card.
  const pending = (await runReportSql(loader, `SELECT prodplan.job_card_no, prodplan.prod_id AS prod_key, coalesce(prodplan.ent_remark, '') AS plan_remark,`
    + ` coalesce(sum(prodplan.plan_qty - coalesce(prodplan.plan_sort, 0)), 0) - coalesce(pq.production_qty, 0) AS pending`
    + ` FROM ${db}production_planing prodplan LEFT JOIN (SELECT prodled.prod_id, aent.input_job_card, sum(CASE WHEN prodled.stock_nat = 'A' AND ((prodled.trn_module = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD')`
    + ` OR (prodled.trn_module = 'PROD-FG' AND proce.ent_approve = 'Yes') OR (prodled.trn_module = 'PROD-SFG') OR (prodled.trn_module = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> ''))`
    + ` AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN (prodled.quantity - prodled.ag_qty) ELSE 0 END) AS production_qty FROM ${db}prod_ledger prodled`
    + ` LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id`
    + ` WHERE prodled.il_pos = 'A' AND coalesce(aent.input_job_card, '') <> '' GROUP BY prodled.prod_id, aent.input_job_card) pq ON pq.prod_id = prodplan.prod_id AND pq.input_job_card = prodplan.job_card_no`
    + ` WHERE coalesce(prodplan.job_card_no, '') <> '' GROUP BY prodplan.prod_id, prodplan.job_card_no, prodplan.ent_remark, pq.production_qty`)).rows
    .map((row) => ({ key: num(row.prod_key), jobCard: toText(row.job_card_no), remark: toText(row.plan_remark), pending: num(row.pending) }));

  // The plan lines of the ticked products.
  const where = frag(call.where.split("|sys.yearid|").join(call.yearId));
  const planned = (await runReportSql(loader, `SELECT product.prod_key, adata.key_prodtype AS prod_type, product.prod_desc, prodplan.plan_qty - coalesce(prodplan.plan_sort, 0) AS plan_qty,`
    + ` to_char(prodplan.ent_date, 'DD/MM/YYYY') AS entry, coalesce(to_char(prodplan.packing_date, 'DD/MM/YYYY'), '') AS pack, adata.txt_prodtype AS prod_group, adata.txt_prodgroup AS category,`
    + ` coalesce(prodplan.job_card_no, '') AS job_card, coalesce(product.prod_message, '') AS message, coalesce(product.min_qty, 0) AS min_qty`
    + ` FROM ${db}production_planing prodplan LEFT JOIN ${db}product_master product ON product.prod_key = prodplan.prod_id LEFT JOIN ${db}addon_data adata ON adata.prod_id = product.prod_key`
    + ` ${where} AND prodplan.plan_qty > 0 AND `
    + (rk === 168 ? `prodplan.ent_type = 'PC' AND prodplan.ent_date = $1` : `prodplan.ent_type = 'PP' AND prodplan.ent_date BETWEEN $1 AND $2 AND coalesce(prodplan.job_card_no, '') <> ''`)
    + ` ORDER BY product.prod_desc, prodplan.ent_date, prodplan.prod_plan_key`, rk === 168 ? [desktopDate(call.upto)] : [desktopDate(call.from), desktopDate(call.upto)])).rows;
  const plans: Plan[] = planned.map((row, index) => {
    const key = num(row.prod_key);
    const jobCard = toText(row.job_card);
    const found = pending.find((candidate) => candidate.key === key && candidate.jobCard === jobCard);
    return { seq: index + 1, key, type: num(row.prod_type), desc: toText(row.prod_desc), qty: num(row.plan_qty), entry: toText(row.entry), pack: toText(row.pack), group: toText(row.prod_group), category: toText(row.category),
      jobCard, message: toText(row.message), min: num(row.min_qty), pend: found ? found.pending : 0, remark: found ? found.remark : "", bom: bomMap.get(key) ?? "" };
  });

  // The explosion.
  const lines: Line[] = [];
  const base = (p: Plan, kind: string, level: number, values: Record<string, unknown>): Line => ({
    plan: p.seq, kind, level, row: {
      SORTING_FIELD: `${p.desc}  ${kind}`, fg_Prod_key: p.key, Plan_Entry_date: p.entry, Plan_Pack_date: rk === 168 ? null : p.pack, PLAN_REMARK: p.remark.slice(0, 250), Job_Card_No: p.jobCard, ...values,
    },
  });
  const semi = "Semi Finished Material";
  const toLine = (p: Plan, c: Component, level: number, bomQty: number, planing: number, planingPend: number) => base(p, "L", level, {
    PROD_KEY: c.key, PROD_TYPE: c.type, UOM_ID: c.uomId, Description: c.desc, BOMB_QTY: bomQty, UOM: c.uom, PLANING: round(planing, 4), PLANING_PEND: round(planingPend, 4), PENDING_ORDER: c.pendingOrder, STOCK: c.stock,
    QUANTITY: 0, MIN_QTY: c.min, LEAD_DAYS: c.lead, WARNING_MESSAGE: c.message, Prod_Group: c.group, Category: c.category, Specification: c.spec,
  });
  for (const p of plans) {
    const pendPositive = Math.max(p.pend, 0);
    lines.push(base(p, "A", 0, { PROD_KEY: p.key, PROD_TYPE: p.type, UOM_ID: 5, Description: p.desc, BOMB_QTY: 0, UOM: "PCS", PLANING: round(p.qty, 4), PLANING_PEND: round(pendPositive, 4), PENDING_ORDER: 0, STOCK: 0, QUANTITY: 0,
      MIN_QTY: p.min, LEAD_DAYS: 0, WARNING_MESSAGE: p.message, Prod_Group: p.group, Category: p.category, Specification: "" }));
    const components = bomOf.get(p.bom) ?? [];
    for (const c of components) {
      if (rk !== 168 && c.typeDesc.toLowerCase() === semi.toLowerCase() && bomMap.has(c.key)) continue;
      const unit = c.baseWeight === 1 || c.baseWeight === 0 || c.uom.toUpperCase() !== "KGS" ? c.qty : c.baseWeight;
      lines.push(toLine(p, c, 1, unit, unit * p.qty, unit * pendPositive));
    }
    if (rk === 168) continue;
    // Every semi-finished component with a BOM of its own, and below it, to ten levels; the components without a BOM are the lines.
    let nodes = components.filter((c) => c.typeDesc.toLowerCase() === semi.toLowerCase() && bomMap.has(c.key) && c.key !== p.key).map((c) => ({ key: c.key, bom: bomMap.get(c.key)!, mult: c.qty, level: 1 }));
    while (nodes.length > 0) {
      const next: typeof nodes = [];
      for (const node of nodes) {
        for (const c of bomOf.get(node.bom) ?? []) {
          if (c.key === node.key) continue;
          if (!bomMap.has(c.key)) lines.push(toLine(p, c, node.level + 1, c.qty, node.mult * c.qty * p.qty, node.mult * c.qty * pendPositive));
          if (node.level < 10 && bomMap.has(c.key)) next.push({ key: c.key, bom: bomMap.get(c.key)!, mult: node.mult * c.qty, level: node.level + 1 });
        }
      }
      nodes = next;
    }
  }
  const order = (a: Line, b: Line) => a.plan - b.plan || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.level - b.level || toText(a.row.Description).toLowerCase().localeCompare(toText(b.row.Description).toLowerCase());
  lines.sort(order);

  // The rows of the report table, nothing missing left as null.
  const rows: ResultRow[] = lines.map(({ row }) => ({
    SORTING_FIELD: row.SORTING_FIELD, PROD_KEY: num(row.PROD_KEY), fg_Prod_key: num(row.fg_Prod_key), PROD_TYPE: num(row.PROD_TYPE), UOM_ID: num(row.UOM_ID), Plan_Entry_date: toText(row.Plan_Entry_date), Description: row.Description,
    Plan_Pack_date: row.Plan_Pack_date, BOMB_QTY: num(row.BOMB_QTY), UOM: toText(row.UOM), PLAN_REMARK: toText(row.PLAN_REMARK), PLANING: num(row.PLANING), PLANING_PEND: num(row.PLANING_PEND), PENDING_ORDER: num(row.PENDING_ORDER),
    STOCK: num(row.STOCK), QUANTITY: num(row.QUANTITY), MIN_QTY: num(row.MIN_QTY), LEAD_DAYS: num(row.LEAD_DAYS), Tentative_date: null, WARNING_MESSAGE: toText(row.WARNING_MESSAGE), INPUT_QTY: 0, QTY_WEIGHT: 0, IND_GRP: "",
    Prod_Group: toText(row.Prod_Group), Category: toText(row.Category), Job_Card_No: toText(row.Job_Card_No), Specification: toText(row.Specification),
  }));

  // What the pending plans of every product need of a component (its BOM's LESS line x what is pending), put on its lines.
  const need = new Map<number, number>();
  for (const a of pending) {
    if (!(a.pending > 0)) continue;
    const doc = bomMap.get(a.key);
    if (doc === undefined) continue;
    for (const b of lessBom) if (b.doc === doc && b.qty > 0) need.set(b.key, (need.get(b.key) ?? 0) + a.pending * b.qty);
  }
  for (const row of rows) { const total = need.get(num(row.PROD_KEY)); if (total !== undefined) row.PLANING_PEND = round(total, 4); }

  if (rk !== 168) {
    for (const row of rows) if (num(row.BOMB_QTY) !== 0) { const short = round(num(row.STOCK) + num(row.PENDING_ORDER) - num(row.PLANING_PEND), 4); row.QUANTITY = short; row.INPUT_QTY = short; }
    // Finish Goods take the longest lead time of the lines of the same product and entry date; their tentative date is the entry date plus the lead days (and a day).
    const longest = new Map<string, number>();
    for (const row of rows) { const key = `${toText(row.Plan_Entry_date)}\u0000${num(row.fg_Prod_key)}`; longest.set(key, Math.max(longest.get(key) ?? 0, num(row.LEAD_DAYS))); }
    for (const row of rows) {
      if (toText(row.Prod_Group).toLowerCase() !== "finish goods") continue;
      row.LEAD_DAYS = longest.get(`${toText(row.Plan_Entry_date)}\u0000${num(row.fg_Prod_key)}`) ?? 0;
      const entry = toText(row.Plan_Entry_date);
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(entry);
      if (!match) continue;
      if (num(row.LEAD_DAYS) === 0) { row.Tentative_date = entry; continue; }
      const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]) + num(row.LEAD_DAYS) + 1);
      row.Tentative_date = `${MONTH(date.getDate())}/${MONTH(date.getMonth() + 1)}/${date.getFullYear()}`;
    }
  }

  const table = new ResultTable();
  const numbers = ["BOMB_QTY", "PLANING", "PLANING_PEND", "PENDING_ORDER", "STOCK", "QUANTITY", "INPUT_QTY", "QTY_WEIGHT", "LAST_QTY", "LAST_RATE"];
  const open = (columns: string[]) => { for (const column of columns) { table.addColumn(column); if (numbers.includes(column)) table.setKind(column, "decimal"); } };
  const compare = (a: unknown, b: unknown) => toText(a).toLowerCase().localeCompare(toText(b).toLowerCase());

  if (rk === 168) {
    // Stock less everything planned of the product, on the first line of each product; then a row for each description.
    const planned168 = new Map<string, number>();
    for (const row of rows) planned168.set(toText(row.Description), (planned168.get(toText(row.Description)) ?? 0) + num(row.PLANING));
    const first = new Set<number>();
    for (const row of rows) { const key = num(row.PROD_KEY); if (!first.has(key)) { first.add(key); row.QUANTITY = round(num(row.STOCK) - (planned168.get(toText(row.Description)) ?? 0), 4); } }
    const grouped = new Map<string, ResultRow>();
    for (const row of rows) {
      const key = [toText(row.Description), toText(row.Prod_Group), toText(row.Category), num(row.STOCK)].join("\u0000");
      const found = grouped.get(key);
      if (found) { found.PLANING = round(num(found.PLANING) + num(row.PLANING), 4); found.QUANTITY = round(num(found.QUANTITY) + num(row.QUANTITY), 4); }
      else grouped.set(key, { Description: row.Description, PLANING: row.PLANING, STOCK: row.STOCK, QUANTITY: row.QUANTITY, Prod_Group: row.Prod_Group, Category: row.Category });
    }
    open(["Description", "PLANING", "STOCK", "QUANTITY", "Prod_Group", "Category"]);
    table.rows = [...grouped.values()].sort((a, b) => compare(a.Description, b.Description));
    return table;
  }

  if (!summary) {
    open(["SORTING_FIELD", "PROD_KEY", "fg_Prod_key", "PROD_TYPE", "UOM_ID", "Plan_Entry_date", "Description", "Plan_Pack_date", "BOMB_QTY", "UOM", "PLAN_REMARK", "PLANING", "PLANING_PEND", "PENDING_ORDER", "STOCK", "QUANTITY",
      "MIN_QTY", "LEAD_DAYS", "Tentative_date", "WARNING_MESSAGE", "Prod_Group", "Category", "Job_Card_No", "Specification"]);
    table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => compare(a.row.SORTING_FIELD, b.row.SORTING_FIELD) || a.index - b.index).map(({ row }) => row);
    return table;
  }

  // Indent Entry: the weight of the quantity short, the last purchase of each product, then a row for each product line.
  const keys = [...new Set(rows.map((row) => num(row.PROD_KEY)))];
  const weights = new Map((await runReportSql(loader, `SELECT prod_key, base_weight::numeric AS base_weight FROM ${db}product_master WHERE prod_key = ANY($1::int[])`, [keys])).rows.map((row) => [num(row.prod_key), row.base_weight === null ? null : num(row.base_weight)] as const));
  for (const row of rows) { const weight = weights.get(num(row.PROD_KEY)); if (weight !== undefined && weight !== null && weight !== 1) row.QTY_WEIGHT = round(num(row.QUANTITY) * weight, 2); }
  const last = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prodled.prod_id) prodled.prod_id, ac.name AS party, prodled.quantity AS last_qty, prodled.rate::numeric AS last_rate FROM ${db}prod_ledger prodled LEFT JOIN ${db}account ac ON ac.code = prodled.code`
    + ` WHERE prodled.prod_id = ANY($1::int[]) AND prodled.il_pos = 'A' AND prodled.book = 13 AND prodled.led_id IS NOT NULL ORDER BY prodled.prod_id, prodled.il_date DESC, prodled.il_key DESC`, [keys])).rows.map((row) => [num(row.prod_id), row] as const));
  const grouped = new Map<string, ResultRow>();
  for (const row of rows) {
    if (num(row.BOMB_QTY) === 0) continue;
    const found = last.get(num(row.PROD_KEY));
    const party = found ? toText(found.party) : "";
    const lastQty = found ? round(num(found.last_qty), 2) : 0;
    const lastRate = found ? round(num(found.last_rate), 2) : 0;
    const key = [row.PROD_KEY, row.PROD_TYPE, row.UOM_ID, toText(row.Job_Card_No), toText(row.Description), toText(row.Prod_Group), toText(row.Category), row.PENDING_ORDER, party, lastQty, lastRate, row.STOCK, row.MIN_QTY, toText(row.WARNING_MESSAGE), toText(row.PLAN_REMARK), toText(row.Specification)].join("\u0000");
    const entry = grouped.get(key);
    if (entry) {
      for (const column of ["PLANING", "QUANTITY", "INPUT_QTY", "QTY_WEIGHT"]) entry[column] = round(num(entry[column]) + num(row[column]), 4);
    } else grouped.set(key, { PROD_KEY: row.PROD_KEY, PROD_TYPE: row.PROD_TYPE, UOM_ID: row.UOM_ID, Description: row.Description, PLANING: row.PLANING, PENDING_ORDER: row.PENDING_ORDER, STOCK: row.STOCK, QUANTITY: row.QUANTITY,
      INPUT_QTY: row.INPUT_QTY, IND_GRP: row.IND_GRP, QTY_WEIGHT: row.QTY_WEIGHT, Job_Card_No: row.Job_Card_No, Specification: row.Specification, MIN_QTY: row.MIN_QTY, WARNING_MESSAGE: row.WARNING_MESSAGE, PLAN_REMARK: row.PLAN_REMARK,
      Prod_Group: row.Prod_Group, Category: row.Category, PARTY_NAME: party, LAST_QTY: lastQty, LAST_RATE: lastRate });
  }
  open(["PROD_KEY", "PROD_TYPE", "UOM_ID", "Description", "PLANING", "PENDING_ORDER", "STOCK", "QUANTITY", "INPUT_QTY", "IND_GRP", "QTY_WEIGHT", "Job_Card_No", "Specification", "MIN_QTY", "WARNING_MESSAGE", "PLAN_REMARK",
    "Prod_Group", "Category", "PARTY_NAME", "LAST_QTY", "LAST_RATE"]);
  table.rows = [...grouped.values()].sort((a, b) => compare(a.Description, b.Description));
  return table;
}
