import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 187: STOCK WITH AGEING (REPORT_RPI_STOCK_AGEING, SP_FRT_RPT_STOCK_AGEING; SPECIAL > Extra Report (RP) > Stock With Ageing): each inventory product of the
 * ticked products / addons with its closing stock on Upto (the year's opening in the product's report unit plus the year's movement, the rate-difference
 * notes left out) and how old that stock is: the closing is set against the product's additions, newest first (an addition counts its quantity less what was
 * set off against it), each lot adding its quantity to the age column of its days (Upto less the entry date, and one) until the closing is used up; what
 * remains older than the year goes to the last column (Days 99999). The columns are the day gaps of Setup (STOCK_DAYS_GAP, e.g. 0-7, 8-15 ... 91-ABOVE), each
 * with its value (the quantity x Rate, the last rate of an addition, else the opening rate); Negative / Neg_Amt for a negative closing; Amount the closing's
 * value; Days the age of the oldest lot used. Products with a closing of 0 are left out.
 * The previous year's database (the procedure goes there for stock older than the year) is not read: it is not given to the web, so that stock is in the last
 * column. Licence 21 (Rishabh) takes the rate from the price list (then the last purchase of the year, the opening rate, the report rate) and adds the pack, the
 * boxes and loose pieces of the closing and the quantity and value that is over 90 days old.
 * One read of each: the products, the movement, the additions, the rates; the lots are set off in memory.
 */
export async function stockAgeing(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const boxes = call.licence === 21;
  const vinayak = call.licence === 2;
  const upto = call.upto;
  const uptoText = desktopDate(upto);
  const start = desktopDate(call.tarikh1);
  const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  const ids = (keys: string) => (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys.trim()) ? keys.trim() : "");
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "");
  if (levels.some((at) => /aentry/i.test(call.addon[at]))) throw new ReportRefusal("An entry addon group is not available in the web version of this report yet.", "Not ported yet");
  const aliasOf = (at: number) => /as\s+"([^"]+)"/i.exec(call.headingAddon[at])?.[1] ?? `ADDON${at + 1}`;
  const keyOf = (at: number) => call.addon[at].trim().replace(/^(adata)\.txt_/i, "$1.key_");

  // The age columns of Setup.
  const gaps = (await runReportSql(loader, `SELECT stkdays_gap_key, btrim(stk_days_from) AS gap_from, btrim(stk_days_upto) AS gap_upto FROM ${db}stock_days_gap WHERE btrim(stk_days_from) <> '' AND btrim(stk_days_upto) <> '' ORDER BY stkdays_gap_key`)).rows;
  const slots: { from: string; upto: string }[] = [];
  for (const row of gaps) slots[num(row.stkdays_gap_key) - 1] = { from: toText(row.gap_from), upto: toText(row.gap_upto) };
  let count = 0;
  while (count < slots.length && slots[count] !== undefined) count += 1;
  const columns = slots.slice(0, count).map((slot) => ({ ...slot, name: `Days_${slot.from}_${slot.upto}`, amount: `Days${slot.upto}_AMT` }));
  const bucketOf = (age: number) => {
    for (let at = 0; at < columns.length; at += 1) {
      const from = Number(columns[at].from);
      if (at === columns.length - 1) return age >= from ? at : -1;
      if (age >= from && age <= Number(columns[at].upto)) return at;
    }
    return -1;
  };

  // The notes of rate difference are not stock (their book's type).
  const noteType = num((await runReportSql(loader, `SELECT book_key FROM ${db}book_properties WHERE stkm_pos = 'A' AND stkm_id = 'NR' ORDER BY stkmodule LIMIT 1`)).rows[0]?.book_key);

  // The products.
  const open = vinayak ? "prodbal.open_qty3"
    : "coalesce(CASE WHEN product.rep1_uom = product.pcs_uom THEN prodbal.open_pcs WHEN product.rep1_uom = product.qty1_uom THEN prodbal.open_qty1 WHEN product.rep1_uom = product.qty2_uom THEN prodbal.open_qty2"
    + " WHEN product.rep1_uom = product.qty3_uom THEN prodbal.open_qty3 WHEN product.rep1_uom = product.pack_uom THEN prodbal.open_pack WHEN product.rep1_uom = product.weight_uom THEN prodbal.open_weight ELSE prodbal.open_pcs END, 0)";
  const addonKeys = levels.filter((at) => ids(call.selectKey[at]) !== "").map((at) => ` AND ${keyOf(at)} IN ${ids(call.selectKey[at])}`).join("");
  const addonColumns = levels.map((at, index) => `, ${call.addon[at].trim()}::text AS a${index}`).join("");
  const order = [...levels.map((at) => call.addon[at].trim()), "product.prod_desc"].join(", ");
  const products = (await runReportSql(loader, `SELECT product.prod_key, product.prod_short, product.prod_desc${addonColumns}, ${open}::numeric AS opening, prodbal.open_rate::numeric AS open_rate, prodbal.rep_rate::numeric AS rep_rate, product.base_pack::numeric AS base_pack`
    + ` FROM ${db}product_master product LEFT JOIN ${db}prod_balance prodbal ON prodbal.prod_id = product.prod_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = product.prod_key`
    + ` WHERE product.prod_pos <> 'D' AND product.inventory = 'Y' AND prodbal.prec_flag = 'RP' AND prodbal.year_id = $1${ids(call.selectKey[4]) !== "" ? ` AND product.prod_key IN ${ids(call.selectKey[4])}` : ""}${addonKeys} ORDER BY ${order}`, [call.yearId])).rows;
  const keys = products.map((row) => num(row.prod_key));

  // The year's movement, the additions (newest first) and the last rate of each product.
  const module = "btrim(prodled.trn_module)";
  const quantity = vinayak ? "round(prodled.trn_qty3 - (prodled.ag_qty / prodled.quantity * prodled.trn_qty3), 4)" : `CASE WHEN ${module} IN ('JOB-OUT', 'JOB-IN') THEN prodled.quantity ELSE prodled.quantity - prodled.ag_qty END`;
  const movement = new Map<number, number>();
  const lots = new Map<number, { date: Date; qty: number }[]>();
  const rates = new Map<number, number>();
  const purchaseRates = new Map<number, number>();
  if (keys.length > 0) {
    const common = `prodled.il_pos <> 'D' AND prodled.inventory = 'Y' AND (prodled.quantity - prodled.ag_qty > 0 OR ${module} IN ('JOB-OUT', 'JOB-IN')) AND prodled.il_date BETWEEN $1::date AND $2::date AND prodled."TYPE"::numeric <> $3 AND prodled.prod_id = ANY($4::int[])`;
    const argument = [start, uptoText, noteType, keys];
    for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, sum(CASE WHEN prodled.stock_nat = 'A' THEN ${quantity} ELSE -(${vinayak ? quantity : `CASE WHEN ${module} = 'JOB-OUT' THEN prodled.quantity ELSE prodled.quantity - prodled.ag_qty END`}) END) AS moved`
      + ` FROM ${db}prod_ledger prodled WHERE ${common} GROUP BY prodled.prod_id`, argument)).rows) movement.set(num(row.prod_id), num(row.moved));
    for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, prodled.il_date, ${quantity}::numeric AS qty FROM ${db}prod_ledger prodled WHERE ${common} AND prodled.stock_nat = 'A' AND prodled.il_pos = 'A' ORDER BY prodled.prod_id, prodled.il_date DESC, prodled.il_key DESC`, argument)).rows) {
      const list = lots.get(num(row.prod_id));
      const lot = { date: row.il_date as Date, qty: num(row.qty) };
      if (list) list.push(lot); else lots.set(num(row.prod_id), [lot]);
    }
    if (boxes) {
      for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, round(pl_srate::numeric, 2) AS rate FROM ${db}pricelist WHERE pl_srate::numeric > 0 AND pl_pos <> 'D' AND prod_id = ANY($1::int[]) ORDER BY prod_id, pl_wefrom DESC`, [keys])).rows) rates.set(num(row.prod_id), num(row.rate));
      for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, round(rate::numeric, 2) AS rate FROM ${db}prod_ledger WHERE il_pos <> 'D' AND il_date BETWEEN $1::date AND $2::date AND book = 13 AND led_id IS NOT NULL AND prod_id = ANY($3::int[]) ORDER BY prod_id, il_date DESC, il_key DESC`, [start, uptoText, keys])).rows) purchaseRates.set(num(row.prod_id), num(row.rate));
    } else {
      for (const row of (await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, round(rate::numeric, 2) AS rate FROM ${db}prod_ledger WHERE rate::numeric > 0 AND il_pos <> 'D' AND stock_nat = 'A' AND prod_id = ANY($1::int[]) ORDER BY prod_id, il_date DESC`, [keys])).rows) rates.set(num(row.prod_id), num(row.rate));
    }
  }

  const table = new ResultTable();
  for (const column of ["PROD_KEY", "CODE", "ITEM", ...(boxes ? ["PROD_PACK"] : [])]) table.addColumn(column);
  for (const at of levels) table.addColumn(aliasOf(at));
  for (const column of ["Negative", "Neg_Amt"]) table.addColumn(column);
  for (const column of columns) { table.addColumn(column.name); table.addColumn(column.amount); }
  for (const column of ["CLSG_STK", "Days", "Rate", "Amount", ...(boxes ? ["CLSG_BOX_QTY", "CLSG_LOOSE_QTY", "TOTALQTY_ABOVE_90", "TOTALAMT_ABOVE_90"] : [])]) table.addColumn(column);
  for (const column of table.columns) if (!["PROD_KEY", "CODE", "ITEM", "Days", ...levels.map(aliasOf)].includes(column)) table.setKind(column, "decimal");
  table.setKind("Days", "int");

  for (const [index, product] of products.entries()) {
    const key = num(product.prod_key);
    const closing = round2(num(product.opening) + (movement.get(key) ?? 0));
    let useRate = rates.get(key) ?? 0;
    if (boxes) {
      // The price list, else the last purchase of the year, else the opening rate, else the report rate.
      if (useRate === 0) useRate = purchaseRates.get(key) ?? 0;
      if (useRate === 0 && num(product.open_rate) > 0) useRate = round2(num(product.open_rate));
      if (useRate === 0 && num(product.rep_rate) > 0) useRate = round2(num(product.rep_rate));
    } else if (useRate === 0) useRate = round2(num(product.open_rate));
    const row: ResultRow = { PROD_KEY: key, CODE: toText(product.prod_short), ITEM: toText(product.prod_desc), Negative: 0, Neg_Amt: 0, CLSG_STK: closing, Days: 0, Rate: useRate, Amount: 0 };
    levels.forEach((at, position) => { row[aliasOf(at)] = toText(product[`a${position}`]); });
    for (const column of columns) { row[column.name] = 0; row[column.amount] = 0; }
    let left = closing;
    if (left > 0) {
      for (const lot of lots.get(key) ?? []) {
        const age = dayNumber(upto) - dayNumber(lot.date) + 1;
        row.Days = age;
        const at = bucketOf(age);
        const taken = left > lot.qty ? lot.qty : left;
        if (at >= 0) row[columns[at].name] = round2(num(row[columns[at].name]) + taken);
        left = round2(left - lot.qty);
        if (left <= 0) { left = 0; break; }
      }
      if (left > 0) {
        row.Days = 99999;
        const at = bucketOf(99999);
        if (at >= 0) row[columns[at].name] = round2(num(row[columns[at].name]) + left);
      }
    }
    if (left < 0) row.Negative = left;
    if (closing < 0) row.Negative = closing;
    if (boxes) row.PROD_PACK = product.base_pack === null ? null : num(product.base_pack);
    row.Amount = round2(closing * useRate);
    row.Neg_Amt = round2(num(row.Negative) * useRate);
    for (const column of columns) row[column.amount] = round2(num(row[column.name]) * useRate);
    void index;
    if (boxes) {
      // Boxes (rounded) and loose pieces of the closing (a pack above 1), and what is over 90 days old (null when none).
      const pack = product.base_pack === null ? 0 : num(product.base_pack);
      row.CLSG_BOX_QTY = 0;
      row.CLSG_LOOSE_QTY = 0;
      if (pack > 1) { row.CLSG_BOX_QTY = Math.round(Math.trunc(closing) / pack); row.CLSG_LOOSE_QTY = round2(closing - Math.round(pack * num(row.CLSG_BOX_QTY))); }
      row.TOTALQTY_ABOVE_90 = num(row.Days) > 90 ? closing : null;
      row.TOTALAMT_ABOVE_90 = num(row.Days) > 90 ? num(row.Amount) : null;
    }
    if (closing !== 0) table.rows.push(row);
  }
  return table;
}

/** The fixed age columns of the Stock report's "Stock With Ageing Required" (the procedure's non-187 form): 0-30, 31-60, 61-90, 91-120, 121-150, 151-180 and 181 or more days. */
export const STOCK_AGE_BUCKETS = ["Days_0_To_30", "Days_31_To_60", "Days_61_To_90", "Days_91_To_120", "Days_121_To_150", "Days_151_To_180", "Days_181_To_Above"] as const;

/**
 * The closing of each product (> 0) set against its additions of the year, newest first (an addition counts its quantity less what was set off against it): the
 * quantity in each age column (the days from the entry to Upto, and one; 99999 for what is older than the year) and Days, the age of the oldest lot used.
 */
const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

export async function stockLots(loader: Loader, db: string, upto: Date, yearStart: Date, noteType: number, closings: ReadonlyMap<number, number>): Promise<Map<number, { days: number; buckets: number[]; opening: number }>> {
  const result = new Map<number, { days: number; buckets: number[]; opening: number }>();
  // A product closing below nil has all of it in Opening; the rest are set against their additions.
  for (const [key, closing] of closings) if (closing < 0) result.set(key, { days: 0, buckets: STOCK_AGE_BUCKETS.map(() => 0), opening: round2(closing) });
  const keys = [...closings.entries()].filter(([, closing]) => closing > 0).map(([key]) => key);
  if (keys.length === 0) return result;
  const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const lots = new Map<number, { date: Date; qty: number }[]>();
  const module = "btrim(prodled.trn_module)";
  for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, prodled.il_date, (CASE WHEN ${module} IN ('JOB-OUT', 'JOB-IN') THEN prodled.quantity ELSE prodled.quantity - prodled.ag_qty END)::numeric AS qty`
    + ` FROM ${db}prod_ledger prodled WHERE prodled.il_pos = 'A' AND prodled.inventory = 'Y' AND prodled.stock_nat = 'A' AND (prodled.quantity - prodled.ag_qty > 0 OR ${module} IN ('JOB-OUT', 'JOB-IN'))`
    + ` AND prodled.il_date BETWEEN $1::date AND $2::date AND prodled."TYPE"::numeric <> $3 AND prodled.prod_id = ANY($4::int[]) ORDER BY prodled.prod_id, prodled.il_date DESC, prodled.il_key DESC`,
  [desktopDate(yearStart), desktopDate(upto), noteType, keys])).rows) {
    const list = lots.get(num(row.prod_id));
    const lot = { date: row.il_date as Date, qty: num(row.qty) };
    if (list) list.push(lot); else lots.set(num(row.prod_id), [lot]);
  }
  const bucketOf = (age: number) => (age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : age <= 120 ? 3 : age <= 150 ? 4 : age <= 180 ? 5 : 6);
  for (const key of keys) {
    let left = round2(closings.get(key) ?? 0);
    const buckets = STOCK_AGE_BUCKETS.map(() => 0);
    let days = 0;
    for (const lot of lots.get(key) ?? []) {
      const age = dayNumber(upto) - dayNumber(lot.date) + 1;
      days = age;
      const at = bucketOf(age);
      buckets[at] = round2(buckets[at] + (left > lot.qty ? lot.qty : left));
      left = round2(left - lot.qty);
      if (left <= 0) { left = 0; break; }
    }
    // What is left after the year's additions is the opening stock's: its own Opening column, not an age column.
    if (left > 0) days = 99999;
    result.set(key, { days, buckets, opening: left > 0 ? left : 0 });
  }
  return result;
}
