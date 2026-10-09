import assert from "node:assert/strict";
import test from "node:test";
import { pivotFundFlow } from "../lib/report/fundFlowPivot.ts";

test("fund flow pivots by book, totals rows and shares each side", () => {
  const rows = pivotFundFlow(["BANK", "CASH"], [
    { side: "RECEIPT", particular: "SALES", book: "BANK", amount: 750 },
    { side: "RECEIPT", particular: "SALES", book: "CASH", amount: 250 },
    { side: "RECEIPT", particular: "  Opening", book: "BANK", amount: 1000 },
    { side: "PAYMENT", particular: "RENT", book: "CASH", amount: -400 },
    { side: "PAYMENT", particular: "WAGES", book: "BANK", amount: -600 },
    { side: "PAYMENT", particular: "OTHER", book: "UNKNOWN", amount: -5 },
  ]);
  const by = (side: string, name: string) => rows.find((row) => row.SMART_SELECTED_SCHDULE === side && row.PARTICULAR === name)!;
  assert.equal(rows.length, 4);
  assert.deepEqual([by("RECEIPT", "SALES").BANK, by("RECEIPT", "SALES").CASH, by("RECEIPT", "SALES").TOTAL, by("RECEIPT", "SALES").PERC], [750, 250, 1000, 50]);
  assert.equal(by("RECEIPT", "  Opening").CASH, null);
  assert.equal(by("PAYMENT", "RENT").PERC, -40);
  assert.equal(by("PAYMENT", "WAGES").PERC, -60);
});

test("fund flow gives no share to a side that nets to nothing", () => {
  const rows = pivotFundFlow(["BANK"], [{ side: "RECEIPT", particular: "A", book: "BANK", amount: 5 }, { side: "RECEIPT", particular: "B", book: "BANK", amount: -5 }]);
  assert.ok(rows.every((row) => row.PERC === null));
});
