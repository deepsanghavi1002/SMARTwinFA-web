import type { Loader } from "../master-program/load";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { tableFromResult } from "./library";
import { isoDay, keyList, priorYearDatabase } from "./priorYear";
import { num, runReportSql } from "./run";

/**
 * 303: FAST MOVING ITEM (SP_FRT_RPT_FAST_MOVING_ITEM; ANALYSIS > Fast Moving Item). For each product sold in the period (the sale and sale return lines of the
 * ledger, quantity less what was set against, returns taken off): its quantity and share of the total, the closing stock, the days it was picked and the lines,
 * its peak month and the share of that month, the months it sold in, the first / last sale and the days since, the FSN class (Fast to 70% of the quantity,
 * Slow to 90%, else Non Moving; "S-" in front for a seasonal product: sold in 4 months or less with 40% of it in one, or very uneven by month, and not new in
 * the last 6 months), the sale value (the item slabs taken off), the minimum stock, the daily average, the days of cover and the stock status.
 * "Last Year Compare" (CHK_LYCOMPARE) adds last year's figures (the previous year's database) beside them, the growth and the trend.
 * One scan of the ledger for the period (the base of the months, the figures and last year's), the rest is grouped and ranked by the database.
 */
export async function fastMovingItem(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const from = isoDay(call.from);
  const upto = isoDay(call.upto);
  const days = Math.round((Date.UTC(call.upto.getFullYear(), call.upto.getMonth(), call.upto.getDate()) - Date.UTC(call.from.getFullYear(), call.from.getMonth(), call.from.getDate())) / 86400000) + 1;
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "");
  if (levels.some((at) => /aentry/i.test(call.addon[at]))) throw new ReportRefusal("An entry addon group is not available in the web version of this report yet.", "Not ported yet");
  const keyOf = (at: number) => call.addon[at].trim().replace(/^(adata)\.txt_/i, "adata.key_");
  const compare = call.checkQuery.includes("CHK_LYCOMPARE");
  const prior = compare ? await priorYearDatabase(loader, call) : "";
  const withLastYear = compare && prior !== "";

  // The item slabs (book 8, not the master slab): their amounts come off the sale value.
  const slabs = (await runReportSql(loader, `SELECT slab_key FROM ${db}slab_master WHERE book = 8 AND slab_master = 'N' AND slab_active = 'Y' AND slab_pos = 'P' ORDER BY slab_order`)).rows.map((row) => num(row.slab_key));

  const products = keyList(call.selectKey[4]);
  const addonFilter = levels.filter((at) => keyList(call.selectKey[at]) !== "").map((at) => ` AND ${keyOf(at)} IN ${keyList(call.selectKey[at])}`).join("");
  const productFilter = products !== "" ? ` AND prodled.prod_id IN ${products}` : "";
  const sold = "prodled.il_pos <> 'D' AND prodled.inventory = 'Y' AND prodled.quantity::numeric - prodled.ag_qty::numeric > 0 AND prodled.book IN (8, 16) AND (prodled.led_id > 0 OR btrim(prodled.trn_module) = 'CHLN-OUT')";
  const columns = "prodled.prod_id, prodled.il_date, prodled.il_key, prodled.book, prodled.code, prodled.il_value::numeric AS il_value,"
    + " CASE WHEN prodled.book = 16 THEN -prodled.quantity::numeric ELSE prodled.quantity::numeric - prodled.ag_qty::numeric END AS sq";
  const month = (alias: string, qty: string) => `SELECT l.prod_id, date_trunc('month', l.il_date)::date AS mth, sum(l.sq) AS ${qty} FROM ${alias} l GROUP BY 1, 2`;

  /** The peak month, the share of it and how uneven the months are, for one year's months: the seasonal mark. */
  const seasons = (monthly: string, qty: string, firstLimit: string, flag: string) => [
    `${monthly}_peak AS (SELECT prod_id, to_char(mth, 'FMMonth') AS peak_month, row_number() OVER (PARTITION BY prod_id ORDER BY ${qty} DESC, mth) AS rn FROM ${monthly})`,
    `${monthly}_season AS (SELECT m.prod_id, count(*) AS active_months, min(m.mth) AS first_mth, max(m.${qty})::numeric(18,4) / nullif(sum(m.${qty})::numeric(18,4), 0) AS peak_share,`
    + ` (stddev_samp(m.${qty}))::numeric(18,4) / nullif(avg(m.${qty}::numeric(18,4))::numeric(18,4), 0) AS cv FROM ${monthly} m GROUP BY m.prod_id)`,
    `${monthly}_flag AS (SELECT s.prod_id, s.active_months, p.peak_month, round(s.peak_share * 100, 1)::numeric(6,1) AS peak_share_pct, round(s.cv, 2)::numeric(8,2) AS cv,`
    + ` CASE WHEN s.first_mth > ${firstLimit} THEN 'N' WHEN s.active_months <= 4 AND s.peak_share >= 0.40 THEN 'Y' WHEN s.cv >= 1.2 THEN 'Y' ELSE 'N' END AS ${flag}`
    + ` FROM ${monthly}_season s LEFT JOIN ${monthly}_peak p ON p.prod_id = s.prod_id AND p.rn = 1)`,
  ];

  const closing = "CASE WHEN pm.rep1_uom = pm.pcs_uom THEN prodbal.clsg_pcs WHEN pm.rep1_uom = pm.qty1_uom THEN prodbal.clsg_qty1 WHEN pm.rep1_uom = pm.qty2_uom THEN prodbal.clsg_qty2"
    + " WHEN pm.rep1_uom = pm.qty3_uom THEN prodbal.clsg_qty3 WHEN pm.rep1_uom = pm.pack_uom THEN prodbal.clsg_pack WHEN pm.rep1_uom = pm.weight_uom THEN prodbal.clsg_weight ELSE prodbal.clsg_pcs END";
  const stockStatus = "CASE WHEN c.clsg_stock <= 0 THEN 'STOCK OUT' WHEN coalesce(c.min_qty, 0) = 0 THEN 'No Min Set' WHEN c.clsg_stock <= c.min_qty THEN 'BELOW MIN' WHEN c.clsg_stock <= c.min_qty * 1.25 THEN 'Near Min' ELSE 'OK' END";
  const date = (value: string) => `to_char(${value}, 'DD-Mon-YY')`;

  const parts: string[] = [
    // The ledger of the period, read once.
    `led AS MATERIALIZED (SELECT ${columns} FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodled.prod_id WHERE ${sold} AND prodled.il_date BETWEEN $1::date AND $2::date${addonFilter}${productFilter})`,
    `monthly AS (${month("led", "qty")})`,
    ...seasons("monthly", "qty", "($2::date - interval '6 months')", "seasonal_flag"),
  ];
  if (withLastYear) {
    parts.push(
      `lyled AS MATERIALIZED (SELECT ${columns} FROM ${prior}prod_ledger prodled LEFT JOIN ${prior}addon_data adata ON adata.prod_id = prodled.prod_id WHERE ${sold}`
      + ` AND prodled.il_date BETWEEN ($1::date - interval '1 year') AND ($2::date - interval '1 year')${productFilter})`,
      `lymonthly AS (${month("lyled", "ly_qty")})`,
      ...seasons("lymonthly", "ly_qty", "(($2::date - interval '1 year')::date - interval '6 months')", "ly_seasonal_flag"),
    );
  }
  if (slabs.length > 0) parts.push(`slab AS (SELECT il_id, sum(slab_amt::numeric) AS ded_amt FROM ${db}ledger_ext WHERE il_id IN (SELECT il_key FROM led) AND slab_id::int = ANY($4::int[]) GROUP BY il_id)`);
  parts.push(
    `base AS (SELECT l.prod_id, max(pm.prod_desc) AS name, sum(l.sq) AS quantity,`
    + ` sum(CASE WHEN l.book = 16 THEN -(l.il_value - ${slabs.length > 0 ? "coalesce(s.ded_amt, 0)" : "0"}) ELSE l.il_value - ${slabs.length > 0 ? "coalesce(s.ded_amt, 0)" : "0"} END) AS sale_value,`
    + ` count(DISTINCT l.il_date) AS pick_days, count(*) AS txn_count, max((${closing})::numeric) AS clsg_stock, coalesce(max(sf.seasonal_flag), 'N') AS seasonal_flag, max(sf.peak_month) AS peak_month,`
    + ` max(sf.active_months) AS active_months, max(sf.peak_share_pct) AS peak_share_pct, max(sf.cv) AS cv, min(CASE WHEN l.book = 8 THEN l.il_date END) AS first_sale_date,`
    + ` max(CASE WHEN l.book = 8 THEN l.il_date END) AS last_sale_date, max(pm.min_qty::numeric) AS min_qty, round(sum(l.sq) * 1.0 / $3::numeric, 4)::numeric(18,4) AS avg_daily_qty`
    + ` FROM led l LEFT JOIN ${db}product_master pm ON pm.prod_key = l.prod_id LEFT JOIN ${db}account ac ON ac.code = l.code LEFT JOIN ${db}prod_balance prodbal ON prodbal.prod_id = pm.prod_key`
    + ` LEFT JOIN monthly_flag sf ON sf.prod_id = l.prod_id${slabs.length > 0 ? " LEFT JOIN slab s ON s.il_id = l.il_key" : ""}`
    + ` WHERE prodbal.prec_flag = 'RP' AND pm.prod_pos <> 'D' AND ac.a_pos <> 'D' GROUP BY l.prod_id)`,
  );
  if (withLastYear) {
    parts.push(
      `lybase AS (SELECT l.prod_id, sum(l.sq) AS ly_quantity, count(DISTINCT l.il_date) AS ly_pick_days, count(*) AS ly_txn_count, coalesce(max(sf.ly_seasonal_flag), 'N') AS ly_seasonal_flag,`
      + ` max(sf.peak_month) AS ly_peak_month, max(sf.active_months) AS ly_active_months, max(sf.peak_share_pct) AS ly_peak_share_pct, min(CASE WHEN l.book = 8 THEN l.il_date END) AS ly_first_sale_date,`
      + ` max(CASE WHEN l.book = 8 THEN l.il_date END) AS ly_last_sale_date FROM lyled l LEFT JOIN ${prior}product_master pm ON pm.prod_key = l.prod_id LEFT JOIN ${prior}account ac ON ac.code = l.code`
      + ` LEFT JOIN ${prior}prod_balance prodbal ON prodbal.prod_id = pm.prod_key LEFT JOIN lymonthly_flag sf ON sf.prod_id = l.prod_id`
      + ` WHERE prodbal.prec_flag = 'RP' AND pm.prod_pos <> 'D' AND ac.a_pos <> 'D' GROUP BY l.prod_id)`,
    );
  }
  parts.push(
    `ranked AS (SELECT b.*,`
    + ` sum(b.quantity::numeric(18,4)) OVER (PARTITION BY b.seasonal_flag ORDER BY b.quantity DESC NULLS LAST, b.prod_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / nullif(sum(b.quantity::numeric(18,4)) OVER (PARTITION BY b.seasonal_flag), 0) AS cum_pct,`
    + ` sum(CASE WHEN b.sale_value > 0 THEN b.sale_value::numeric(18,4) ELSE 0 END) OVER (ORDER BY b.sale_value DESC NULLS LAST, b.prod_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / nullif(sum(CASE WHEN b.sale_value > 0 THEN b.sale_value::numeric(18,4) ELSE 0 END) OVER (), 0) AS abc_cum_pct FROM base b)`,
  );

  const fsn = "CASE WHEN c.seasonal_flag = 'Y' THEN 'S-' ELSE '' END || CASE WHEN c.quantity <= 0 THEN 'Non Moving' WHEN c.cum_pct <= 0.70 THEN 'Fast' WHEN c.cum_pct <= 0.90 THEN 'Slow' ELSE 'Non Moving' END";
  const recent = `($2::date - c.last_sale_date::date)`;
  const share = "(c.quantity * 100.0 / nullif(sum(c.quantity) OVER (), 0))::numeric(9,2)";
  const common = `c.clsg_stock AS "Clsg_Stock"`;
  const select = withLastYear
    ? `SELECT row_number() OVER (ORDER BY c.seasonal_flag, c.quantity DESC NULLS LAST, c.prod_id) AS "Row_No", c.name AS "Item", lb.ly_quantity, c.quantity, coalesce(c.quantity, 0) - coalesce(lb.ly_quantity, 0) AS growth_qty,`
      + ` CASE WHEN coalesce(lb.ly_quantity, 0) > 0 THEN ((c.quantity - coalesce(lb.ly_quantity, 0)) * 100.0 / coalesce(lb.ly_quantity, 0))::numeric(10,2) ELSE 0 END AS "growth_%",`
      + ` (lb.ly_quantity * 100.0 / nullif(sum(lb.ly_quantity) OVER (), 0))::numeric(9,2) AS ly_pct_of_total, ${share} AS pct_of_total,`
      + ` CASE WHEN coalesce(lb.ly_quantity, 0) <= 0 AND c.quantity > 0 THEN 'New' WHEN c.quantity <= 0 AND coalesce(lb.ly_quantity, 0) > 0 THEN 'Lost' WHEN c.quantity >= coalesce(lb.ly_quantity, 0) * 1.10 THEN 'Growing'`
      + ` WHEN c.quantity <= coalesce(lb.ly_quantity, 0) * 0.90 THEN 'Declining' ELSE 'Stable' END AS trend, ${common}, lb.ly_pick_days, c.pick_days, lb.ly_txn_count, c.txn_count, lb.ly_peak_month, c.peak_month AS "Peak_Month",`
      + ` c.peak_share_pct AS "Peak_Month_%", lb.ly_active_months AS "Ly_Active_Months", c.active_months AS "Active_Months", ${date("lb.ly_first_sale_date")} AS ly_first_sale_date, ${date("c.first_sale_date")} AS first_sale_date,`
      + ` ${date("lb.ly_last_sale_date")} AS ly_last_sale_date, ${date("c.last_sale_date")} AS last_sale_date, ${recent} AS recent_sale_days, ${fsn} AS "FSN_Class", c.sale_value, (c.abc_cum_pct * 100)::numeric(6,2) AS abc_cum_pct,`
      + ` c.min_qty AS "Min_Qty", (c.clsg_stock - c.min_qty)::numeric(18,2) AS qty_above_min, c.avg_daily_qty, (c.clsg_stock / nullif(c.avg_daily_qty, 0))::numeric(10,1) AS days_of_cover, ${stockStatus} AS "Stock_Status"`
      + ` FROM ranked c LEFT JOIN lybase lb ON lb.prod_id = c.prod_id ORDER BY c.seasonal_flag, c.quantity DESC NULLS LAST, c.prod_id`
    : `SELECT row_number() OVER (ORDER BY c.seasonal_flag, c.quantity DESC NULLS LAST, c.prod_id) AS "Row_No", c.name AS "Item", c.quantity, ${share} AS pct_of_total, ${common}, c.pick_days, c.txn_count, c.peak_month AS "Peak_Month",`
      + ` c.peak_share_pct AS "Peak_Month_%", c.active_months AS "Active_Months", ${date("c.first_sale_date")} AS first_sale_date, ${date("c.last_sale_date")} AS last_sale_date, ${recent} AS recent_sale_days, ${fsn} AS "FSN_Class", c.sale_value,`
      + ` c.min_qty AS "Min_Qty", (c.clsg_stock - c.min_qty)::numeric(18,2) AS qty_above_min, c.avg_daily_qty, (c.clsg_stock / nullif(c.avg_daily_qty, 0))::numeric(10,1) AS days_of_cover, ${stockStatus} AS "Stock_Status"`
      + ` FROM ranked c ORDER BY c.seasonal_flag, c.quantity DESC NULLS LAST, c.prod_id`;

  const argument: unknown[] = [from, upto, days, slabs.length > 0 ? slabs : [0]];
  // Parameters that no part names are left out (PostgreSQL types each one it finds).
  const sql = `WITH ${parts.join(", ")} ${select}`;
  const used = [1, 2, 3, 4].filter((at) => new RegExp(`\\$${at}\\b`).test(sql));
  const renumbered = used.reduce((text, at, index) => text.replace(new RegExp(`\\$${at}\\b`, "g"), `$${index + 1}`), sql);
  return tableFromResult(await runReportSql(loader, renumbered, used.map((at) => argument[at - 1])));
}
