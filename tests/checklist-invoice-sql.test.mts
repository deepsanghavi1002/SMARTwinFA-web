import assert from "node:assert/strict";
import test from "node:test";
import { entryNeedle, invoiceFrom, invoiceSelect, masterNeedle, slabBook, slabParts } from "../lib/report/checklistInvoiceSql.ts";

const names = (select: string) => [...select.matchAll(/ AS "([^"]+)"/g)].map((match) => match[1]);

test("a credit note looks up the sale's slabs, a debit note the purchase's", () => {
  assert.deepEqual([slabBook(16), slabBook(11), slabBook(8), slabBook(13)], [8, 13, 8, 13]);
  assert.equal(entryNeedle(16), "8,");
  assert.equal(masterNeedle(16), " 2,");
  assert.equal(masterNeedle(13), " 3,");
});

test("master slabs bring the net and tax description, SGST the second pair", () => {
  const { columns, joins } = slabParts([{ key: 1, short: "CGST", master: true }, { key: 2, short: "SGST", master: true }, { key: 3, short: "CESS", master: false }]);
  assert.deepEqual(names(columns.join(",")), ["NET_AMT", "TAX_DESC", "CGST", "NET_AMT1", "TAX_DESC1", "SGST", "CESS"]);
  assert.equal(joins.length, 7);
  assert.match(joins[3], /s_lastot::numeric-\(slab_amt::numeric\+slab_amt::numeric\)/);
});

test("a second master slab does not repeat NET_AMT", () => {
  const { columns } = slabParts([{ key: 1, short: "CGST", master: true }, { key: 4, short: "IGST", master: true }]);
  assert.deepEqual(names(columns.join(",")), ["NET_AMT", "TAX_DESC", "CGST", "IGST"]);
});

test("licence 2 shows bundle, quantity and kgs; the others the quantity", () => {
  assert.deepEqual(names(invoiceSelect("s.", 2, [], [], [])), ["DATE", "DOC_NO", "CHALLAN_NO", "CHLN_DATE", "BUNDLE", "QTY", "KGS", "AMOUNT", "NARRATION"]);
  assert.deepEqual(names(invoiceSelect("s.", 1, ["x AS \"CGST\""], [], [])), ["DATE", "DOC_NO", "CHALLAN_NO", "CHLN_DATE", "QTY", "CGST", "AMOUNT", "NARRATION"]);
});

test("the register's book is chosen by its account code and the tables carry the schema", () => {
  const { joins } = slabParts([{ key: 1, short: "CGST", master: true }]);
  const sql = invoiceFrom("s.", 1, 55, false, joins, "'a'", "'b'");
  assert.match(sql, /led\.book_code=55/);
  assert.match(sql, /s\.LEDGER_EXT/);
  assert.match(sql, /s\.TAX_MASTER/);
  assert.ok(!sql.includes("ADDON_AENTRY"));
});
