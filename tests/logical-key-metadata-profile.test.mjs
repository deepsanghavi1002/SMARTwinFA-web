import assert from "node:assert/strict";
import test from "node:test";
import { buildLogicalKeyMetadataProfile } from "../scripts/profile-logical-key-metadata.mjs";

function input(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    facts: { keyRows: 5, primaryTableRows: 5, foreignTableRows: 0, primaryFirstFieldRows: 5, primaryAdditionalFieldSlots: 0, foreignFirstFieldRows: 0, foreignAdditionalFieldSlots: 0, primaryRowsMissingFirstField: 0, foreignRowsMissingFirstField: 0, recordTypeVariants: 1, blankRecordTypeRows: 0 },
    ...overrides,
  };
}

test("creates a deterministic non-enforcing logical-key profile", () => {
  const first = buildLogicalKeyMetadataProfile(input()); const second = buildLogicalKeyMetadataProfile(input());
  assert.equal(first.relationshipStatus, "no-declared-relationships");
  assert.equal(first.profileHash, second.profileHash);
  assert.doesNotMatch(JSON.stringify(first), /password|rawSql|table_name/i);
});

test("rejects incomplete or internally inconsistent logical-key facts", () => {
  const incomplete = input(); delete incomplete.facts.keyRows;
  assert.throws(() => buildLogicalKeyMetadataProfile(incomplete), /all logical-key profile counts/);
  const inconsistent = input(); inconsistent.facts.foreignFirstFieldRows = 1;
  assert.throws(() => buildLogicalKeyMetadataProfile(inconsistent), /internally inconsistent/);
});
