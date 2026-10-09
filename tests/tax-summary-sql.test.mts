import assert from "node:assert/strict";
import test from "node:test";
import { amountExpressions, taxColumns } from "../lib/report/taxSummarySql.ts";

const names = (list: string) => [...list.matchAll(/ AS "([^"]+)"/g)].map((match) => match[1]);
const base = {
  net: "N", tax: "T", totNet: "TN", month: false, places: "1,1,2", slabKeys: "7,8", slabCount: 2,
  taxes: [{ rec: 10, place: 1, repohd: "CGST 9%", placeDesc: "LOCAL" }, { rec: 11, place: 1, repohd: "UTGST 9%", placeDesc: "LOCAL" }, { rec: 12, place: 2, repohd: "IGST 18%", placeDesc: "OUT-STATE" }],
  placeRows: new Map([[1, 2], [2, 1]]),
  slabs: [{ key: 7, short: "TCS" }, { key: 8, short: "ROUNDING" }],
};

test("tax summary columns: each tax, each place's total after its last tax, the tax total, the slabs, their total, the monthly total", () => {
  const { netCols, taxCols } = taxColumns(base);
  const expected = ["CGST 9%", "UTGST 9%", "|LOCAL|_TOTAL_TAX", "IGST 18%", "|OUT-STATE|_TOTAL_TAX", "|TOTAL|_TAX_AMT", "TCS", "ROUNDING", "|SLABS|_TOTAL_AMT", "|TOTAL|_MONTHLY_AMT"];
  assert.deepEqual(names(netCols), expected);
  assert.deepEqual(names(taxCols), [...expected.slice(0, 5), "|TOTAL|_TAX_AMT1", ...expected.slice(6, 9), "|TOTAL|_MONTHLY_AMT1"], "the tax row names its two overall totals with a 1; the columns line up position for position");
  assert.ok(!netCols.endsWith(","));
  assert.match(netCols, /SUM\(CASE WHEN LEDEXT\.TAX_ID = 10 THEN N ELSE 0\.00 END\) AS "CGST 9%"/);
  assert.match(taxCols, /SUM\(CASE WHEN LEDEXT\.TAX_ID = 10 THEN T ELSE 0\.00 END\) AS "CGST 9%"/);
  assert.match(netCols, /LEDEXT\.SLAB_ID = 7 THEN T ELSE/, "the net row shows each slab's amount");
  assert.match(taxCols, /LEDEXT\.SLAB_ID = 7 THEN 0\.00 ELSE/, "the tax row shows nil for the slabs");
});

test("with the month columns the totals carry no bars", () => {
  const { netCols, taxCols } = taxColumns({ ...base, month: true });
  assert.ok(names(netCols).includes("LOCAL_TOTAL_TAX") && names(netCols).includes("TOTAL_TAX_AMT"));
  assert.ok(names(taxCols).includes("TOTAL_TAX_AMT1"));
});

test("a place's total is left out when some of its tax rows are not among the active ones", () => {
  const { netCols } = taxColumns({ ...base, placeRows: new Map([[1, 3], [2, 1]]) });
  assert.ok(!names(netCols).includes("|LOCAL|_TOTAL_TAX"));
});

test("a slab total is left out when more slabs exist than are active", () => {
  assert.ok(!names(taxColumns({ ...base, slabCount: 3 }).netCols).includes("|SLABS|_TOTAL_AMT"));
});

test("amounts: a return book reverses sign, SGST carries no net", () => {
  const plain = amountExpressions("");
  assert.equal(plain.tax, "LEDEXT.SLAB_AMT");
  assert.match(plain.net, /IDOP\.OPT_DESC='SGST' then 0 else LEDEXT\.S_LASTOT/);
  assert.equal(plain.totNet, `${plain.net}+LEDEXT.SLAB_AMT`);
  const sale = amountExpressions("16");
  assert.match(sale.tax, /LED\.BOOK = 16 THEN \(LEDEXT\.SLAB_AMT \* -1\)/);
  assert.match(sale.net, /LEDEXT\.S_LASTOT \* -1/);
  assert.equal(sale.totNet, `${sale.net}+${sale.tax}`);
});
