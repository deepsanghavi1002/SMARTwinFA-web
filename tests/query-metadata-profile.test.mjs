import assert from "node:assert/strict";
import test from "node:test";
import { buildQueryMetadataProfile } from "../scripts/profile-query-metadata.mjs";

function input(overrides = {}) {
  return { observedOn: "2026-08-21", facts: { queryRows: 10, queryTextRows: 10, otherQueryTextRows: 1, programLinkRows: 10, numericProgramLinkRows: 0, selectStarRows: 1, topRows: 0, dboRows: 0, sysTokenRows: 9, executeRows: 0, orphanNumericProgramLinkRows: 0 }, ...overrides };
}

test("creates a deterministic query-risk profile without query text", () => {
  const first = buildQueryMetadataProfile(input()); const second = buildQueryMetadataProfile(input());
  assert.equal(first.runtimeStatus, "quarantined-not-runnable-in-web-runtime");
  assert.equal(first.profileHash, second.profileHash);
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("requires complete, internally bounded query facts", () => {
  assert.throws(() => buildQueryMetadataProfile(input({ facts: {} })), /all query profile counts/);
  const invalid = input(); invalid.facts.queryTextRows = 11;
  assert.throws(() => buildQueryMetadataProfile(invalid), /cannot exceed queryRows/);
});
