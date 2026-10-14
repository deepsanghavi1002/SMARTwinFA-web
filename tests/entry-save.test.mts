import assert from "node:assert/strict";
import test from "node:test";

const { factorCalc, stockUnits } = await import("../lib/entry/calc.ts");

const units = { pcsUom: 16, basePcs: 1, packUom: 20, basePack: 10, weightUom: 0, baseWeight: 0, qty1Uom: 16, baseQty1: 1, qty2Uom: 16, baseQty2: 1, qty3Uom: 16, baseQty3: 1 };

test("Factor_calc gives the quantity itself in the entry unit and the factor in the rate unit", () => {
  assert.equal(factorCalc(16, 16, 99, 7, 1, 16, 2, true), 16);
  assert.equal(factorCalc(16, 5, 12, 16, 1, 16, 2, true), 12);
});

test("Factor_calc multiplies or divides by the unit's base through pieces, rounded to the unit's places", () => {
  assert.equal(factorCalc(3, 5, 0, 6, 2.5, 7, 2, true), 7.5);
  assert.equal(factorCalc(25, 5, 0, 6, 10, 7, 2, false), 2.5);
  assert.equal(factorCalc(5, 5, 0, 6, 0, 7, 2, true), 0);
  assert.equal(factorCalc(5, 5, 0, 6, 3, 0, 2, true), 0);
});

test("stockUnits: a quantity in pieces fills every unit the product has and leaves the rest at zero", () => {
  const trn = stockUnits(16, 16, 16, 16, units, 2, null);
  assert.deepEqual(trn, { trn_pcs: 16, trn_pack: 1.6, trn_weight: 0, trn_qty1: 16, trn_qty2: 16, trn_qty3: 16 });
});

test("stockUnits: the bundle column is copied to the pack figure when the company asks (COPY_BUNDLE_PACK)", () => {
  assert.equal(stockUnits(16, 16, 16, 16, units, 2, "15").trn_pack, 15);
});
