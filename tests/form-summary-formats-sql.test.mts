import assert from "node:assert/strict";
import test from "node:test";
import { formatParts, readsReturnAccounts, sumColumns, taxOnlyColumns } from "../lib/report/formSummaryFormatsSql.ts";

const names = (select: string) => [...select.matchAll(/ AS "([^"]+)"/g)].map((match) => match[1]);
const none = { bnet: "", btax: "", cnnet: "", cntax: "", rnet: "", rtax: "", totnet: "", tottax: "", totfin: "" };

test("sum columns: only the amount columns the book has, each summed", () => {
  const sums = sumColumns({ ...none, bnet: "a", btax: "b", totnet: "c", tottax: "d", totfin: "e" });
  assert.equal(sums, 'SUM(a) AS "B_NET" ,SUM(b) AS "B_TAX" ,SUM(c) AS "TOT_NET" ,SUM(d) AS "TOT_TAX" ,SUM(e) AS "TOT_FIN" ,');
});

test("details format: a row a voucher and tax line; summary format: a row a tax line", () => {
  const sums = sumColumns({ ...none, totnet: "c", tottax: "d" });
  const details = formatParts("SM_SUMMARY", "'1','2'", "101", sums)!;
  assert.deepEqual(names(details.select), ["SORTING_DATE", "SELECTED_DATE", "TOT_NET", "TOT_TAX", "TAX_SHORT", "TAX_DESC", "TAX_PLACE_DESC", "TAX_PLACE"]);
  assert.ok(details.select.startsWith(`to_char(LED.DOC_DATE,'YYYYMMDD') AS "SORTING_DATE"`));
  assert.ok(details.select.endsWith("SLAB.SLAB_ORDER,SLAB.SLAB_KEY"));
  assert.ok(details.groupBy.includes("LED.DOC_NO") && details.groupBy.includes("AC.NAME"));
  const summary = formatParts("SUMMARY", "'1'", "101", sums)!;
  assert.deepEqual(names(summary.select), ["TAX_PLACE", "TAX_PLACE_DESC", "TAX_SHORT", "TAX_DESC", "TOT_NET", "TOT_TAX"]);
  assert.ok(!summary.select.endsWith(","), "no trailing comma after the last sum");
  assert.ok(!summary.groupBy.includes("LED.DOC_NO"));
  assert.equal(formatParts("DETAIL", "'1'", "101", sums), null);
});

test("a slab line without a tax takes the place after the last one", () => {
  assert.match(formatParts("SUMMARY", "'7'", "104", "")!.select, /ELSE 104 END AS "TAX_PLACE"/);
});

test("return accounts are read as 16 or 11 anywhere in the keys, as the desktop does", () => {
  assert.ok(readsReturnAccounts(["5", "160"]));
  assert.ok(readsReturnAccounts(["11"]));
  assert.ok(!readsReturnAccounts(["5", "7"]));
});

test("SGST / UTGST lines: which amount columns go to nil", () => {
  const has = (...present: string[]) => (column: string) => present.includes(column);
  assert.deepEqual(taxOnlyColumns(8, false, has("B_NET", "CN_NET", "R_NET")), ["B_NET", "CN_NET", "R_NET"]);
  assert.deepEqual(taxOnlyColumns(8, false, has("B_NET")), [], "no cash-memo or return column: only the totals change");
  assert.deepEqual(taxOnlyColumns(9, false, has("B_NET", "R_NET")), ["B_NET", "R_NET"]);
  assert.deepEqual(taxOnlyColumns(8, true, has("B_NET", "CN_NET")), []);
});
