import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { multiYearExpense } = await import("../lib/report/multiYearExpense.ts");

const account = (code: number, name: string, head = "OFFICE", live = true, expense = true) => ({ code, name, live, head, expense });
const year = (from: string, upto: string, accounts: ReturnType<typeof account>[], debit: [number, number, number][], credit: [number, number][] = []) => {
  const byCode = new Map<number, Map<number, number>>();
  for (const [code, month, value] of debit) byCode.set(code, new Map([...(byCode.get(code) ?? []), [month, value]]));
  return { from: new Date(from), upto: new Date(upto), accounts, debit: byCode, credit: new Map(credit) };
};

test("Multi Year Expense: the last year's accounts matched by name; an earlier account added; a 0 read again as its credits", () => {
  const years = [
    year("2025-04-01", "2025-09-30", [account(1, "Rent"), account(2, "Tea", "FOOD"), account(3, "Refund")], [[1, 0, 100], [2, 0, 40]], [[3, 7]]),
    year("2026-04-01", "2026-09-30", [account(11, "Rent"), account(13, "Refund")], [[11, 0, 120]]),
  ];
  const table = multiYearExpense(years, false);
  assert.deepEqual(table.columns, ["NAME", "SMART_SELECTED_ADDON1", "Ex_Apr2025_Sep2025", "Ex_Apr2026_Sep2026"]);
  assert.deepEqual(table.rows.map((row) => Object.values(row)), [
    // FOOD before OFFICE; Tea is added from the first year only.
    ["Tea", "FOOD", 40, null],
    // Refund: nothing debited in 2025, so its credit shows; the last year is left alone.
    ["Refund", "OFFICE", 7, 0],
    ["Rent", "OFFICE", 100, 120],
  ]);
});

test("Multi Year Expense, Month Wise: a column a month, April first, and the year's total", () => {
  const years = [year("2026-04-01", "2027-03-31", [account(1, "Rent")], [[1, 5, 30], [1, 0, 30]])];
  const table = multiYearExpense(years, true);
  assert.deepEqual(table.columns.slice(0, 4), ["NAME", "SMART_SELECTED_ADDON1", "Apr_26_27", "May_26_27"]);
  assert.equal(table.columns[table.columns.length - 1], "Ex_2026_2027");
  assert.deepEqual(table.rows.map((row) => [row.Apr_26_27, row.May_26_27, row.Ex_2026_2027]), [[0, 30, 30]]);
});
