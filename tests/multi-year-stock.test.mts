import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { multiYearStock } = await import("../lib/report/multiYearStock.ts");

const product = (key: number, code: string, pos = "A", inventory = "Y") => ({ key, code, desc: `${code} desc`, pos, inventory });
const year = (from: string, upto: string, products: ReturnType<typeof product>[], opening: [number, number][], movement: [number, number, number, number][], quantity: [number, [number, number][]][] = []) => ({
  from: new Date(from), upto: new Date(upto), products,
  opening: new Map(opening), movement: new Map(movement.map(([key, add, less, net]) => [key, { add, less, net }])),
  quantity: new Map(quantity.map(([key, months]) => [key, new Map(months)])),
});

test("Multi Year Stock: the last year's products matched to the earlier year's live product by code; a product only the earlier year had is added", () => {
  const years = [
    year("2025-04-01", "2026-03-31", [product(1, "A"), product(2, "OLD"), product(3, "GONE", "D")], [[1, 10], [2, 5]], [[1, 4, 1, 3], [2, 0, 0, 0]]),
    year("2026-04-01", "2027-03-31", [product(7, "A"), product(8, "NOSTOCK", "A", "N")], [[7, 12]], [[7, 6, 2, 4]]),
  ];
  const table = multiYearStock(years, 1, false);
  assert.deepEqual(table.columns, ["PROD_CODE", "PROD_DESC", "Op_25_26", "Add_25_26", "Less_25_26", "Cl_25_26", "Op_26_27", "Add_26_27", "Less_26_27", "Cl_26_27"]);
  assert.deepEqual(table.rows.map((row) => Object.values(row)), [
    ["A", "A desc", 10, 4, 1, 13, 12, 6, 2, 16],
    // Added from the first year; the last year's columns stay blank (two years: nothing is filled in).
    ["OLD", "OLD desc", 5, 0, 0, 5, null, null, null, null],
  ]);
});

test("Multi Year Stock: Month Wise leaves the earlier years' products out", () => {
  const years = [
    year("2025-04-01", "2026-03-31", [product(2, "OLD")], [[2, 5]], []),
    year("2026-04-01", "2027-03-31", [product(7, "A")], [], []),
  ];
  assert.deepEqual(multiYearStock(years, 1, true).rows.map((row) => row.PROD_CODE), ["A"]);
});

test("Multi Year Stock, sale: a column a month, April first, then the year's total", () => {
  const years = [year("2026-04-01", "2027-03-31", [product(7, "A"), product(8, "B", "D")], [], [], [[7, [[0, 9], [4, 4], [1, 5]]]])];
  const table = multiYearStock(years, 2, true);
  assert.deepEqual(table.columns.slice(0, 5), ["PROD_CODE", "PROD_DESC", "Apr_26_27", "May_26_27", "Jun_26_27"]);
  assert.equal(table.columns[table.columns.length - 1], "Qty_26_27");
  assert.deepEqual(table.rows.map((row) => [row.PROD_CODE, row.Apr_26_27, row.May_26_27, row.Jan_26_27, row.Qty_26_27]), [["A", 4, 0, 5, 9]]);
});

test("Multi Year Stock, no month wise: one column named as the procedure names it", () => {
  const years = [year("2025-04-01", "2025-09-30", [product(7, "A")], [], [], [[7, [[0, 3]]]])];
  assert.deepEqual(multiYearStock(years, 3, false).columns, ["PROD_CODE", "PROD_DESC", "Qty_Apr25_Sep25"]);
  assert.deepEqual(multiYearStock(years, 6, false).columns, ["PROD_CODE", "PROD_DESC", "Qty_Apr25_Apr25"]);
});
