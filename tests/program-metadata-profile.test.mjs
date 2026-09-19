import assert from "node:assert/strict";
import test from "node:test";
import { buildProgramMetadataProfile } from "../scripts/profile-program-metadata.mjs";

function input(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    programTypes: { M: 4, S: 1 },
    facts: { programs: 5, updateQueryPrograms: 5, updateWherePrograms: 4, updateOrderByPrograms: 4, addonQueryPrograms: 1, addonFromPrograms: 1, addonWherePrograms: 0, addonOrderByPrograms: 0, orphanFieldRows: 0, programsWithoutFields: 0 },
    fieldFacts: { fields: 20, lookupQueryFields: 2, validationFields: 2, duplicateCheckFields: 1, compulsoryFields: 5, addActiveFields: 10, updateActiveFields: 15 },
    ...overrides,
  };
}

test("creates a deterministic program profile without source expressions", () => {
  const first = buildProgramMetadataProfile(input()); const second = buildProgramMetadataProfile(input());
  assert.equal(first.integrityStatus, "review-required");
  assert.equal(first.profileHash, second.profileHash);
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("requires reconciling program types and surfaces integrity exceptions", () => {
  const badTypes = input(); badTypes.programTypes.M = 3;
  assert.throws(() => buildProgramMetadataProfile(badTypes), /must reconcile/);
  const broken = input(); broken.facts.orphanFieldRows = 1;
  assert.equal(buildProgramMetadataProfile(broken).integrityStatus, "repair-or-exception-required");
});
