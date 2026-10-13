import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { salesExpenseTable } = await import("../lib/report/salesExpense.ts");

const APR = 3, MAY = 4, JAN = 0;
const sale = (month: number, amount: number) => ({ code: 0, particular: "SALES", side: "SALES" as const, head: "SALES", month, amount });
const expense = (code: number, particular: string, head: string, month: number, amount: number) => ({ code, particular, side: "EXPENSE" as const, head, month, amount });
const amounts = [
  sale(APR, 1000), sale(MAY, 2000), sale(JAN, 500),
  expense(7, "Rent", "Indirect Expenses", APR, 100), expense(7, "Rent", "Indirect Expenses", MAY, 100),
  expense(9, "Freight", "Direct Expenses", MAY, 50),
  expense(11, "Refund", "Indirect Expenses", APR, -20),
];

test("Sales V/S Expense: a column a month in the year's order, Total, AVG_PER_MONTH and the TOTAL EXP % line", () => {
  const table = salesExpenseTable(amounts, false);
  assert.deepEqual(table.columns, ["SMART_AC_CODE", "Particular", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "April", "May", "January", "Total", "AVG_PER_MONTH"]);
  assert.deepEqual(table.rows.map((row) => [row.Particular, row.April, row.May, row.January, row.Total, row.AVG_PER_MONTH]), [
    ["SALES", 1000, 2000, 500, 3500, 1166.67],
    ["Freight", null, 50, null, 50, 16.67],
    ["Rent", 100, 100, null, 200, 66.67],
    // The % line counts the refund's -20 (the expenses before the lines of 0 or less are dropped).
    ["TOTAL EXP %", 8, 7.5, null, 6.57, 6.57],
  ]);
});

test("Sales V/S Expense with Percentage Column Require: each month's share of the sales, no % line", () => {
  const table = salesExpenseTable(amounts, true);
  assert.deepEqual(table.rows.map((row) => [row.Particular, row.April, row.April_Perc, row.May_Perc, row.TOTAL]), [
    ["SALES", 1000, 100, 100, 3500],
    ["Freight", null, null, 2.5, 50],
    ["Rent", 100, 10, 5, 200],
  ]);
});

test("Sales V/S Expense with Percentage Column Require and no sales: nothing, as the procedure's cross join", () => {
  assert.equal(salesExpenseTable([expense(7, "Rent", "Indirect Expenses", APR, 100)], true).rows.length, 0);
});
