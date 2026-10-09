import assert from "node:assert/strict";
import test from "node:test";
import { absentQuery, partyQuery, quantityQuery, topPlan, valueQuery } from "../lib/report/topReportsSql.ts";

const dates = { from: "'f'", upto: "'u'" };

test("top reports: the first combo names the report and the book", () => {
  assert.deepEqual(topPlan("Customers"), { book: 8, mode: "party" });
  assert.deepEqual(topPlan(" Item Sold by Value "), { book: 8, mode: "value" });
  assert.deepEqual(topPlan("Item Sold by Quantity"), { book: 8, mode: "quantity" });
  assert.deepEqual(topPlan("Suppliers"), { book: 13, mode: "party" });
  assert.deepEqual(topPlan("Item Purchase by Value"), { book: 13, mode: "value" });
  assert.deepEqual(topPlan("Item Purchase by Quantity"), { book: 13, mode: "quantity" });
});

test("top customers: the sale less its credit notes, on the net amount when the book has a tax slab", () => {
  const plain = partyQuery("s.", topPlan("Customers"), 0, [], dates, "2026");
  assert.match(plain, /sum\(case when led\.ag_book=8 and led\.book=16 then led\.amount::numeric\*-1 else led\.amount::numeric end\) AS "amount"/);
  assert.match(plain, /ac\.book=2/);
  assert.match(plain, /led\.book in \(8,16,11\) and \(led\.ag_book=8 or coalesce\(led\.ag_book,0\)=0\)/);
  assert.ok(!plain.includes("LEDGER_EXT"));
  const taxed = partyQuery("s.", topPlan("Customers"), 7, ["AREA", "CITY"], dates, "2026");
  assert.match(taxed, /\(S_LASTOT::numeric-SLAB_AMT::numeric\)\*-1/);
  assert.match(taxed, /inner join s\.LEDGER_EXT ledext on ledext\.led_id=led\.led_key and ledext\.il_id is null and ledext\.slab_id=7/);
  assert.match(taxed, /COALESCE\(adata\.txt_AREA,''\) AS "AREA",COALESCE\(adata\.txt_CITY,''\) AS "CITY"/);
  assert.match(taxed, /group by led\.code,ac\.name,acbal\.closing,adata\.txt_AREA,adata\.txt_CITY order by amount desc/);
  const suppliers = partyQuery("s.", topPlan("Suppliers"), 0, ["AREA"], dates, "2026");
  assert.match(suppliers, /ac\.book=3/);
  assert.match(suppliers, /led\.ag_book=13 and led\.book=11/);
  assert.ok(!suppliers.includes("adata"), "suppliers carry no addon columns");
});

test("top items: by value takes the debit note off the purchase, by quantity the unit and the closing stock", () => {
  const sold = valueQuery("s.", topPlan("Item Sold by Value"), [], dates);
  assert.match(sold, /prodled\.book=16 then il_value::numeric\*-1/);
  assert.match(sold, /prodled\.book in \(8,16\) and \(prodled\.led_id>0 or prodled\.trn_module='CHLN-OUT'\)/);
  assert.match(valueQuery("s.", topPlan("Item Purchase by Value"), [], dates), /prodled\.book=11 then il_value.*CHLN-IN/);
  const quantity = quantityQuery("s.", topPlan("Item Sold by Quantity"), 1, [], dates);
  assert.match(quantity, /prodled\.quantity::numeric\*-1 else prodled\.quantity::numeric-prodled\.ag_qty::numeric end\) AS "Quantity"/);
  assert.match(quantity, /prodbal\.prec_flag='RP'/);
  assert.match(quantity, /prodmas\.rep1_uom=prodmas\.pcs_uom then prodbal\.clsg_pcs/);
  assert.match(quantityQuery("s.", topPlan("Item Sold by Quantity"), 2, [], dates), /trn_qty1::numeric\*-1 else trn_qty1::numeric end\) AS "Quantity"/);
});

test("top reports, licence 51: the ones with nothing sold, with 0 for the figures", () => {
  assert.match(absentQuery("s.", topPlan("Customers"), []), /0 AS "Row_No".*ac\.book=2/);
  assert.match(absentQuery("s.", topPlan("Item Sold by Value"), []), /prodmas\.prod_key AS "code",0 AS "Row_No".*prodbal\.prec_flag='RP'/);
  assert.match(absentQuery("s.", topPlan("Item Sold by Quantity"), []), /prodbal\.prod_id AS "prod_id".*prodbal\.clsg_pcs::numeric>0/);
});
