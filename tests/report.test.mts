import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { convertForOperation, dateStyle112, dateStyle6, formulaValidation, parseSelectionDate, quotedList, sqlLen, sqlServerCompare } = await import("../lib/report/formula.ts");
const { pgFragment } = await import("../lib/report/sqlText.ts");
const { literal, setBooksValueInString, setupSelect } = await import("../lib/report/sqlText.ts");

test("Report_Combine.ConvertForOperation and FormulaValidation", () => {
  assert.deepEqual(convertForOperation("!(month)"), { op: "!", rest: "month" });
  assert.deepEqual(convertForOperation("in(1,2)"), { op: "IN", rest: "1,2" });
  assert.deepEqual(convertForOperation("8"), { op: "=", rest: "8" });
  assert.equal(formulaValidation("IN", "2", "1,2,3", false), true);
  assert.equal(formulaValidation("IN", "12", "1,2,3", false), false, "an IN list is matched item by item, not by substring");
  assert.equal(formulaValidation("NOT IN", "4", "1,2,3", false), true);
  assert.equal(formulaValidation(">", "10", "8", true), true);
  assert.equal(formulaValidation(">", "x", "8", true), false);
});

test("SORTING_COL order is SQL Server's: case ignored, space before punctuation before digits before letters", () => {
  const rows = [" Zeta1   P", " alpha12   H", " Alpha12   O", " Alpha12   P20260401", " Alpha12z", null, " Alpha-1   H"];
  const sorted = [...rows].sort(sqlServerCompare);
  assert.deepEqual(sorted, [null, " Alpha-1   H", " alpha12   H", " Alpha12   O", " Alpha12   P20260401", " Alpha12z", " Zeta1   P"]);
  assert.equal(sqlServerCompare("ABC  ", "abc"), 0, "trailing blanks are ignored");
});

test("date styles the ledger procedure writes", () => {
  const date = new Date(2026, 3, 1);
  assert.equal(dateStyle6(date), "01-Apr-26");
  assert.equal(dateStyle112(date), "20260401");
  assert.equal(parseSelectionDate("05/Oct/2026")?.getMonth(), 9);
  assert.equal(parseSelectionDate("31/Feb/2026"), null);
  assert.equal(sqlLen("ab  "), 2);
  assert.equal(quotedList("1,2", "'"), "'1','2'");
});

test("setup SQL written for SQL Server reads in PostgreSQL", () => {
  assert.equal(setupSelect(`SELECT 'MAIN' AS "DISP_COL",1 AS "VALUE_COL" ORDER BY VALUE_COL`), `SELECT 'MAIN' AS "DISP_COL",1 AS "VALUE_COL" ORDER BY "VALUE_COL"`);
  assert.equal(setupSelect("select space(3) as x"), "select repeat(' ', 3) as x");
  assert.equal(literal("a = |sys.tarikh1| or b = '|sys.tarikh1|'", "|sys.tarikh1|", "01/Apr/2026"), "a = '01/Apr/2026' or b = '01/Apr/2026'");
  assert.equal(setBooksValueInString("book in (|PCbook_DRSLED|,|PCbook_JOURNAL|)"), "book in (2,19)");
  assert.equal(pgFragment("case when x then ledpost.post_amt else 0.00 end from |sys.db|ledger", { moneyColumns: ["post_amt"] }, "co"), "case when x then ledpost.post_amt::numeric else 0.00 end from co.ledger");
  assert.equal(pgFragment("ledpost.post_amt::numeric", { moneyColumns: ["post_amt"] }, "co"), "ledpost.post_amt::numeric", "a cast already there is left alone");
});
