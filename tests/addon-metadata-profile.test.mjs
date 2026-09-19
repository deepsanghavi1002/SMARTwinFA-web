import assert from "node:assert/strict";
import test from "node:test";
import { buildAddonMetadataProfile } from "../scripts/profile-addon-metadata.mjs";

function profileInput(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    definitions: {
      total: 2, legacyTypes: { I: 1, M: 1 }, saveMapped: 2, validationMarked: 0,
      masterScoped: 1, entryScoped: 2, documentPrintScoped: 2, calculatedMarked: 2,
      relationshipMarked: 2, errorMarked: 0, positionedForMaster: 2, positionedForEntry: 2,
    },
    dataProjection: { rows: 3, accountScopedRows: 1, productScopedRows: 2, dualScopedRows: 0, unscopedRows: 0, unmatchedAccountCodes: 0 },
    ...overrides,
  };
}

test("creates a deterministic, aggregate-only add-on metadata profile", () => {
  const first = buildAddonMetadataProfile(profileInput());
  const second = buildAddonMetadataProfile(profileInput());

  assert.equal(first.restrictedData, false);
  assert.equal(first.dataProjection.model, "polymorphic-legacy-projection-review-required");
  assert.equal(first.dataProjection.status, "review-required");
  assert.equal(first.profileHash, second.profileHash);
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("rejects invalid source type counts and flags unscoped or unmatched data", () => {
  const exceptional = profileInput();
  exceptional.dataProjection.unscopedRows = 1;
  exceptional.dataProjection.unmatchedAccountCodes = 2;
  assert.equal(buildAddonMetadataProfile(exceptional).dataProjection.status, "repair-or-exception-required");

  const invalid = profileInput();
  invalid.definitions.legacyTypes = { input: 2 };
  assert.throws(() => buildAddonMetadataProfile(invalid), /legacy type code is invalid/);
});
