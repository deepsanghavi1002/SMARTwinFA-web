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

// ---- Pieces moved out of the master so every grid (small entry, entry, reports) shares them.

const { closedByPartner, closedByRow, NO_NUMBER_RULES, numberRefusal, numberRules, POSITIVE_ONLY_MESSAGE, rowRuled } = await import("../features/grid/rules.ts");
const ruleSetup = (overrides = {}) => ({ value_diff_than: "", status_against_fld: "", enable_for: "", disable_for: "", ...overrides });
const source = (values, firstValue = "1") => ({ firstCombo: { text: "Group", value: firstValue, bound: true }, fieldValue: (name) => values[name.toLowerCase()] });

test("row rules close a cell the same way on every grid", () => {
  // A paired field is closed while its partner holds a value and it is blank itself.
  assert.equal(closedByPartner(ruleSetup({ value_diff_than: "DISABLE_BOOK" }), true, "", (name) => (name === "DISABLE_BOOK" ? " 2," : "")), true);
  assert.equal(closedByPartner(ruleSetup({ value_diff_than: "DISABLE_BOOK" }), true, " 1,", () => " 2,"), false, "both filled: both stay open");
  // record_exist: known only once the record has been checked.
  const exists = ruleSetup({ status_against_fld: "record_exist", disable_for: "Y" });
  assert.equal(closedByRow(exists, true, "", source({ record_exist: "Y" })), true);
  assert.equal(closedByRow(exists, true, "", source({ record_exist: "" })), false);
  // Nothing is closed while the first combo has no value, nor a read-only column.
  assert.equal(closedByRow(exists, true, "", source({ record_exist: "Y" }, "")), false);
  assert.equal(closedByRow(exists, false, "", source({ record_exist: "Y" })), false);
  assert.equal(rowRuled(exists, true), true);
  assert.equal(rowRuled(ruleSetup(), true), false);
});

const { copyCell, gridText, pasteValue, pastedMessage } = await import("../features/grid/clipboard.ts");
const dates = { parse: (text) => (/^\d{1,2}\/\w{3}\/\d{4}$/.test(text) ? new Date(text) : null), write: (text) => text };

test("copy and paste follow MnuCopy / MnuPaste", () => {
  const godown = [{ text: "MAIN", value: "4" }];
  assert.deepEqual(copyCell("MAIN", { combo_value: "X" }, godown), { ok: true, copied: { value: "MAIN", addonId: "4" } });
  assert.equal(copyCell("", { combo_value: "X" }, godown).ok, false, "an addon combo needs its id first");
  assert.deepEqual(copyCell("12", { combo_value: "" }, null), { ok: true, copied: { value: "12", addonId: "0" } });

  const column = (overrides = {}) => ({ caption: "Rate", setup: { combo_value: "", field_type: "N", ...overrides } });
  const open = { editable: true, disabled: false };
  assert.deepEqual(pasteValue({ value: "12", addonId: "0" }, column(), open, dates), { ok: true, value: "12" });
  assert.match(pasteValue({ value: "12", addonId: "0" }, column(), { editable: false, disabled: false }, dates).message, /readonly/);
  assert.match(pasteValue({ value: "12", addonId: "0" }, column(), { editable: true, disabled: true }, dates).message, /disabled/);
  assert.match(pasteValue({ value: "Yes", addonId: "0" }, column({ combo_value: "L" }), open, dates).message, /drop down/);
  assert.match(pasteValue({ value: "soon", addonId: "0" }, column({ field_type: "D" }), open, dates).message, /isn't valid date/);
  assert.equal(pasteValue({ value: "01/Apr/2026", addonId: "0" }, column({ field_type: "D" }), open, dates).ok, true);

  assert.equal(gridText(["Code", "Name"], [["1", "A"], ["2", "B"]]), "Code\tName\n1\tA\n2\tB");
  assert.equal(pastedMessage("5", 1, "Rate"), 'Pasted "5" into 1 row of Rate');
});

const { blankCompulsory } = await import("../features/grid/compulsory.ts");

test("a compulsory column open on an edited row may not be left blank", () => {
  const columns = [{ key: "qty", caption: "* Qty", compulsory: true }, { key: "rate", caption: "Rate", compulsory: false }];
  const row = (rowNumber, values, deleted = false) => ({ rowNumber, deleted, valueOf: (key) => values[key] });
  const open = () => true;
  assert.equal(blankCompulsory([row(1, { qty: "5", rate: "" })], columns, open), "");
  assert.match(blankCompulsory([row(3, { qty: " ", rate: "" })], columns, open), /- Qty at row 3/);
  assert.equal(blankCompulsory([row(3, { qty: "" }, true)], columns, open), "", "a deleted row is not checked");
  assert.equal(blankCompulsory([row(3, { qty: "" })], columns, () => false), "", "a closed cell cannot be demanded");
});

const { findNextCell } = await import("../features/grid/find.ts");
const { columnLefts, frozenCell } = await import("../features/grid/frozen.ts");
const { roundToPlaces, tooltipText, zeroAsBlank } = await import("../features/grid/cellText.ts");

test("find next, frozen columns and cell text", () => {
  const cells = { 0: ["a", "x"], 1: ["b", "match"], 2: ["MATCH", "c"] };
  assert.deepEqual(findNextCell([0, 1, 2], 1, [0, 1], (row, col) => cells[row][col], "match"), { row: 2, column: 0 }, "after the cursor's row, any case");
  assert.deepEqual(findNextCell([0, 1, 2], 2, [0, 1], (row, col) => cells[row][col], "match"), { row: 1, column: 1 }, "round to the top");
  assert.equal(findNextCell([0, 1, 2], 0, [0, 1], (row, col) => cells[row][col], " "), null);

  const lefts = columnLefts([{ w: 50 }, { w: 70 }, { w: 30 }], (column) => column.w, 16);
  assert.deepEqual(lefts, [16, 66, 136]);
  assert.deepEqual(frozenCell(1, 2, lefts), { className: "mp-frozen", style: { left: 66 } });
  assert.deepEqual(frozenCell(2, 2, lefts), { className: "", style: {} });

  assert.equal(tooltipText("SELECT A | B |"), "A / B");
  assert.equal(roundToPlaces("12.345", { field_type: "N", decimal_points: 2 }), "12.35");
  assert.equal(zeroAsBlank({ field_type: "N", force_inputtype: "" }, false, "0.00"), "");
  assert.equal(zeroAsBlank({ field_type: "N", force_inputtype: "" }, true, "0"), "0", "a list keeps its value");
});

const { nextOpenCell } = await import("../features/grid/rows.ts");

test("Enter goes to the next open cell, row by row, as each row's rules allow", () => {
  // Entry Approved: one open column (2); row 1 is closed on it.
  const open = (row, col) => col === 2 && row !== 1;
  assert.deepEqual(nextOpenCell(open, 0, 2, 5, 4), { row: 2, col: 2 }, "after the row's only open column, down to the next row it is open on");
  assert.deepEqual(nextOpenCell(open, 0, 0, 5, 4), { row: 0, col: 2 }, "from a closed column, on to the open one");
  assert.equal(nextOpenCell(open, 4, 2, 5, 4), null, "the last row stays");
  assert.equal(nextOpenCell(() => false, 0, 0, 1000, 4), null, "nothing open: looked at three rows only");
});

test("a figure from the calculator keeps the column number rules on every grid", () => {
  const setup = { decimal_points: 2, number_positiveonly: true, number_range_from: 0, number_range_upto: 0 };
  const rules = numberRules(setup);
  assert.deepEqual(rules, { decimals: 2, positiveOnly: true, rangeFrom: 0, rangeUpto: 0 });
  assert.equal(numberRefusal(rules, -5), POSITIVE_ONLY_MESSAGE);
  assert.equal(numberRefusal(rules, 0), "");
  assert.equal(numberRefusal(rules, 6), "");
  assert.equal(numberRefusal({ ...rules, positiveOnly: false }, -5), "", "a minus is fine where the column allows it");
  assert.equal(numberRefusal(numberRules({ ...setup, number_positiveonly: false, number_range_from: 1, number_range_upto: 100 }), 101), "Range 1 To 100");
  assert.equal(numberRefusal(NO_NUMBER_RULES, -5), "");
});
