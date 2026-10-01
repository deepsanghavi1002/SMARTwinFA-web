import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { conditionHolds, filterFromDraft, filterHolds, kindOfFieldType, sortedDistinct } = await import("../features/grid/filter.ts");
const { findTyped, selectionTotals } = await import("../features/grid/totals.ts");

test("a column's filter kind follows its field type", () => {
  assert.equal(kindOfFieldType("D"), "date");
  assert.equal(kindOfFieldType("N"), "number");
  assert.equal(kindOfFieldType("I"), "number");
  assert.equal(kindOfFieldType("T"), "text");
  assert.equal(kindOfFieldType("T", true), "number", "a number format makes it numeric");
});

test("number, date and text conditions read the stored value or the shown text", () => {
  assert.equal(conditionHolds("number", { op: "gt", a: "100", b: "" }, "105.0000", "105.00"), true);
  assert.equal(conditionHolds("number", { op: "between", a: "10", b: "1" }, "5", "5"), true);
  assert.equal(conditionHolds("number", { op: "blank", a: "", b: "" }, "0.0000", "0.00"), true);
  assert.equal(conditionHolds("date", { op: "ge", a: "2026-09-01", b: "" }, "23/Sep/2026", "23/09/2026"), true);
  assert.equal(conditionHolds("date", { op: "lt", a: "2026-09-01", b: "" }, "23/Sep/2026", "23/09/2026"), false);
  assert.equal(conditionHolds("text", { op: "begins", a: "cop", b: "" }, "", "Copper Cable"), true);
  assert.equal(conditionHolds("text", { op: "notContains", a: "cable", b: "" }, "", "Copper Cable"), false);
});

test("ticked values and two conditions combine as Excel's filter does", () => {
  const filter = { values: ["A", "B"], first: { op: "ne", a: "b", b: "" } };
  assert.equal(filterHolds("text", filter, "", "A"), true);
  assert.equal(filterHolds("text", filter, "", "B"), false, "B is ticked but fails the condition");
  assert.equal(filterHolds("text", filter, "", "C"), false, "C is not ticked");
  const either = { first: { op: "lt", a: "10", b: "" }, join: "or", second: { op: "gt", a: "100", b: "" } };
  assert.equal(filterHolds("number", either, "5", "5"), true);
  assert.equal(filterHolds("number", either, "50", "50"), false);
});

test("a draft with everything ticked and no condition clears the filter", () => {
  const empty = { op: "", a: "", b: "" };
  assert.equal(filterFromDraft({ key: "k", chosen: ["a", "b"], first: empty, join: "and", second: empty }, ["a", "b"]), null);
  assert.deepEqual(filterFromDraft({ key: "k", chosen: ["a"], first: empty, join: "and", second: empty }, ["a", "b"]), { values: ["a"] });
  assert.deepEqual(filterFromDraft({ key: "k", chosen: ["a", "b"], first: { op: "gt", a: "", b: "" }, join: "and", second: empty }, ["a", "b"]), null, "a condition without its value is ignored");
});

test("filter lists put blank first, then natural order", () => {
  assert.deepEqual(sortedDistinct(["10", "2", "", "2", "1"]), ["", "1", "2", "10"]);
});

test("the selection total adds the cells holding a number, as Excel's status bar", () => {
  assert.equal(selectionTotals(["864.0000", "105.0000", "766", "575", "220"], 2), "Sum: 2,530.00   Count: 5   Average: 506.00");
  assert.equal(selectionTotals(["", "12"], 0), "Sum: 12   Count: 1   Average: 12");
  assert.equal(selectionTotals(["", ""], 2), null);
});

test("type to find takes the first row, in the order shown, starting with the letters typed", () => {
  const names = ["Brass Tap", "Cable", "cap", "Copper"];
  assert.equal(findTyped([0, 1, 2, 3], "ca", (row) => names[row]), 1);
  assert.equal(findTyped([0, 1, 2, 3], "cap", (row) => names[row]), 2);
  assert.equal(findTyped([0, 1, 2, 3], "x", (row) => names[row]), -1);
});

const { nextEntryCell, rowChanged } = await import("../features/grid/rows.ts");

test("Enter goes across a row's open columns, then to the next row's first open column", () => {
  const editable = [false, true, true, false];
  assert.deepEqual(nextEntryCell(editable, 0, 1, 5), { row: 0, col: 2 }, "Opening to Rate");
  assert.deepEqual(nextEntryCell(editable, 0, 2, 5), { row: 1, col: 1 }, "Rate to the next row's Opening");
  assert.deepEqual(nextEntryCell(editable, 0, 0, 5), { row: 0, col: 1 });
  assert.equal(nextEntryCell(editable, 4, 2, 5), null, "the last row's last open column stays");
  assert.equal(nextEntryCell([false, false], 0, 0, 5), null);
});

test("a row is changed only while an editable column differs from what was loaded", () => {
  const columns = [{ key: "code", editable: false }, { key: "open", editable: true }];
  const same = (_column, a, b) => Number(a || 0) === Number(b || 0);
  assert.equal(rowChanged(columns, { code: "X", open: "33" }, { code: "A", open: "32" }, same), true);
  assert.equal(rowChanged(columns, { code: "X", open: "32.00" }, { code: "A", open: "32.0000" }, same), false, "read-only columns and equal numbers do not count");
});
