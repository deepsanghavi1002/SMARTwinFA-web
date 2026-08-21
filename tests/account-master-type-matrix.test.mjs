import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountMasterTypeMatrix } from "../scripts/profile-account-master-type-matrix.mjs";

function matrixInput(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    mappings: [
      { legacyType: "T", physicalType: "character varying", fields: 2 },
      { legacyType: "N", physicalType: "money", fields: 1 },
      { legacyType: "I", physicalType: "<unresolved>", fields: 1 },
    ],
    totals: { fieldDefinitions: 4, directPhysicalMappings: 3, unresolvedMappings: 1, moneyMappings: 1, localTimestampMappings: 0, numericMappings: 0 },
    ...overrides,
  };
}

test("builds a deterministic type matrix without claiming target types", () => {
  const first = buildAccountMasterTypeMatrix(matrixInput());
  const second = buildAccountMasterTypeMatrix(matrixInput());

  assert.equal(first.mappings[0].targetTypeStatus, "review-required");
  assert.equal(first.matrixHash, second.matrixHash);
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("rejects unsupported types and non-reconciling totals", () => {
  const unsupported = matrixInput();
  unsupported.mappings[0].physicalType = "jsonb";
  assert.throws(() => buildAccountMasterTypeMatrix(unsupported), /physical type is unsupported/);

  const mismatched = matrixInput();
  mismatched.totals.unresolvedMappings = 0;
  assert.throws(() => buildAccountMasterTypeMatrix(mismatched), /must reconcile/);
});
