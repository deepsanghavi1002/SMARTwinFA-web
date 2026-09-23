import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

// The screen's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const rules = await import("../features/master-program/rules.ts");
const { keyPress, typingAllowed, validate } = rules;

const setup = (overrides = {}) => ({
  field_type: "N", force_inputtype: "N", decimal_points: 2, number_positiveonly: false,
  allow_space: false, value_allowed: "", value_notallowed: "", must_contain: "", field_validation: "",
  value_compulsory: false, combo_value: "", field_length_min: 0, field_length_max: 0,
  number_range_from: 0, number_range_upto: 0, head_label: "Rate", field_name: "RATE",
  ...overrides,
});
const key = (fieldSetup, editorText, typed, remainingText) =>
  keyPress({ setup: fieldSetup, masterGrid: false, programId: 1, licence: 1, cellValue: "", editorText, remainingText, yearStart: "01/Apr/2026" }, typed);
const check = (fieldSetup, text) =>
  validate({ setup: fieldSetup, masterGrid: false, programId: 1, licence: 1, coGstReq: false, label: "Rate", fieldValue: () => "" }, text);

test("a number takes one decimal point only", () => {
  assert.equal(key(setup(), "123", ".").refused, false);
  assert.equal(key(setup(), "123.12", ".").refused, true, "123.12. is refused");
  // With the old point selected, typing a point replaces it.
  assert.equal(key(setup(), "123.12", ".", "12312").refused, false);
  // Type C and N fields without forced numeric input follow the same rule.
  assert.equal(key(setup({ force_inputtype: "", field_type: "C" }), "5.5", ".").refused, true);
  assert.equal(key(setup({ force_inputtype: "", field_type: "A" }), "A.B", ".").refused, false, "text fields keep their points");
  assert.equal(check(setup(), "123.12.14").ok, false, "a pasted or calculated 123.12.14 is refused on commit");
  assert.equal(check(setup(), "123.12").ok, true);
});

test("a positive-only column never takes a minus sign, however it arrives", () => {
  const positive = setup({ number_positiveonly: true });
  assert.equal(key(positive, "", "-").refused, true);
  // Alt+45, a paste or a drop never raise a key the page can check; the change itself is refused.
  assert.equal(typingAllowed(positive, "12", "-12"), false);
  assert.equal(typingAllowed(positive, "12", "12-"), false);
  assert.equal(typingAllowed(positive, "12", "125"), true);
  assert.equal(check(positive, "-5").ok, false);
  assert.equal(typingAllowed(setup(), "12", "-12"), true, "columns that allow negatives keep the minus");
});

test("text that arrives without a key keeps the other number rules too", () => {
  assert.equal(typingAllowed(setup(), "12.5", "12.5.1"), false, "a second point");
  assert.equal(typingAllowed(setup(), "12", "12A"), false, "a letter in a numeric field (Alt+65)");
  assert.equal(typingAllowed(setup({ decimal_points: 0 }), "12", "12.5"), false, "a point where no decimals are allowed");
  // A value already stored that way can still be corrected: deleting from it is allowed.
  assert.equal(typingAllowed(setup(), "1.2.3", "1.23"), true);
  assert.equal(typingAllowed(setup(), "1.2.3", "1.2.3"), true);
});

test("dates can be typed short, the year taken from the accounting year", () => {
  const { shorthandDate } = rules;
  const april = new Date(2026, 3, 1);
  const day = (date) => date && `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
  assert.equal(day(shorthandDate("2309", april, null)), "23/9/2026");
  assert.equal(day(shorthandDate("23sep", april, null)), "23/9/2026");
  assert.equal(day(shorthandDate("23 Sept", april, null)), "23/9/2026");
  assert.equal(day(shorthandDate("23/9", april, null)), "23/9/2026");
  assert.equal(day(shorthandDate("1502", april, null)), "15/2/2027", "Jan-Mar fall in the year's second calendar year");
  assert.equal(day(shorthandDate("230925", april, null)), "23/9/2025");
  assert.equal(day(shorthandDate("23/Sep/2026", april, null)), "23/9/2026", "the stored form still reads");
  assert.equal(day(shorthandDate("0109+5", april, null)), "6/9/2026");
  assert.equal(day(shorthandDate("0109-5", april, null)), "27/8/2026");
  assert.equal(day(shorthandDate("23-9-2", april, null)), "21/9/2026");
  assert.equal(day(shorthandDate("+10", april, new Date(2026, 8, 25))), "5/10/2026", "a bare +n counts from the field's date");
  assert.equal(day(shorthandDate("1426", april, null)), "1/4/2026", "d m yy when it is not a day-month");
  assert.equal(day(shorthandDate("15", april, null)), "1/5/2026", "two digits are day and month");
  assert.equal(day(shorthandDate("154", april, null)), "15/4/2026");
  assert.equal(day(shorthandDate("23092026", april, null)), "23/9/2026");
  assert.equal(shorthandDate("3109", april, null), null, "31 September is not a date");
  assert.equal(shorthandDate("hello", april, null), null);
});

test("money read back from PostgreSQL keeps its sign wherever the minus sits", async () => {
  const { parseMoney } = await import("../lib/master-rules.ts");
  assert.equal(parseMoney("?- 100.00"), -100, "English_India prints the symbol, then the minus");
  assert.equal(parseMoney("₹- 1,250.50"), -1250.5);
  assert.equal(parseMoney("-$100.00"), -100);
  assert.equal(parseMoney("($100.00)"), -100);
  assert.equal(parseMoney("? 1,250.00"), 1250);
  assert.equal(parseMoney("? 0.00"), 0);
});

test("a list column's choice names are not held to the number rules of its id", () => {
  const schedule = setup({ field_type: "I", force_inputtype: "", number_positiveonly: true, combo_value: "Q" });
  assert.equal(check(schedule, "E - DIRECT EXPENSES").ok, true);
  assert.equal(check(schedule, "E -- FACTORY OVERHEADS").ok, true);
  assert.equal(check(setup({ number_positiveonly: true }), "-5").ok, false, "a plain number column still refuses it");
});
