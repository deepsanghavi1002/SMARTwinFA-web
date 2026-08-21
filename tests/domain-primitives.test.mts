import assert from "node:assert/strict";
import test from "node:test";
import { validateJournal, JournalError } from "../platform/domain/journal.ts";
import { applyStockMovement, StockMovementError } from "../platform/domain/stock-movement.ts";
import { createMoney } from "../platform/database/value-semantics.ts";

test("accepts only balanced nonzero double-entry journal lines", () => {
  assert.equal(validateJournal([{ accountId: "account_cash", debit: createMoney("INR", 100), credit: createMoney("INR", 0) }, { accountId: "account_sales", debit: createMoney("INR", 0), credit: createMoney("INR", 100) }]).length, 2);
  assert.throws(() => validateJournal([{ accountId: "account_cash", debit: createMoney("INR", 100), credit: createMoney("INR", 0) }, { accountId: "account_sales", debit: createMoney("INR", 0), credit: createMoney("INR", 90) }]), JournalError);
});
test("prevents synthetic stock movement from going below zero", () => {
  assert.equal(applyStockMovement(5, { productId: "product_one", quantity: 2, direction: "out", referenceId: "voucher_one" }), 3);
  assert.throws(() => applyStockMovement(1, { productId: "product_one", quantity: 2, direction: "out", referenceId: "voucher_one" }), StockMovementError);
});
