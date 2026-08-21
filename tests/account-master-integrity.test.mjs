import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountMasterIntegrityProfile } from "../scripts/profile-account-master-integrity.mjs";

const tableNames = ["account", "address", "ac_balance", "addon_data", "int_master", "balsheet", "idopt_master", "book_properties"];

function profileInput(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    tables: tableNames.map((name) => ({ name, rows: 1, moneyColumns: 0, localTimestampColumns: 0, textColumns: 0, nullableColumns: 0 })),
    candidates: [{ table: "account", columns: ["code"], rows: 1, missing: 0, duplicateGroups: 0, evidence: "metadata-declared" }],
    relationships: [{ childTable: "address", childColumns: ["code"], parentTable: "account", parentColumns: ["code"], childRows: 1, missingKeyRows: 0, unmatchedRows: 0, duplicateNaturalKeyGroups: 0 }],
    ...overrides,
  };
}

test("creates a deterministic aggregate-only integrity profile", () => {
  const first = buildAccountMasterIntegrityProfile(profileInput());
  const second = buildAccountMasterIntegrityProfile(profileInput());

  assert.equal(first.restrictedData, false);
  assert.equal(first.candidateKeys[0].status, "review-required");
  assert.equal(first.candidateRelationships[0].status, "review-required");
  assert.equal(first.profileHash, second.profileHash);
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("requires the entire source boundary and marks integrity exceptions for repair", () => {
  assert.throws(() => buildAccountMasterIntegrityProfile(profileInput({ tables: [] })), /boundary tables/);

  const exceptional = profileInput();
  exceptional.relationships[0].unmatchedRows = 1;
  exceptional.relationships[0].duplicateNaturalKeyGroups = 2;
  const profile = buildAccountMasterIntegrityProfile(exceptional);
  assert.equal(profile.candidateRelationships[0].status, "repair-or-exception-required");

  const invalid = profileInput();
  invalid.candidates[0].columns = ["Code"];
  assert.throws(() => buildAccountMasterIntegrityProfile(invalid), /lower-case catalog identifier/);
});
