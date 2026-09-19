import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountMasterFieldContract } from "../scripts/export-account-master-contract.mjs";

function contractInput(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    source: {
      programTopKey: 14,
      updateDefinitionChecksum: "a".repeat(32),
      addonDefinitionChecksum: "b".repeat(32),
    },
    fields: [
      {
        programBodyKey: 1,
        addOrder: 2,
        updateOrder: 1,
        sourceTable: "ACCOUNT",
        sourceColumn: "NAME",
        legacyType: "T",
        inputType: "T",
        declaredLength: 60,
        minimumLength: 1,
        maximumLength: 60,
        decimalPlaces: 0,
        addActive: true,
        updateActive: true,
        required: true,
        duplicateCheck: true,
        hasLookupQuery: false,
      },
    ],
    ...overrides,
  };
}

test("builds a stable non-executable Account Master field contract", () => {
  const first = buildAccountMasterFieldContract(contractInput());
  const second = buildAccountMasterFieldContract(contractInput());

  assert.equal(first.source.programTopId, "program_top:14");
  assert.equal(first.fields[0].sourceId, "program_body:1");
  assert.deepEqual(first.fields[0].source.column, { status: "direct", column: "NAME" });
  assert.equal(first.fields[0].mappingStatus, "unreviewed");
  assert.equal(first.contractHash, second.contractHash);
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("rejects wrong source program and sensitive or malformed field identifiers", () => {
  assert.throws(() => buildAccountMasterFieldContract(contractInput({ source: { programTopKey: 15, updateDefinitionChecksum: "a".repeat(32), addonDefinitionChecksum: "b".repeat(32) } })), /expected program_top:14/);

  const unsafe = contractInput();
  unsafe.fields[0].sourceColumn = "PASSWORD";
  assert.throws(() => buildAccountMasterFieldContract(unsafe), /non-sensitive catalog identifier/);

  const duplicate = contractInput({ fields: [contractInput().fields[0], { ...contractInput().fields[0] }] });
  assert.throws(() => buildAccountMasterFieldContract(duplicate), /cannot repeat/);
});

test("quarantines non-identifier source expressions instead of exporting them", () => {
  const expression = contractInput();
  expression.fields[0].sourceColumn = "ACCOUNT.CODE";

  const contract = buildAccountMasterFieldContract(expression);
  assert.deepEqual(contract.fields[0].source.column, { status: "expression-review-required" });
  assert.doesNotMatch(JSON.stringify(contract), /ACCOUNT\.CODE/);
});
