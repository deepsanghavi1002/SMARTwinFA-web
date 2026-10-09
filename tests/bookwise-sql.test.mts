import assert from "node:assert/strict";
import test from "node:test";
import { bookwiseSelect, bookwiseWhere, numberAndBlank } from "../lib/report/bookwiseSql.ts";

test("bookwise: the expense book reads EXPENSE_LINK, any other book OUTCLEAR", () => {
  const expense = bookwiseSelect("s.", 15);
  assert.match(expense.from, /s\.EXPENSE_LINK/);
  assert.match(expense.extraWhere, /ac\.book in \(1\)/);
  assert.ok(!expense.select.includes("Ag_Amt"));
  const other = bookwiseSelect("s.", 8);
  assert.match(other.from, /s\.OUTCLEAR outclr on outclr\.out_ledid=led\.led_key/);
  assert.match(other.from, /OUTCLEAR outclr1 on outclr1\.out_key=outclr\.out_ag_outid/);
  assert.match(other.extraWhere, /Auto\/999999.*ac\.book in \(1,2,3\)/);
  assert.match(other.select, /"Ag_Amt"/);
});

test("bookwise where: the report's where, the extra conditions, the dates", () => {
  assert.equal(bookwiseWhere(" where a=1", " and b=2", "'f'", "'u'"), " where a=1 and b=2 and led.doc_date BETWEEN 'f' AND 'u'");
  assert.equal(bookwiseWhere(" where ", " and b=2", "'f'", "'u'"), " where  b=2 and led.doc_date BETWEEN 'f' AND 'u'", "a bare where has no leading and");
});

test("bookwise: a voucher shows once, the rows under it carry only the bill", () => {
  const rows = numberAndBlank([
    { LED_KEY: 1, SORTING_COL: "a", selected_date: "01-Apr-26", DOC_NO: "SAL/1", PARTY_NAME: "P", AMOUNT: 100, Ag_No: "B1" },
    { LED_KEY: 1, SORTING_COL: "a", selected_date: "01-Apr-26", DOC_NO: "SAL/1", PARTY_NAME: "P", AMOUNT: 100, Ag_No: "B2" },
    { LED_KEY: 2, SORTING_COL: "b", selected_date: "02-Apr-26", DOC_NO: "SAL/2", PARTY_NAME: "Q", AMOUNT: 50, Ag_No: null },
  ]);
  assert.deepEqual(rows.map((row) => [row.DOC_NO, row.selected_date, row.AMOUNT, row.SR_NO]), [["SAL/1", "01-Apr-26", 100, 1], ["", "", 0, 2], ["SAL/2", "02-Apr-26", 50, 1]]);
  assert.ok(!("LED_KEY" in rows[0]));
  assert.equal(rows[1].Ag_No, "B2");
  assert.equal(rows[1].PARTY_NAME, "P");
});
