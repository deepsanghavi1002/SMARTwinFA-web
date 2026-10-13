import { dateStyle112, dateStyle6 } from "./formula";
import { decimalRound } from "./run";

/**
 * GP Report (report 27, SP_REPORT_STANDARD branch 27): the first in first out matching of sale lines against the opening and stock-in lines,
 * apart from the database so it can be tested on its own. The queries that feed it are gpReport in reportStandard.ts.
 */

/** A product of TEMP_TABLE_PROD_OPENING: its opening at From and the rate it is valued at. */
export type GpProduct = { key: number; desc: string; opening: number; rate: number };
/** A stock-in line of the period (TEMP_TABLE_PROD_PURCHASE). */
export type GpStock = { product: number; date: Date; no: string; qty: number; rate: number };
/** A sale line of the period (TEMP_TABLE_PROD_SALE). */
export type GpSale = { product: number; code: number; name: string; date: Date; no: string; qty: number; rate: number };
/** A row of TEMP_TABLE_PROFIT. */
export type GpRow = {
  PROD_ID: number; CODE: number; NAME: string; DESCRIPTION: string; SALE_DATE: string; SALE_NO: string; SALE_QTY: number; SALE_RATE: number; SALE_VALUE: number;
  PURCH_DATE: string; PURCH_NO: string; PURCH_QTY: number; PURCH_RATE: number; PURCH_VALUE: number; PROFIT_PERC: number; PROFIT_AMOUNT: number;
  SMART_SELECTED_PRODUCT: string; SMART_NAME: string; SORTING_COL: string;
};

const round2 = (value: number): number => decimalRound(value, 2);
/** ORDER BY a dd-Mon-yy text column (the cursors' order), ties in the order read. */
const byDateText = <T extends { date: Date }>(lines: readonly T[], descending = false): T[] =>
  lines.map((line, index) => ({ line, index, key: dateStyle6(line.date).toUpperCase() }))
    .sort((a, b) => (a.key === b.key ? a.index - b.index : (a.key < b.key ? -1 : 1) * (descending ? -1 : 1)))
    .map((entry) => entry.line);

/**
 * The opening at From of a product valued at the purchases before Upto (TMP_PRODUCT_BET_OPEN): latest (by dd-Mon-yy text) first, each
 * taken whole while the opening covers it, the last in part at its own rate; what they do not cover goes at the year's opening rate.
 * The rate is then the value over the opening. Every step is numeric(18,2).
 */
export function gpOpeningValue(opening: number, openRate: number, purchases: readonly { date: Date; qty: number; value: number }[]): { value: number; rate: number } {
  let closing = round2(opening);
  let value = 0;
  for (const purchase of byDateText(purchases, true)) {
    const qty = round2(purchase.qty);
    const amount = round2(purchase.value);
    if (closing >= qty) { closing = round2(closing - qty); value = round2(value + amount); }
    else {
      if (amount !== 0 && qty !== 0) value = round2(value + (amount / qty) * closing);
      closing = 0;
    }
    if (closing === 0) break;
  }
  if (closing > 0) value = round2(value + round2(openRate) * closing);
  return { value, rate: value !== 0 && opening !== 0 ? value / opening : openRate };
}

/** The procedure's matching loop (TMP_PRODUCT_OPEN / TMP_SALE_OPEN / TMP_PURCHASE_OPEN): the rows of TEMP_TABLE_PROFIT, products in key order. */
export function matchGp(products: readonly GpProduct[], stock: readonly GpStock[], sales: readonly GpSale[], from: Date): GpRow[] {
  const rows: GpRow[] = [];
  const stockOf = new Map<number, GpStock[]>();
  const salesOf = new Map<number, GpSale[]>();
  for (const line of stock) stockOf.set(line.product, [...(stockOf.get(line.product) ?? []), line]);
  for (const line of sales) salesOf.set(line.product, [...(salesOf.get(line.product) ?? []), line]);
  for (const product of [...products].sort((a, b) => a.key - b.key)) {
    const productSales = byDateText(salesOf.get(product.key) ?? []);
    const productStock = byDateText(stockOf.get(product.key) ?? []);
    let opening = round2(product.opening);
    const openingRate = round2(product.rate);
    let nextStock = 0;
    let balancePurchase = 0;
    let fromOpening = false;
    let openingQty = 0;
    let line: GpStock | undefined;
    let purchaseRate = 0;
    let exhausted = false;
    for (const sale of productSales) {
      if (exhausted) break;
      const saleRate = round2(sale.rate);
      let balanceSale = round2(sale.qty);
      while (balanceSale > 0) {
        if (balancePurchase <= 0) {
          if (opening > 0) {
            fromOpening = true;
            openingQty = opening;
            purchaseRate = openingRate;
            balancePurchase = opening;
          } else {
            line = productStock[nextStock++];
            fromOpening = false;
            if (!line) { exhausted = true; break; }
            balancePurchase = round2(line.qty);
            purchaseRate = round2(line.rate);
          }
        }
        if (balancePurchase <= 0) continue;
        const entry = Math.min(balanceSale, balancePurchase);
        const saleValue = round2(entry * saleRate);
        const purchaseValue = round2(entry * purchaseRate);
        const profit = round2(saleValue - purchaseValue);
        const perc = profit > 0 && purchaseValue > 0 ? round2((profit / purchaseValue) * 100) : 0;
        if (opening > 0) opening = round2(opening - entry);
        balancePurchase = round2(balancePurchase - entry);
        const stockDate = fromOpening || !line ? from : line.date;
        rows.push({
          PROD_ID: product.key, CODE: sale.code, NAME: sale.name, DESCRIPTION: product.desc, SALE_DATE: dateStyle6(sale.date), SALE_NO: sale.no,
          SALE_QTY: entry, SALE_RATE: saleRate, SALE_VALUE: saleValue,
          PURCH_DATE: dateStyle6(stockDate), PURCH_NO: fromOpening || !line ? "OPENING" : line.no, PURCH_QTY: fromOpening || !line ? openingQty : round2(line.qty), PURCH_RATE: purchaseRate, PURCH_VALUE: purchaseValue,
          PROFIT_PERC: perc, PROFIT_AMOUNT: profit, SMART_SELECTED_PRODUCT: product.desc, SMART_NAME: sale.name, SORTING_COL: `${product.desc}${dateStyle112(stockDate)}`,
        });
        balanceSale = round2(balanceSale - entry);
      }
    }
  }
  return rows;
}

/** Summary: a row a product, sale rate and purchase rate, with the profit and its percentage on the purchase value; ordered by name. */
export function summariseGp(rows: readonly GpRow[]): Record<string, unknown>[] {
  type Line = { NAME: string; SALE_RATE: number; SALE_QTY: number; SALE_VALUE: number; PURCH_RATE: number; PURCH_VALUE: number; PROFIT_AMT: number; PROFIT_PERC: number };
  const lines = new Map<string, Line>();
  for (const row of rows) {
    const key = JSON.stringify([row.DESCRIPTION.toUpperCase(), row.SALE_RATE, row.PURCH_RATE]);
    const line = lines.get(key) ?? { NAME: row.DESCRIPTION, SALE_RATE: row.SALE_RATE, SALE_QTY: 0, SALE_VALUE: 0, PURCH_RATE: row.PURCH_RATE, PURCH_VALUE: 0, PROFIT_AMT: 0, PROFIT_PERC: 0 };
    line.SALE_QTY = round2(line.SALE_QTY + row.SALE_QTY);
    line.SALE_VALUE = round2(line.SALE_VALUE + row.SALE_VALUE);
    line.PURCH_VALUE = round2(line.PURCH_VALUE + row.PURCH_VALUE);
    lines.set(key, line);
  }
  const result = [...lines.values()];
  for (const line of result) {
    line.PROFIT_AMT = round2(line.SALE_VALUE - line.PURCH_VALUE);
    line.PROFIT_PERC = line.PURCH_VALUE > 0 ? round2((line.PROFIT_AMT * 100) / line.PURCH_VALUE) : 0;
  }
  return result.sort((a, b) => a.NAME.localeCompare(b.NAME, "en", { sensitivity: "base" }) || a.SALE_RATE - b.SALE_RATE || a.PURCH_RATE - b.PURCH_RATE);
}
