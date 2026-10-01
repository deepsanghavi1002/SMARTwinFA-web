import assert from "node:assert/strict";
import test from "node:test";
import { orderByAliases, roundEven } from "../lib/small-entry/text.ts";
import { commitCell, sameValue, shownValue, typingAllowed } from "../features/small-entry/cells.ts";

const opening = { fieldType: "N", positiveOnly: true, decimals: 2, caption: "Opening" };
const code = { fieldType: "T", positiveOnly: false, decimals: 0, caption: "Product Code" };

test("an ORDER BY naming a quoted alias is quoted the way the alias is spelt", () => {
  const sql = `SELECT 'Godown Opening' AS "DISP_COL",1 AS "VALUE_COL"`;
  assert.equal(orderByAliases(sql, "VALUE_COL"), `"VALUE_COL"`);
  assert.equal(orderByAliases(sql, "value_col desc, prod_short"), `"VALUE_COL" desc,prod_short`);
  assert.equal(orderByAliases("select a as b from t", "b"), "b");
});

test("computed quantities round half to even, as Math.Round(decimal, 2) does", () => {
  assert.equal(roundEven(2.345), "2.34");
  assert.equal(roundEven(2.355), "2.36");
  assert.equal(roundEven(33 / 12), "2.75");
  assert.equal(roundEven(10), "10");
});

test("a number cell takes digits and one point; positive-only refuses a minus", () => {
  assert.equal(typingAllowed(opening, "12.5"), true);
  assert.equal(typingAllowed(opening, "12.5.1"), false);
  assert.equal(typingAllowed(opening, "-3"), false);
  assert.equal(typingAllowed({ ...opening, positiveOnly: false }, "-3"), true);
  assert.equal(typingAllowed(opening, "1a"), false);
  assert.equal(typingAllowed(code, "O'Neil"), false);
});

test("a committed number keeps the column's decimal places; blank stays blank", () => {
  assert.deepEqual(commitCell(opening, "33"), { ok: true, value: "33.00" });
  assert.deepEqual(commitCell(opening, "12.345"), { ok: true, value: "12.35" });
  assert.deepEqual(commitCell(opening, "1,250"), { ok: true, value: "1250.00" });
  assert.deepEqual(commitCell(opening, ""), { ok: true, value: "" });
  assert.equal(commitCell(opening, "-1").ok, false);
  assert.equal(commitCell(opening, "abc").ok, false);
  assert.deepEqual(commitCell(code, "ABC 1"), { ok: true, value: "ABC 1" });
});

test("a row changed back to its loaded value is no longer marked", () => {
  assert.equal(sameValue(opening, "32.00", "32.0000"), true);
  assert.equal(sameValue(opening, "", "0"), true);
  assert.equal(sameValue(opening, "33.00", "32.0000"), false);
  assert.equal(sameValue(code, "a", "A"), false);
});

test("numbers show with the column's places, Indian grouping; a zero with no places shows blank", () => {
  assert.equal(shownValue(opening, "123456.5"), "1,23,456.50");
  assert.equal(shownValue({ fieldType: "N", decimals: 0 }, "0"), "");
  assert.equal(shownValue(code, "Gen Material"), "Gen Material");
  assert.equal(shownValue(opening, ""), "");
});
