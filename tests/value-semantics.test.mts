import assert from "node:assert/strict";
import test from "node:test";
import { addMoney, createMoney, requireCanonicalId, requireUtcTimestamp, ValueSemanticsError } from "../platform/database/value-semantics.ts";

test("adds same-currency integer minor units without floating point", () => {
  assert.deepEqual(addMoney(createMoney("INR", 125), createMoney("INR", 75)), { currency: "INR", minorUnits: 200 });
});
test("rejects mixed currencies, local timestamps, and unsafe identifiers", () => {
  assert.throws(() => addMoney(createMoney("INR", 1), createMoney("USD", 1)), ValueSemanticsError);
  assert.throws(() => requireUtcTimestamp("2026-08-21 10:00:00"), /UTC/);
  assert.equal(requireUtcTimestamp("2026-08-21T10:00:00.000Z"), "2026-08-21T10:00:00.000Z");
  assert.throws(() => requireCanonicalId("../unsafe"), /invalid/);
});
