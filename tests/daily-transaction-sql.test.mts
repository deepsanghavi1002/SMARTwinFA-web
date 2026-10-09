import assert from "node:assert/strict";
import test from "node:test";
import { detailQuery, summaryQueries } from "../lib/report/dailyTransactionSql.ts";

test("daily transaction summary: the lines in the procedure's order and groups", () => {
  const queries = summaryQueries("s.", "'f'", "'u'");
  assert.equal(queries.length, 9 + 12 + 5);
  assert.deepEqual([...new Set(queries.map((query) => query.sorting))], ["01 SALE", "02 PURCHASE", "03 EXPENSE", "04 DEPOSITE", "05 WITHDRAWAL", "06 INVENTORY", "07 SALE PARTY QTY", "08 PURCHASE PARTY QTY", "09 SALE PARTY AMT", "10 PURCHASE PARTY AMT", "11 EXPENSE PARTY AMT"]);
  assert.deepEqual(queries.filter((query) => query.sorting === "06 INVENTORY").map((query) => query.smart), ["SALE_INV", "CN_INV", "PURCH_INV", "DN_INV", "LESS", "ADD", "PRODUCTION FG ADD", "PRODUCTION FG LESS", "PRODUCTION SFG ADD", "PRODUCTION SFG LESS", "JOB OUT", "JOB IN"]);
  assert.deepEqual(queries.slice(0, 2).map((query) => query.smart), ["SALE", "SALE"], "the credit note is added to the sale");
  assert.match(queries[0].sql, /left join s\.ACCOUNT ac on ac\.code=led\.book_code where led\.doc_pos<>'D' and ac\.a_pos<>'D' and led\.book = 8 and led\.doc_date BETWEEN 'f' AND 'u' group by ac\.name/);
  assert.match(queries[5].sql, /led\.book = 6 and led\.ac_dbcode=2/);
  const party = queries.find((query) => query.sorting === "07 SALE PARTY QTY")!;
  assert.match(party.sql, /s\.PROD_LEDGER prodled left join s\.ACCOUNT ac on ac\.code=prodled\.code/);
  assert.match(party.sql, /prodled\.quantity::numeric - prodled\.ag_qty::numeric > 0/);
  assert.equal(party.smart, "SALE PARTY QTY");
  const job = queries.find((query) => query.smart === "JOB IN")!;
  assert.match(job.sql, /stock_nat='A'/);
  assert.match(queries.find((query) => query.smart === "PRODUCTION SFG ADD")!.sql, /PROD-MULTI' and coalesce\(prodled\.close_remark,''\)<>''/);
});

test("daily transaction detail: nine kinds of voucher joined, payment and receipt on the cash and bank books", () => {
  const sql = detailQuery("s.", "'f'", "'u'");
  assert.equal(sql.split(" UNION ALL ").length, 9);
  assert.match(sql, /'01' AS "SORTING_COL".*'Payment' AS "Voucher_Type".*led\.ac_dbcode=1 and led\.doc_posting='P'.*led\.book in \(4,6\)/);
  assert.match(sql, /'02' AS "SORTING_COL".*'Receipt'.*0::numeric AS "Debit",led\.amount::numeric AS "Credit"/);
  assert.match(sql, /'03' AS "SORTING_COL".*'Journal'.*led\.ac_dbcode=2 and led\.doc_posting='P'.*led\.book in \(19\)/);
  assert.match(sql, /'09' AS "SORTING_COL".*led\.book in \(10\)$/);
  assert.match(sql, /'04' AS "SORTING_COL".*led\.doc_series AS "Voucher_Type".*led\.ac_dbcode=1 and led\.doc_date/);
});
