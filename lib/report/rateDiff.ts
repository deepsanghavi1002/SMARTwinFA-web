import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 122: SALES NET RATE TO DP DIFFERENCE (REPORT_SHAH_RATE_DIFFERANCE, SP_FRT_RPT_SHAH_RATE_DIFF; SPECIAL > Extra Report (RP)).
 *
 * The sale lines (book 8) of the period (the format Sale: lines without a process; Challan: the order-out lines that have one), each with its
 * net rate (the line's amount before the taxes of the year's first sale slab, over the quantity; the line's own rate when it has none) against
 * the dealer price (DP) in force on its date (the latest price list sale rate): DP_RATE, VARIANCE (DP less net rate, when both are above 0),
 * VARIANCE_% (of the DP, when the variance is above 0), the value at the net rate (ACT_VALUE), at the DP (DP_VALUE) and their DIFF_VALUE, by party.
 * One read. The procedure's join of the product's addon row (not used) would repeat the lines of a product that has two; it is left out.
 */
const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

export async function rateDiff(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const challan = call.formating.toUpperCase() === "CHALLAN";
  const slab = (await runReportSql(loader, `SELECT slab_key FROM ${db}slab_master WHERE slab_pos = 'P' AND slab_fromdt = $1::date AND slab_active = 'Y' AND slab_master = 'Y' AND book = 8 ORDER BY slab_order LIMIT 1`, [desktopDate(call.tarikh1)])).rows[0];
  const rows = (await runReportSql(loader, `SELECT prodled.il_key, prodled.prod_id, prodled.il_date, prodled.full_docno, btrim(ac.name) AS name, prodmas.prod_desc, round(prodled.quantity::numeric, 2) AS quantity, round(prodled.rate::numeric, 2) AS rate`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}account ac ON ac.code = prodled.code`
    + ` WHERE prodled.book = 8 AND prodled.il_pos = 'A' AND ac.a_pos <> 'D' AND prodmas.prod_pos <> 'D' AND ${challan ? "btrim(prodled.trn_module) = 'ORD-OUT' AND prodled.process_id IS NOT NULL" : "prodled.process_id IS NULL"}`
    + ` AND prodled.il_date >= $1::date AND prodled.il_date <= $2::date ORDER BY prodled.il_date, prodled.il_key`, [desktopDate(call.from), desktopDate(call.upto)])).rows;
  // The amount before the slab's taxes of each line and the price lists, each read once (neither table is indexed by the line: a lookup a line timed out).
  const netOf = new Map<number, number>();
  if (slab && rows.length > 0) for (const row of (await runReportSql(loader, `SELECT il_id, s_lastot::numeric - slab_amt::numeric AS net FROM ${db}ledger_ext WHERE slab_id = ${num(slab.slab_key)} AND il_id IS NOT NULL`)).rows) if (!netOf.has(num(row.il_id))) netOf.set(num(row.il_id), num(row.net));
  const prices = new Map<number, { from: number; upto: number | null; rate: number }[]>();
  const day = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  if (rows.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT prod_id, pl_wefrom, pl_weupto, pl_srate::numeric AS rate FROM ${db}pricelist WHERE pl_pos <> 'D' AND pl_srate::numeric > 0 AND pl_wefrom IS NOT NULL AND prod_id = ANY($1::int[]) ORDER BY prod_id, pl_wefrom DESC`, [[...new Set(rows.map((row) => num(row.prod_id)))]])).rows) {
      const list = prices.get(num(row.prod_id)) ?? [];
      list.push({ from: day(row.pl_wefrom as Date), upto: row.pl_weupto === null ? null : day(row.pl_weupto as Date), rate: num(row.rate) });
      prices.set(num(row.prod_id), list);
    }
  }

  const table = new ResultTable();
  for (const column of ["DATE", "full_docno", "name", "prod_desc", "Quantity", "RATE", "DP_RATE", "VARIANCE", "VARIANCE_%", "ACT_VALUE", "DP_VALUE", "DIFF_VALUE"]) table.addColumn(column);
  for (const column of ["Quantity", "RATE", "DP_RATE", "VARIANCE", "VARIANCE_%", "ACT_VALUE", "DP_VALUE", "DIFF_VALUE"]) table.setKind(column, "decimal");
  const out = rows.map((row, index) => {
    const quantity = num(row.quantity);
    const lineDay = day(row.il_date as Date);
    const dp = r2((prices.get(num(row.prod_id)) ?? []).find((price) => price.from <= lineDay && (price.upto === null || price.upto >= lineDay))?.rate ?? 0);
    let rate = num(row.rate);
    const netAmount = netOf.get(num(row.il_key)) ?? 0;
    if (netAmount !== 0 && quantity !== 0) rate = r2(netAmount / quantity);
    const variance = rate > 0 && dp > 0 ? r2(dp - rate) : 0;
    const percent = variance > 0 && dp > 0 ? r2(variance / dp * 100) : 0;
    const actual = r2(rate * quantity);
    const dpValue = r2(dp * quantity);
    const date = row.il_date as Date;
    return { index, name: toText(row.name), row: {
      DATE: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`, full_docno: toText(row.full_docno), name: toText(row.name), prod_desc: toText(row.prod_desc),
      Quantity: quantity, RATE: rate, DP_RATE: dp, VARIANCE: variance, "VARIANCE_%": percent, ACT_VALUE: actual, DP_VALUE: dpValue, DIFF_VALUE: r2(dpValue - actual),
    } };
  });
  table.rows = out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.index - b.index).map((entry) => entry.row);
  return table;
}
