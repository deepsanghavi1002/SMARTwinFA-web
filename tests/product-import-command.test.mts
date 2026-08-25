import assert from "node:assert/strict";
import test from "node:test";
import { validateProductImport } from "../platform/legacy-db/product-import.ts";

const yearId = "2025040120260331";

test("accepts a bounded real-product import command", () => {
  assert.deepEqual(validateProductImport({ groupKey: 9, yearId, rows: [{ prod_short: "  ABS  Sheet  ", prod_desc: "ABS Sheet", bar_code: "ABS-1" }] }), {
    groupKey: 9, yearId, rows: [{ prod_short: "ABS Sheet", prod_desc: "ABS Sheet", bill_desc: "", bar_code: "ABS-1", hsn_code: "", uom: "", rate: 0, openingStock: 0 }],
  });
});

test("rejects malformed, duplicate, or missing product import values", () => {
  assert.throws(() => validateProductImport({ groupKey: 0, yearId, rows: [{ prod_short: "A" }] }), /product group/);
  assert.throws(() => validateProductImport({ groupKey: 9, yearId, rows: [{ prod_short: "" }] }), /required on row 1/);
  assert.throws(() => validateProductImport({ groupKey: 9, yearId, rows: [{ prod_short: "A" }, { prod_short: "a" }] }), /Duplicate/);
});
