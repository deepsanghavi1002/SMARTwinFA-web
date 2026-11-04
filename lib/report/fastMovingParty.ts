import type { Loader } from "../master-program/load";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { tableFromResult } from "./library";
import { isoDay, keyList, priorYearDatabase } from "./priorYear";
import { num, runReportSql } from "./run";

/**
 * 304: FAST MOVING SALE PARTY (SP_FRT_RPT_FAST_MOVING_SALE_PARTY; ANALYSIS > Fast Moving Sale Party). For each party with sales in the period: the sale amount (the
 * sale bills less the returns; with a sale tax slab, the bill's amount less the slab), its share of the total, the invoices, the quantity sold, the months it
 * bought in and the average a month, the first / last sale and the days since, the last receipt (date, amount, days since), the closing balance and how old the
 * oldest pending bill is (OS_Days: the pending bills, newest first, are set against the balance, the oldest bill left is the one counted), and its movement:
 * Fast (bought within 30 days and 5 invoices or 4 months), Medium (within 60 days, 2 invoices), Slow, or Return Only. By movement, then the amount.
 * "Last Year Compare" (CHK_LYCOMPARE) adds last year's amount, invoices, quantity, months and dates (the previous year's database), the growth and the trend.
 * The bills, the receipts and the balances are each read once and grouped by the database.
 */
export async function fastMovingParty(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const from = isoDay(call.from);
  const upto = isoDay(call.upto);
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "");
  if (levels.some((at) => /aentry/i.test(call.addon[at]))) throw new ReportRefusal("An entry addon group is not available in the web version of this report yet.", "Not ported yet");
  const keyOf = (at: number) => call.addon[at].trim().replace(/^(adata)\.txt_/i, "adata.key_");
  const compare = call.checkQuery.includes("CHK_LYCOMPARE");
  const prior = compare ? await priorYearDatabase(loader, call) : "";
  const withLastYear = compare && prior !== "";

  // The sale tax slab (the master slab of book 8): the amounts then come from the ledger extension, the slab taken off.
  const slab = num((await runReportSql(loader, `SELECT slab_key FROM ${db}slab_master WHERE slab_master = 'Y' AND slab_active = 'Y' AND book = 8 AND slab_link = 0 ORDER BY slab_key LIMIT 1`)).rows[0]?.slab_key);

  const accounts = keyList(call.selectKey[4]);
  const addonFilter = levels.filter((at) => keyList(call.selectKey[at]) !== "").map((at) => ` AND ${keyOf(at)} IN ${keyList(call.selectKey[at])}`).join("");
  const accountFilter = accounts !== "" ? ` AND led.code IN ${accounts}` : "";
  const sign = "CASE WHEN led.ag_book = 8 AND led.book = 16 THEN -1 ELSE 1 END";
  const money = slab > 0 ? "(ledext.s_lastot::numeric - ledext.slab_amt::numeric)" : "led.amount::numeric";

  /** The sale of each party for a period (its quantity from the product ledger), in the current database or last year's (its columns then start "ly_"). */
  const party = (schema: string, name: string, quantity: string, start: string, end: string, filters: string) => {
    const pre = schema === db ? "" : "ly_";
    return `${quantity} AS (SELECT code, sum(quantity::numeric - ag_qty::numeric) AS quantity FROM ${schema}prod_ledger WHERE il_pos = 'A' AND book = 8 AND inventory = 'Y' AND led_id > 0`
      + ` AND il_date BETWEEN ${start} AND ${end}${accounts !== "" ? ` AND code IN ${accounts}` : ""} GROUP BY code),`
      + ` ${name} AS (SELECT led.code AS code, ac.name AS name, ${pre === "" ? "acbal.closing::numeric AS clsg_bal, " : ""}sum((${sign}) * ${money}) AS ${pre}amount,`
      + ` count(DISTINCT CASE WHEN led.book = 8 THEN led.led_key END) AS ${pre}no_of_invoice, max(CASE WHEN led.book = 8 THEN led.doc_date END) AS ${pre}last_sale_date, min(CASE WHEN led.book = 8 THEN led.doc_date END) AS ${pre}first_sale_date,`
      + ` count(DISTINCT CASE WHEN led.book = 8 THEN extract(year FROM led.doc_date) * 100 + extract(month FROM led.doc_date) END) AS ${pre}active_months, coalesce(max(p.quantity), 0) AS ${pre}quantity`
      + ` FROM ${schema}ledger led LEFT JOIN ${schema}account ac ON ac.code = led.code LEFT JOIN ${schema}ac_balance acbal ON acbal.code = ac.code LEFT JOIN ${schema}addon_data adata ON adata.code = led.code`
      + ` LEFT JOIN ${quantity} p ON p.code = led.code${slab > 0 ? ` INNER JOIN ${schema}ledger_ext ledext ON ledext.led_id = led.led_key AND ledext.il_id IS NULL AND ledext.slab_id::int = ${slab}` : ""}`
      + ` WHERE led.doc_pos <> 'D' AND ac.a_pos <> 'D' AND led.doc_posting = 'P' AND ac.book = 2 AND led.doc_date BETWEEN ${start} AND ${end} AND led.book IN (8, 16, 11) AND (led.ag_book = 8 OR coalesce(led.ag_book, 0) = 0)${filters}`
      + ` GROUP BY led.code, ac.name${pre === "" ? ", acbal.closing" : ""})`;
  };

  const parts: string[] = [party(db, "base", "prod", "$1::date", "$2::date", addonFilter + accountFilter)];
  if (withLastYear) parts.push(party(prior, "ly_base", "lyprod", "($1::date - interval '1 year')", "($2::date - interval '1 year')", accountFilter));
  const text = parts.join(", ");

  // The balance, the pending bills and the age of the oldest bill the balance reaches.
  const age = [
    `calc AS (SELECT b.*, ($2::date - b.last_sale_date::date) AS recency_days FROM base b)`,
    `post AS (SELECT lp.post_code, sum(CASE WHEN lp.post_dbcode = 1 THEN lp.post_amt::numeric(18,2) ELSE 0 END) - sum(CASE WHEN lp.post_dbcode = 2 THEN lp.post_amt::numeric(18,2) ELSE 0 END) AS netamt`
    + ` FROM ${db}ledger led INNER JOIN ${db}ledger_post lp ON lp.led_id = led.led_key INNER JOIN calc c ON c.code = lp.post_code WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND led.doc_date <= $2::date GROUP BY lp.post_code)`,
    `closing AS (SELECT c.code, (coalesce(acbal.opening::numeric, 0) + coalesce(p.netamt, 0))::numeric(18,2) AS closing FROM calc c LEFT JOIN ${db}ac_balance acbal ON acbal.code = c.code LEFT JOIN post p ON p.post_code = c.code)`,
    `setoff AS (SELECT oc.out_ag_outid, sum(oc.out_setoff::numeric) AS clearamt FROM ${db}outclear oc WHERE oc.out_date <= $2::date GROUP BY oc.out_ag_outid)`,
    `bills AS (SELECT o.code, o.out_key, o.out_date, led.doc_date, (o.out_entryamt::numeric - coalesce(o.out_ly_setoff::numeric, 0) - coalesce(s.clearamt, 0))::numeric(18,2) AS pending`
    + ` FROM ${db}outclear o INNER JOIN calc c ON c.code = o.code INNER JOIN ${db}ledger led ON led.led_key = o.out_ledid LEFT JOIN setoff s ON s.out_ag_outid = o.out_key`
    + ` WHERE o.out_dbcode = 1 AND led.doc_pos <> 'D' AND led.doc_date <= $2::date AND (o.out_entryamt::numeric - coalesce(o.out_ly_setoff::numeric, 0))::numeric(18,2) <> 0)`,
    `layers AS (SELECT code, out_key, out_date, doc_date, pending, sum(pending) OVER (PARTITION BY code ORDER BY doc_date DESC NULLS LAST, out_key DESC NULLS LAST ROWS UNBOUNDED PRECEDING) AS runtot FROM bills WHERE pending > 0)`,
    `oldest AS (SELECT l.code, ($2::date - l.out_date::date) + 1 AS os_days, row_number() OVER (PARTITION BY l.code ORDER BY l.doc_date ASC NULLS FIRST, l.out_key ASC NULLS FIRST) AS rn FROM layers l INNER JOIN closing cl ON cl.code = l.code WHERE l.runtot - l.pending < cl.closing)`,
  ];

  const date = (value: string) => `to_char(${value}, 'DD-Mon-YY')`;
  const receipt = `LEFT JOIN LATERAL (SELECT led.doc_date, led.amount::numeric AS amount FROM ${db}ledger led WHERE led.code = c.code AND led.doc_pos = 'A' AND led.book IN (4, 6, 19, 13) AND led.ac_dbcode = 2 AND led.doc_posting = 'P' ORDER BY led.doc_date DESC NULLS LAST LIMIT 1) r ON true`;
  const movement = "CASE WHEN c.no_of_invoice = 0 THEN 'Return Only' WHEN c.recency_days <= 30 AND (c.no_of_invoice >= 5 OR c.active_months >= 4) THEN 'Fast' WHEN c.recency_days <= 60 AND c.no_of_invoice >= 2 THEN 'Medium' ELSE 'Slow' END";
  const average = "CASE WHEN c.active_months > 0 THEN (c.amount / c.active_months)::numeric(18,2) END";
  const finalColumns = withLastYear
    ? `c.name, ly.ly_amount, c.amount, coalesce(c.amount, 0) - coalesce(ly.ly_amount, 0) AS growth_amt,`
      + ` CASE WHEN coalesce(ly.ly_amount, 0) > 0 THEN ((coalesce(c.amount, 0) - coalesce(ly.ly_amount, 0)) * 100.0 / coalesce(ly.ly_amount, 0))::numeric(10,2) END AS "growth_%",`
      + ` CASE WHEN coalesce(ly.ly_amount, 0) <= 0 AND coalesce(c.amount, 0) > 0 THEN 'New' WHEN coalesce(c.amount, 0) <= 0 AND coalesce(ly.ly_amount, 0) > 0 THEN 'Lost' WHEN coalesce(c.amount, 0) >= coalesce(ly.ly_amount, 0) * 1.10 THEN 'Growing'`
      + ` WHEN coalesce(c.amount, 0) <= coalesce(ly.ly_amount, 0) * 0.90 THEN 'Declining' ELSE 'Stable' END AS trend, c.clsg_bal, coalesce(o.os_days, 0) AS "OS_Days",`
      + ` (ly.ly_amount * 100.0 / nullif(sum(ly.ly_amount) OVER (), 0))::numeric(9,2) AS ly_pct_of_total, (c.amount * 100.0 / nullif(sum(c.amount) OVER (), 0))::numeric(9,2) AS pct_of_total,`
      + ` ly.ly_no_of_invoice, c.no_of_invoice, ly.ly_quantity, c.quantity, ly.ly_active_months, c.active_months,`
      + ` CASE WHEN coalesce(ly.ly_active_months, 0) > 0 AND coalesce(ly.ly_amount, 0) > 0 THEN (coalesce(ly.ly_amount, 0) / coalesce(ly.ly_active_months, 0))::numeric(18,2) END AS ly_avg_month, ${average} AS cy_avg_month,`
      + ` ${date("ly.ly_first_sale_date")} AS ly_first_sale_date, ${date("c.first_sale_date")} AS first_sale_date, ${date("ly.ly_last_sale_date")} AS ly_last_sale_date, ${date("c.last_sale_date")} AS last_sale_date, c.recency_days AS recent_sale_days,`
      + ` ${date("r.doc_date")} AS last_recp_date, r.amount AS last_recp_amt, ($2::date - r.doc_date::date) AS recent_recp_days, ${movement} AS movement`
    : `c.name, c.amount, c.clsg_bal, coalesce(o.os_days, 0) AS "OS_Days", (c.amount * 100.0 / nullif(sum(c.amount) OVER (), 0))::numeric(9,2) AS pct_of_total, c.no_of_invoice, c.quantity, c.active_months, ${average} AS cy_avg_month,`
      + ` ${date("c.first_sale_date")} AS first_sale_date, ${date("c.last_sale_date")} AS last_sale_date, c.recency_days AS recent_sale_days, ${date("r.doc_date")} AS last_recp_date, r.amount AS last_recp_amt,`
      + ` ($2::date - r.doc_date::date) AS recent_recp_days, ${movement} AS movement`;
  const sql = `WITH ${text}, ${age.join(", ")}, final AS (SELECT ${finalColumns} FROM calc c LEFT JOIN closing cl ON cl.code = c.code LEFT JOIN oldest o ON o.code = c.code AND o.rn = 1`
    + `${withLastYear ? " LEFT JOIN ly_base ly ON ly.code = c.code" : ""} ${receipt})`
    + ` SELECT row_number() OVER (ORDER BY f.amount DESC NULLS LAST) AS row_no, f.* FROM final f ORDER BY CASE f.movement WHEN 'Fast' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Slow' THEN 3 ELSE 4 END, f.amount DESC NULLS LAST`;
  return tableFromResult(await runReportSql(loader, sql, [from, upto]));
}
