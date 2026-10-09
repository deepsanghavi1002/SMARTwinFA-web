import assert from "node:assert/strict";
import test from "node:test";
import { codesOf, partyBillQuery } from "../lib/report/partyBillPdfSql.ts";

test("party bill pdf: the bills of the book for the selected accounts", () => {
  assert.deepEqual(codesOf("(12,34, 5)"), [12, 34, 5]);
  assert.deepEqual(codesOf(""), []);
  const sql = partyBillQuery({ db: "s.", book: 8, codes: [12, 34], from: "'f'", upto: "'u'", hideCaEnt: false });
  assert.match(sql, /where led\.DOC_POS='A' and led\.code in \(12,34\) and led\.book=8 and led\.DOC_DATE BETWEEN 'f' AND 'u'/);
  assert.match(sql, /from s\.prod_ledger where il_pos='A' and led_id=led\.led_key/);
  assert.ok(!sql.includes("CA_ENT"));
  const all = partyBillQuery({ db: "s.", book: 13, codes: [], from: "'f'", upto: "'u'", hideCaEnt: true });
  assert.ok(!all.includes("led.code in"));
  assert.match(all, /LED\.BOOK_CODE in \(select code from s\.ACCOUNT where A_SHORT<>'CA_ENT'\)/);
});
