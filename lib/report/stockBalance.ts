import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 221 and 222: STOCK BALANCE (REPORT_RPI_STOCK_BALANCE / REPORT_RPI_JOB_CARD_BOM, SP_FRT_RPT_RPI_STOCK_BALANCE; SPECIAL > Extra Report (RP1)).
 * For the job cards of the PP plans (all, or the Product Group help's picks, which are plan keys) and the components of the latest BOM of each plan's product
 * (a line for each component; the procedure's cursors are a few grouped reads here):
 *  - 221, first combo 1: what the job card used of the component against what it made of the product: FG_PLANING_QTY (plan x BOM quantity),
 *    SEMI_PRODUCTION_QTY (the component made on the job card: PROD-SFG / PROD-MULTI), PURCHASE_QTY (bought for the job card, the entry addon's PJOBCARD),
 *    FG_ACTUAL_QTY (the component consumed by the PROD-FG entries of the job card), BALANCE_QTY = (made + bought) less consumed, its % of consumed, the standard
 *    rejection (Rej stock less entries of the job card) and the balance after it with its %.
 *  - 221, first combo 2: PLANING_QTY (plan x BOM quantity), Planning_FG, Actual_FG_Produced (the product's PROD-FG entries of the job card), Revised_Planning_Qty
 *    (planned x produced / planned FG), Balance_in_Stock (closing in the report unit), PEND_PROD_PLAN (what all pending plans need of it through the BOMs),
 *    PEND_PURCHASE_ORDER, BALANCE_STOCK (stock less plans plus orders) and MSL (the minimum quantity).
 *  - 222: the requirement sheet: plan entry date, job card, FG product, component, planned and required quantity; the issue / return columns are blank.
 * A component whose BOM product, group, type or category is missing makes no line (the procedure builds its insert as text, which a missing value voids).
 * By job card (its last 10 characters).
 */
const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
const key = (text: unknown) => toText(text).replace(/\s+$/, "").toLowerCase();
const ids = (keys: string) => (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys.trim()) ? keys.trim() : "");

export async function stockBalance(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const rk = call.reportKey;
  const combo = rk === 221 ? Math.trunc(call.fcValue) : 0;
  const pending = rk === 221 && combo === 2;
  const sheet = rk === 222;

  // The job cards of the selected plans.
  const selected = ids(call.selectIdoptKey);
  const jobs = (await runReportSql(loader, `SELECT job_card_no FROM ${db}production_planing WHERE ent_type = 'PP'${selected === "" ? "" : ` AND prod_plan_key IN ${selected}`} AND job_card_no IS NOT NULL`)).rows.map((row) => toText(row.job_card_no));
  const table = new ResultTable();
  const columns = sheet
    ? ["Plan_Entry_Date", "JOB_CARD_NO", "FG_PRODUCT", "DESCRIPTION", "PROD_TYPE", "PLANING_QTY", "REQUIREMENT_QTY", "ISSUE_DATE", "ISSUE_QTY", "BALANCE_QTY", "RETURN_DATE", "RETURN_QTY", "REJECTION_QTY", "STOCK_QTY", "ACT_PROD_QTY"]
    : pending
      ? ["JOB_CARD_NO", "FG_PRODUCT", "ALTERNATE_NAME", "PROD_GROUP", "PROD_TYPE", "CATEGORY", "PLANING_QTY", "Planning_FG", "Actual_FG_Produced", "Revised_Planning_Qty", "Balance_in_Stock", "PEND_PROD_PLAN", "PEND_PURCHASE_ORDER", "BALANCE_STOCK", "MSL"]
      : ["JOB_CARD_NO", "FG_PRODUCT", "ALTERNATE_NAME", "PROD_GROUP", "PROD_TYPE", "CATEGORY", "FG_PLANING_QTY", "SEMI_PRODUCTION_QTY", "PURCHASE_QTY", "FG_ACTUAL_QTY", "BALANCE_QTY", "BALANCE_%", "STANDARD_REJECTION", "BALANCE_AFTER_REJECTION", "BALANCE_AFTER_REJECTION_%", "RATE", "COST"];
  for (const column of columns) table.addColumn(column);
  const textColumns = ["Plan_Entry_Date", "JOB_CARD_NO", "FG_PRODUCT", "DESCRIPTION", "ALTERNATE_NAME", "PROD_GROUP", "PROD_TYPE", "CATEGORY", "ISSUE_DATE", "RETURN_DATE"];
  for (const column of columns.filter((name) => !textColumns.includes(name))) table.setKind(column, "decimal");
  if (jobs.length === 0) return table;
  const jobList = [...new Set(jobs)];

  // The plan rows of those job cards.
  const production = `(SELECT prodled.prod_id, aent.input_job_card, sum(CASE WHEN prodled.stock_nat = 'A' AND ((btrim(prodled.trn_module) = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD') OR (btrim(prodled.trn_module) = 'PROD-FG' AND proce.ent_approve = 'Yes')`
    + ` OR btrim(prodled.trn_module) = 'PROD-SFG' OR (btrim(prodled.trn_module) = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN (prodled.quantity::numeric - prodled.ag_qty::numeric) ELSE 0 END) AS production_qty`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id`
    + ` WHERE prodled.il_pos = 'A' AND coalesce(aent.input_job_card, '') <> '' GROUP BY prodled.prod_id, aent.input_job_card) pq ON pq.prod_id = prodplan.prod_id AND pq.input_job_card = prodplan.job_card_no`;
  type JobRow = { prod: number; job: string; entry: string; qty: number };
  const jobRows: JobRow[] = sheet
    ? (await runReportSql(loader, `SELECT prodplan.prod_id, prodplan.job_card_no, to_char(prodplan.ent_date, 'DD/MM/YYYY') AS entry, prodplan.plan_qty::numeric AS plan_qty FROM ${db}production_planing prodplan WHERE prodplan.ent_type = 'PP' AND prodplan.job_card_no = ANY($1::text[]) ORDER BY prodplan.job_card_no`, [jobList])).rows
      .map((row) => ({ prod: num(row.prod_id), job: toText(row.job_card_no), entry: toText(row.entry), qty: r2(num(row.plan_qty)) }))
    : (await runReportSql(loader, `SELECT prodplan.prod_id, prodplan.job_card_no, prodplan.plan_qty::numeric AS plan_qty FROM ${db}production_planing prodplan LEFT JOIN ${production}`
      + ` WHERE prodplan.ent_type = 'PP' AND prodplan.job_card_no = ANY($1::text[]) GROUP BY prodplan.prod_id, prodplan.job_card_no, prodplan.plan_qty, prodplan.plan_sort, pq.production_qty ORDER BY prodplan.job_card_no`, [jobList])).rows
      .map((row) => ({ prod: num(row.prod_id), job: toText(row.job_card_no), entry: "", qty: r2(num(row.plan_qty)) }));

  // The components of the BOMs of those products (a BOM is credited to the product of the first BOM it is made by, as the procedure's ranking does).
  const stock = "CASE WHEN prodmas.rep1_uom = prodmas.pcs_uom THEN prodbal.clsg_pcs WHEN prodmas.rep1_uom = prodmas.qty1_uom THEN prodbal.clsg_qty1 WHEN prodmas.rep1_uom = prodmas.qty2_uom THEN prodbal.clsg_qty2"
    + " WHEN prodmas.rep1_uom = prodmas.qty3_uom THEN prodbal.clsg_qty3 WHEN prodmas.rep1_uom = prodmas.pack_uom THEN prodbal.clsg_pack WHEN prodmas.rep1_uom = prodmas.weight_uom THEN prodbal.clsg_weight ELSE prodbal.clsg_pcs END";
  const ranked = (column: string, partition: string, alias: string) => `LEFT JOIN (SELECT * FROM (SELECT prodl.full_docno, ${column} AS ${alias}, row_number() OVER (PARTITION BY ${partition} ORDER BY ${partition}, prodl.full_docno) AS rn`
    + ` FROM ${db}product_master prod LEFT JOIN ${db}prod_ledger prodl ON prod.prod_key = prodl.prod_id WHERE btrim(prodl.trn_module) = 'MFG-BOM' AND prod.prod_pos = 'A' AND prodl.il_pos <> 'D' AND prodl.stock_nat = 'A') r WHERE rn = 1) ${alias} ON ${alias}.full_docno = prodled.full_docno`;
  const purchaseOrders = pending
    ? `LEFT JOIN (SELECT pl.prod_id, coalesce(sum(pl.quantity::numeric - pl.ag_qty::numeric), 0) AS pend_purch_order FROM ${db}prod_ledger pl LEFT JOIN ${db}process pr ON pr.process_key = pl.process_id LEFT JOIN ${db}account ac ON ac.code = pr.code`
      + ` WHERE pl.il_pos <> 'D' AND ac.book = 3 AND btrim(pl.trn_module) = 'ORD-IN' AND pl.quantity::numeric - (pl.ag_qty::numeric + coalesce(pl.setof_qty, 0)::numeric) > 0 GROUP BY pl.prod_id) po ON po.prod_id = prodmas.prod_key`
    : "";
  const finished = [...new Set(jobRows.map((row) => row.prod))];
  const bomRows = (await runReportSql(loader, `SELECT coalesce(finish_prod_id.finish_prod_id, 0) AS finish_prod_id, prodmas.prod_key AS semi_prod_id, finish_goods.finish_goods, prodmas.prod_desc AS semi_finish_prod, prodled.quantity::numeric AS quantity,`
    + ` adata.txt_prodgroup AS prod_group, adata.txt_prodtype AS prod_type, adata.txt_prodcat AS category, (${stock})::numeric AS clsg_qty${pending ? ", coalesce(po.pend_purch_order, 0) AS pend_purch_order" : ""}`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}addon_data adata ON prodmas.prod_key = adata.prod_id LEFT JOIN ${db}prod_balance prodbal ON prodmas.prod_key = prodbal.prod_id`
    + ` ${ranked("prod.prod_key", "prod.prod_key", "finish_prod_id")} ${ranked("prod.prod_desc", "prod.prod_desc", "finish_goods")} ${purchaseOrders}`
    + ` WHERE btrim(prodled.trn_module) = 'MFG-BOM' AND prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' AND prodmas.prod_pos = 'A' AND prodmas.inventory = 'Y' AND finish_prod_id.finish_prod_id = ANY($1::int[])`
    + ` AND prodled.full_docno IN (SELECT full_docno FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' AND stock_nat = 'A') ORDER BY prodled.full_docno`, [finished])).rows;
  type Bom = { finish: number; semi: number; goods: string | null; semiName: string | null; quantity: number; group: string | null; type: string | null; category: string | null; closing: number | null; ordered: number };
  const boms = new Map<number, Bom[]>();
  for (const row of bomRows) {
    const bom: Bom = { finish: num(row.finish_prod_id), semi: num(row.semi_prod_id), goods: row.finish_goods === null ? null : toText(row.finish_goods), semiName: row.semi_finish_prod === null ? null : toText(row.semi_finish_prod), quantity: num(row.quantity),
      group: row.prod_group === null ? null : toText(row.prod_group), type: row.prod_type === null ? null : toText(row.prod_type), category: row.category === null ? null : toText(row.category), closing: row.clsg_qty === null ? null : num(row.clsg_qty), ordered: pending ? num(row.pend_purch_order) : 0 };
    const list = boms.get(bom.finish);
    if (list) list.push(bom); else boms.set(bom.finish, [bom]);
  }

  // What the pending plans (of all job cards) still need to make of each product, and so of each component.
  const planPending = new Map<number, number>();
  if (pending) {
    for (const row of (await runReportSql(loader, `SELECT prodplan.prod_id, coalesce(sum(prodplan.plan_qty::numeric - coalesce(prodplan.plan_sort, 0)::numeric), 0) - coalesce(pq.production_qty, 0) AS plan_pend FROM ${db}production_planing prodplan LEFT JOIN ${production}`
      + ` WHERE coalesce(prodplan.job_card_no, '') <> '' GROUP BY prodplan.prod_id, prodplan.job_card_no, pq.production_qty`)).rows) if (num(row.plan_pend) > 0) planPending.set(num(row.prod_id), (planPending.get(num(row.prod_id)) ?? 0) + num(row.plan_pend));
  }
  const actual = new Map<number, number>();
  if (pending) for (const list of boms.values()) for (const bom of list) { const need = planPending.get(bom.finish) ?? 0; if (need > 0) actual.set(bom.semi, (actual.get(bom.semi) ?? 0) + bom.quantity * need); }

  // The job cards' entries, one grouped read each.
  const byJob = async (sql: string, params: unknown[] = []) => {
    const map = new Map<string, number>();
    for (const row of (await runReportSql(loader, sql, params)).rows) map.set(`${key(row.job)}|${num(row.prod_id)}`, r2(num(row.quantity)));
    return map;
  };
  let made = new Map<string, number>();
  let bought = new Map<string, number>();
  let consumed = new Map<string, number>();
  let producedFg = new Map<string, number>();
  const rejected: { job: string; prod: number; quantity: number }[] = [];
  const minimum = new Map<number, number>();
  if (rk === 221 && combo === 1) {
    made = await byJob(`SELECT aent.input_job_card AS job, prodled.prod_id, sum(prodled.quantity::numeric) AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id`
      + ` WHERE aent.input_job_card = ANY($1::text[]) AND prodled.il_pos <> 'D' AND (btrim(prodled.trn_module) = 'PROD-SFG' OR (btrim(prodled.trn_module) = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.stock_nat = 'A' GROUP BY aent.input_job_card, prodled.prod_id`, [jobList]);
    bought = await byJob(`SELECT aent.input_pjobcard AS job, prodled.prod_id, sum(prodled.quantity::numeric) AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_ientry aent ON aent.aoni_il_id = prodled.il_key`
      + ` WHERE aent.input_pjobcard = ANY($1::text[]) AND prodled.il_pos <> 'D' AND prodled.led_id IS NOT NULL AND prodled.stock_nat = 'A' GROUP BY aent.input_pjobcard, prodled.prod_id`, [jobList]);
    consumed = await byJob(`SELECT aent.input_job_card AS job, prodled.prod_id, sum(prodled.quantity::numeric) AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id`
      + ` WHERE aent.input_job_card = ANY($1::text[]) AND prodled.il_pos <> 'D' AND btrim(prodled.trn_module) = 'PROD-FG' AND prodled.inventory = 'Y' AND prodled.stock_nat = 'L' GROUP BY aent.input_job_card, prodled.prod_id`, [jobList]);
    for (const row of (await runReportSql(loader, `SELECT aent.input_pjobcard AS job, prodled.prod_id, sum(prodled.quantity::numeric) AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_ientry aent ON aent.aoni_il_id = prodled.il_key`
      + ` WHERE coalesce(aent.input_pjobcard, '') <> '' AND prodled.il_pos <> 'D' AND btrim(prodled.trn_module) = 'SVOU-LESS' AND prodled.inventory = 'Y' AND left(prodled.full_docno, 3) ILIKE 'Rej' GROUP BY aent.input_pjobcard, prodled.prod_id`)).rows) rejected.push({ job: toText(row.job).toLowerCase(), prod: num(row.prod_id), quantity: num(row.quantity) });
  } else if (pending) {
    producedFg = await byJob(`SELECT aent.input_job_card AS job, prodled.prod_id, sum(prodled.quantity::numeric) AS quantity FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id`
      + ` WHERE aent.input_job_card = ANY($1::text[]) AND prodled.il_pos <> 'D' AND btrim(prodled.trn_module) = 'PROD-FG' AND prodled.inventory = 'Y' AND prodled.stock_nat = 'A' GROUP BY aent.input_job_card, prodled.prod_id`, [jobList]);
    for (const row of (await runReportSql(loader, `SELECT prod_key, coalesce(min_qty, 0)::numeric AS min_qty FROM ${db}product_master WHERE prod_pos <> 'D'`)).rows) minimum.set(num(row.prod_key), r2(num(row.min_qty)));
  }

  const rows: ResultRow[] = [];
  const sorted = jobRows.map((row, index) => ({ row, index })).sort((a, b) => a.row.job.toLowerCase().localeCompare(b.row.job.toLowerCase()) || a.index - b.index).map(({ row }) => row);
  for (const job of sorted) {
    for (const bom of boms.get(job.prod) ?? []) {
      if (bom.goods === null || bom.semiName === null || bom.type === null || (!sheet && (bom.group === null || bom.category === null))) continue;
      const required = r2(job.qty * bom.quantity);
      const mapKey = (semi: number) => `${key(job.job)}|${semi}`;
      if (sheet) {
        rows.push({ Plan_Entry_Date: job.entry, JOB_CARD_NO: job.job, FG_PRODUCT: bom.goods, DESCRIPTION: bom.semiName, PROD_TYPE: bom.type, PLANING_QTY: job.qty, REQUIREMENT_QTY: required, ISSUE_DATE: "", ISSUE_QTY: 0, BALANCE_QTY: 0, RETURN_DATE: "", RETURN_QTY: 0, REJECTION_QTY: 0, STOCK_QTY: 0, ACT_PROD_QTY: 0 });
      } else if (pending) {
        if (bom.closing === null) continue;
        const produced = producedFg.get(mapKey(bom.finish)) ?? 0;
        const msl = minimum.get(bom.semi) ?? 0;
        const planNeed = r2(actual.get(bom.semi) ?? 0);
        const closing = r2(bom.closing);
        rows.push({ JOB_CARD_NO: job.job, FG_PRODUCT: bom.goods, ALTERNATE_NAME: bom.semiName, PROD_GROUP: bom.group, PROD_TYPE: bom.type, CATEGORY: bom.category, PLANING_QTY: required, Planning_FG: job.qty, Actual_FG_Produced: produced,
          Revised_Planning_Qty: job.qty === 0 ? 0 : r2(required / job.qty * produced), Balance_in_Stock: closing, PEND_PROD_PLAN: planNeed, PEND_PURCHASE_ORDER: r2(bom.ordered), BALANCE_STOCK: r2(closing - planNeed + r2(bom.ordered)), MSL: msl });
      } else {
        const semiMade = made.get(mapKey(bom.semi)) ?? 0;
        const purchased = bought.get(mapKey(bom.semi)) ?? 0;
        const used = consumed.get(mapKey(bom.semi)) ?? 0;
        const rejection = r2(rejected.filter((entry) => entry.prod === bom.semi && entry.job.includes(job.job.toLowerCase())).reduce((total, entry) => total + entry.quantity, 0));
        const balance = r2(semiMade + purchased - used);
        const after = r2(balance - rejection);
        rows.push({ JOB_CARD_NO: job.job, FG_PRODUCT: bom.goods, ALTERNATE_NAME: bom.semiName, PROD_GROUP: bom.group, PROD_TYPE: bom.type, CATEGORY: bom.category, FG_PLANING_QTY: required, SEMI_PRODUCTION_QTY: semiMade, PURCHASE_QTY: purchased, FG_ACTUAL_QTY: used,
          BALANCE_QTY: balance, "BALANCE_%": used !== 0 && balance !== 0 ? r2(balance / used * 100) : 0, STANDARD_REJECTION: rejection, BALANCE_AFTER_REJECTION: after, "BALANCE_AFTER_REJECTION_%": after !== 0 && used !== 0 ? r2(after / used * 100) : 0, RATE: 0, COST: 0 });
      }
    }
  }
  const last10 = (text: unknown) => `          ${toText(text)}`.slice(-10).toLowerCase();
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => (last10(a.row.JOB_CARD_NO) < last10(b.row.JOB_CARD_NO) ? -1 : last10(a.row.JOB_CARD_NO) > last10(b.row.JOB_CARD_NO) ? 1 : 0) || a.index - b.index).map(({ row }) => row);
  return table;
}
