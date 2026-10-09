import assert from "node:assert/strict";
import test from "node:test";
import { dropMeasure, dropQuery, dropWindow, pivotDrops } from "../lib/report/dropAnalysisSql.ts";

test("drop analysis: the month the first combo names", () => {
  assert.deepEqual(dropWindow("JANUARY", 2025, 2026)?.upto, "2026-01-31");
  assert.equal(dropWindow("april", 2025, 2026)?.from, "2025-04-01");
  assert.equal(dropWindow("APRIL", 2025, 2026)?.days.length, 30);
  assert.equal(dropWindow("FEBRUARY", 2023, 2024)?.upto, "2024-02-29");
  assert.equal(dropWindow("FEBRUARY", 2024, 2025)?.days.length, 28);
  assert.equal(dropWindow("nothing", 2025, 2026), null);
  assert.equal(dropMeasure("Quantity"), "quantity");
  assert.equal(dropMeasure("Amount"), "amount");
  assert.equal(dropMeasure("Drop Count"), "count");
});

test("drop analysis: the product and party selects", () => {
  const window = dropWindow("MAY", 2025, 2026);
  const product = dropQuery({ db: "s.", product: true, measure: "quantity", monthly: false, window, slab: 0, addons: [{ save: "BRAND", text: true }] });
  assert.match(product, /sum\(a\.quantity::numeric\) as "Drop_Count",COALESCE\(adata\.txt_BRAND,''\) AS "BRAND"/);
  assert.match(product, /a\.book=8 and c\.prod_pos='A'/);
  assert.match(product, /a\.il_date BETWEEN '2025-05-01'::date and '2025-05-31'::date/);
  assert.match(product, /to_char\(il_date,'DD'\)/);
  const month = dropQuery({ db: "s.", product: false, measure: "amount", monthly: true, window, slab: 7, addons: [] });
  assert.match(month, /to_char\(doc_date,'Mon'\) as "Month_Name"/);
  assert.match(month, /slab_id=7\),0\) as "Drop_Count"/);
  assert.ok(!month.includes("BETWEEN"));
  assert.match(month, /group by b\.name,to_char\(doc_date,'Mon'\),a\.led_key/);
  const qty = dropQuery({ db: "s.", product: false, measure: "quantity", monthly: false, window, slab: 0, addons: [] });
  assert.match(qty, /LEFT JOIN s\.PROD_LEDGER d on d\.led_id=a\.led_key/);
  assert.match(qty, /d\.il_pos='A' and d\.led_id is not null/);
});

test("drop analysis: pivot with TOTAL", () => {
  const rows = [
    { name: "B", Day_Name: "02", Drop_Count: 2.6, A: "x" },
    { name: "A", Day_Name: "01", Drop_Count: 1, A: "x" },
    { name: "A", Day_Name: "01", Drop_Count: 2, A: "x" },
    { name: "A", Day_Name: "03", Drop_Count: 1.5, A: "x" },
  ];
  const out = pivotDrops(rows, "name", "Day_Name", ["01", "02", "03"], ["A"]);
  assert.deepEqual(out.map((r) => r.name), ["A", "B"]);
  assert.deepEqual([out[0]["01"], out[0]["02"], out[0]["03"], out[0].TOTAL], [3, null, 1.5, 4]);
  assert.equal(out[1].TOTAL, 2);
});
