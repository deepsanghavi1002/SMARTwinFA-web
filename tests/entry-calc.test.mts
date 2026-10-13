import assert from "node:assert/strict";
import test from "node:test";

const { bundleQuantity, itemSlabAmounts, rateFactor, round, slabRunTotal } = await import("../lib/entry/calc.ts");

type Row = Parameters<typeof slabRunTotal>[0][number];
const row = (change: Partial<Row>): Row => ({ mathOp: "A", calc: "A", roundPlaces: 2, link: -1, itemWise: false, percent: 0, amount: 0, fromPercent: false, ...change });

/** The SALE book's slab (licence 21): product amount, five item-wise discounts, GST, UTGST on the figure before GST, TCS, add / less, rounding. */
const SALE_SLAB: Row[] = [
  row({}),
  row({ mathOp: "L", itemWise: true }), row({ mathOp: "L", itemWise: true }), row({ mathOp: "L", itemWise: true }),
  row({ mathOp: "L", itemWise: true }), row({ mathOp: "L", itemWise: true }),
  row({ itemWise: true }),
  row({ itemWise: true, link: 5 }),
  row({ fromPercent: true }),
  row({ mathOp: "U", calc: "M" }),
  row({ mathOp: "U", calc: "B", roundPlaces: 0 }),
];

test("Math.Round away from zero, as the desktop rounds", () => {
  assert.equal(round(2.345, 2), 2.35);
  assert.equal(round(-2.345, 2), -2.35);
  assert.equal(round(1918.05, 0), 1918);
  assert.equal(round(0.5, 0), 1);
});

test("box × packing + loose gives the quantity", () => {
  assert.equal(bundleQuantity("1", "144", ""), 144);
  assert.equal(bundleQuantity("15", "1", "1"), 16);
  assert.equal(bundleQuantity("", "", ""), null);
  assert.equal(bundleQuantity("3", "", ""), 3);
});

test("the factor is the quantity in the rate's unit", () => {
  const units = { pcsUom: 5, basePcs: 1, packUom: 23, basePack: 48, weightUom: 13, baseWeight: 2, qty1Uom: 16, baseQty1: 3, qty2Uom: 0, baseQty2: 0, qty3Uom: 0, baseQty3: 0 };
  assert.equal(rateFactor(96, 5, 5, units, 3), 96);
  assert.equal(rateFactor(96, 5, 23, units, 3), 2); // 96 pieces = 2 packs of 48
  assert.equal(rateFactor(2, 23, 5, units, 3), 96);
  assert.equal(rateFactor(10, 5, 13, units, 3), 5); // base_weight 2: 10 pieces = 5
  assert.equal(rateFactor(10, 5, 16, units, 3), 30); // qty1 multiplies
  assert.equal(rateFactor(7, 5, 99, units, 3), 7); // an unknown unit keeps the quantity
});

test("saved bill DSAL/26-27/827 works out to its amount (item-wise discounts, IGST, TCS, add / less, rounding)", () => {
  const amounts = itemSlabAmounts(2400, SALE_SLAB, [0, 22, 2, 3, 4, 5, 18, 0, 0, 0, 0]);
  assert.deepEqual([...amounts.entries()], [[1, 528], [2, 37.44], [3, 55.04], [4, 71.18], [5, 85.42], [6, 292.13], [7, 0]]);
  const slab = SALE_SLAB.map((item, index) => (index === 8 ? { ...item, amount: 2 } : index === 9 ? { ...item, amount: 1 } : item));
  const result = slabRunTotal(slab, 2400, true, amounts);
  assert.equal(result.amounts[10], -0.05);
  assert.equal(result.runTotals[6], 1915.05);
  assert.equal(result.final, 1918);
});

test("UTGST takes its % of the figure before CGST, as its link names", () => {
  const amounts = itemSlabAmounts(1000, SALE_SLAB, [0, 10, 0, 0, 0, 0, 9, 9, 0, 0, 0]);
  assert.equal(amounts.get(6), 81);
  assert.equal(amounts.get(7), 81);
});

test("a % slab row takes its % of the running total; a typed first row stands when the book has no products", () => {
  const rows = [row({}), row({ fromPercent: true, percent: 2 }), row({ mathOp: "U", calc: "A" })];
  const result = slabRunTotal([{ ...rows[0], amount: 1000.4 }, rows[1], rows[2]], 0, false, new Map());
  assert.equal(result.amounts[1], 20.01);
  assert.equal(result.final, 1020);
});
