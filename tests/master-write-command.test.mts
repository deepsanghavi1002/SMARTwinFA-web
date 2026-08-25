import assert from "node:assert/strict";
import test from "node:test";
import { validateMasterCommand } from "../platform/legacy-db/master-write.ts";

test("accepts typed account and product core-field commands", () => {
  assert.deepEqual(validateMasterCommand("account", { operation: "create", selectionKey: 2, yearId: "2026040120270331", values: { name: "  Test   Party ", a_short: "TP" } }).values, { "account.name": "Test Party", "account.a_short": "TP" });
  assert.equal(validateMasterCommand("product", { operation: "update", code: 8, version: "42", selectionKey: 3, yearId: "2026040120270331", values: { prod_short: "Bottle", hsn_code: "3923" } }).code, 8);
});

test("rejects unknown fields, stale updates, missing names, and invalid scope", () => {
  assert.throws(() => validateMasterCommand("account", { operation: "create", selectionKey: 2, yearId: "2026040120270331", values: { name: "X", raw_sql: "delete" } }));
  assert.throws(() => validateMasterCommand("product", { operation: "update", code: 8, selectionKey: 3, yearId: "2026040120270331", values: { prod_short: "X" } }));
  assert.throws(() => validateMasterCommand("account", { operation: "create", selectionKey: 2, yearId: "bad", values: { name: "" } }));
});
