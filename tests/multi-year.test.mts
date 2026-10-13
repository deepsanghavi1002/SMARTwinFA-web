import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { multiYearAccounts } = await import("../lib/report/multiYear.ts");

const account = (code: number, name: string, book: number, opening: number | null, openSty = "") => ({ code, name, book, live: true, openSty, opening });
const year = (label: string, accounts: ReturnType<typeof account>[], posts: [number, number, number][], debtors = { dr: 0, cr: 0 }) => ({
  label, accounts, posts: new Map(posts.map(([code, dr, cr]) => [code, { dr, cr }])), debtors, creditors: { dr: 0, cr: 0 },
});

test("Multi Year: a debtor matched across years by name and book, an earlier year's own account added", () => {
  const years = [
    year("2025_2026", [account(10, "Ram Traders", 2, 100), account(11, "Old Party", 2, 50)], [[10, 300, 200], [11, 0, 0]]),
    year("2026_2027", [account(20, "RAM TRADERS", 2, 200)], [[20, 40, 10]]),
  ];
  const table = multiYearAccounts(years, 2, false);
  assert.deepEqual(table.columns, ["NAME", "Op_2025_2026", "Dr_2025_2026", "Cr_2025_2026", "Cl_2025_2026", "Op_2026_2027", "Dr_2026_2027", "Cr_2026_2027", "Cl_2026_2027"]);
  assert.deepEqual(table.rows.map((row) => Object.values(row)), [
    // Added from the first year only (its later-year columns stay blank).
    ["Old Party", 50, 0, 0, 50, null, null, null, null],
    // The last year's closing is not worked out outside the general accounts, as the procedure.
    ["RAM TRADERS", 100, 300, 200, 200, 200, 40, 10, 0],
  ]);
});

test("Multi Year, general accounts: Sundry Debtors takes every debtor's postings and the last year closes", () => {
  const years = [
    year("2025_2026", [account(1, "Sundry Debtors", 1, 0, "SD")], [], { dr: 900, cr: 400 }),
    year("2026_2027", [account(5, "Sundry Debtors", 1, 500, "SD"), account(6, "Rent", 1, 0)], [[6, 70, 0]], { dr: 100, cr: 30 }),
  ];
  const table = multiYearAccounts(years, 1, false);
  assert.deepEqual(table.rows.map((row) => [row.NAME, row.Dr_2025_2026, row.Cr_2025_2026, row.Cl_2025_2026, row.Dr_2026_2027, row.Cl_2026_2027]), [
    ["Rent", 0, 0, null, 70, 70],
    ["Sundry Debtors", 900, 400, 500, 100, 570],
  ]);
});

test("Multi Year, Debit Credit Only: the year's debits and credits alone, no added accounts", () => {
  const years = [year("2025_2026", [account(11, "Old Party", 3, 50)], [[11, 5, 0]]), year("2026_2027", [account(20, "New Party", 3, 0)], [[20, 9, 1]])];
  const table = multiYearAccounts(years, 3, true);
  assert.deepEqual(table.rows, [{ NAME: "New Party", Dr_2025_2026: 0, Cr_2025_2026: 0, Dr_2026_2027: 9, Cr_2026_2027: 1 }]);
});
