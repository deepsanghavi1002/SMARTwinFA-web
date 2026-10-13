import { test } from "node:test";
import assert from "node:assert/strict";
import { fastHelpSql } from "../lib/report/helpSql.ts";

const PRODUCT = "select FALSE as \"TICK\",product.prod_key,(select pl_mrp from |sys.db|pricelist where prod_id=product.prod_key and pl_pos<>'D' and pl_mrp > 0 order by pl_wefrom desc limit 1) as prod_MRP,product.HSN_CODE"
  + " from ((|sys.db|product_master product left join |sys.db|prod_balance pbal on pbal.prod_id=product.prod_key and pbal.prec_flag='RP')"
  + " left join |sys.db|ADDON_DATA adata on adata.prod_id=product.prod_key and adata.aon_key in (select a.aon_key from |sys.db|addon_data a where a.prod_id=product.prod_key limit 1))"
  + " WHERE product.prod_pos<>'D'   order by product.prod_short";

test("the product's first addon row: one grouped list instead of a lookup per product", () => {
  const sql = fastHelpSql(PRODUCT);
  assert.ok(sql.includes("adata.aon_key in (select min(a.aon_key) from |sys.db|addon_data a where a.prod_id is not null group by a.prod_id)"));
  assert.ok(!sql.includes("a.prod_id=product.prod_key limit 1"));
});

test("the latest MRP: PRICELIST grouped once and joined beside the product", () => {
  const sql = fastHelpSql(PRODUCT);
  assert.ok(sql.includes("help_mrp.pl_mrp as prod_MRP"));
  assert.ok(sql.includes("|sys.db|product_master product left join (select distinct on (prod_id) prod_id, pl_mrp from |sys.db|pricelist where pl_pos<>'D' and pl_mrp > 0 order by prod_id, pl_wefrom desc) help_mrp on help_mrp.prod_id=product.prod_key left join |sys.db|prod_balance"));
  assert.ok(!sql.includes("order by pl_wefrom desc limit 1"));
});

test("already a schema name instead of |sys.db|", () => {
  const sql = fastHelpSql(PRODUCT.split("|sys.db|").join("co27."));
  assert.ok(sql.includes("from co27.addon_data a where a.prod_id is not null group by"));
  assert.ok(sql.includes("co27.product_master product left join (select distinct on (prod_id) prod_id, pl_mrp from co27.pricelist"));
});

test("a query without these lookups is left as it is", () => {
  const plain = "select ac.code, ac.name from |sys.db|account ac where ac.a_pos<>'D' order by ac.name";
  assert.equal(fastHelpSql(plain), plain);
});
