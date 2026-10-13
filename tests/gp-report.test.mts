import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { gpOpeningValue, matchGp, summariseGp } = await import("../lib/report/gp.ts");

const from = new Date(2026, 3, 1);
const product = { key: 7, desc: "PIPE", opening: 10, rate: 50 };
const stock = (date: Date, no: string, qty: number, rate: number) => ({ product: 7, date, no, qty, rate });
const sale = (date: Date, no: string, qty: number, rate: number) => ({ product: 7, code: 3, name: "RAM TRADERS", date, no, qty, rate });

test("GP report: a sale takes the opening first, then the stock lines in order, a row for each piece", () => {
  const rows = matchGp([product], [stock(new Date(2026, 3, 5), "P/1", 20, 60)], [sale(new Date(2026, 3, 10), "S/1", 15, 80), sale(new Date(2026, 3, 12), "S/2", 10, 80)], from);
  assert.deepEqual(rows.map((row) => [row.SALE_NO, row.PURCH_NO, row.SALE_QTY, row.PURCH_QTY, row.PURCH_RATE, row.SALE_VALUE, row.PURCH_VALUE, row.PROFIT_AMOUNT, row.PROFIT_PERC]), [
    ["S/1", "OPENING", 10, 10, 50, 800, 500, 300, 60],
    ["S/1", "P/1", 5, 20, 60, 400, 300, 100, 33.33],
    ["S/2", "P/1", 10, 20, 60, 800, 600, 200, 33.33],
  ]);
  assert.equal(rows[0].PURCH_DATE, "01-Apr-26", "the opening is dated From");
  assert.equal(rows[1].SORTING_COL, "PIPE20260405");
});

test("GP report: once the stock is used up the product's remaining sales are left out", () => {
  const rows = matchGp([{ ...product, opening: 0 }], [stock(new Date(2026, 3, 5), "P/1", 4, 60)], [sale(new Date(2026, 3, 10), "S/1", 6, 80), sale(new Date(2026, 3, 11), "S/2", 3, 80)], from);
  assert.deepEqual(rows.map((row) => [row.SALE_NO, row.SALE_QTY]), [["S/1", 4]]);
});

test("GP report: a loss shows no percentage; products without a balance row bring nothing", () => {
  const rows = matchGp([{ ...product, opening: 5, rate: 100 }], [], [sale(new Date(2026, 3, 10), "S/1", 5, 80), { ...sale(new Date(2026, 3, 10), "S/9", 5, 80), product: 99 }], from);
  assert.deepEqual(rows.map((row) => [row.SALE_NO, row.PROFIT_AMOUNT, row.PROFIT_PERC]), [["S/1", -100, 0]]);
});

test("GP report: the cursors take lines in the order of their dd-Mon-yy text, as the procedure", () => {
  // 02-Apr-26 sorts before 10-Mar-26 as text, so the April purchase is used first.
  const rows = matchGp([{ ...product, opening: 0 }], [stock(new Date(2026, 2, 10), "P/MAR", 5, 40), stock(new Date(2026, 3, 2), "P/APR", 5, 60)], [sale(new Date(2026, 3, 20), "S/1", 5, 80)], from);
  assert.equal(rows[0].PURCH_NO, "P/APR");
});

test("GP report Summary: a line a product, sale rate and purchase rate", () => {
  const rows = matchGp([product], [stock(new Date(2026, 3, 5), "P/1", 20, 60)], [sale(new Date(2026, 3, 10), "S/1", 15, 80), sale(new Date(2026, 3, 12), "S/2", 10, 80)], from);
  assert.deepEqual(summariseGp(rows), [
    { NAME: "PIPE", SALE_RATE: 80, SALE_QTY: 10, SALE_VALUE: 800, PURCH_RATE: 50, PURCH_VALUE: 500, PROFIT_AMT: 300, PROFIT_PERC: 60 },
    { NAME: "PIPE", SALE_RATE: 80, SALE_QTY: 15, SALE_VALUE: 1200, PURCH_RATE: 60, PURCH_VALUE: 900, PROFIT_AMT: 300, PROFIT_PERC: 33.33 },
  ]);
});

test("GP report: an opening at a later From is valued at the latest purchases, the rest at the year's rate", () => {
  const purchases = [{ date: new Date(2026, 4, 2), qty: 6, value: 360 }, { date: new Date(2026, 4, 20), qty: 4, value: 280 }];
  // 20-May-26 first (4 at 70), then 02-May-26 (6 at 60) covers 6 of the remaining 8, the last 2 at the year's 50.
  assert.deepEqual(gpOpeningValue(12, 50, purchases), { value: 280 + 360 + 100, rate: 740 / 12 });
  assert.deepEqual(gpOpeningValue(7, 50, purchases), { value: 280 + 180, rate: 460 / 7 });
});
