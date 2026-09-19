import assert from "node:assert/strict";
import test from "node:test";
import { buildMenuMetadataProfile } from "../scripts/profile-menu-metadata.mjs";

function input(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    facts: { menuRows: 10, rootRows: 2, actionCodeRows: 8, actionMenuRows: 8, programLinkRows: 8, shortcutRows: 1, visibleMarkerRows: 5, hiddenMarkerRows: 4, specialRows: 1, displayRows: 1, duplicateMenuIdGroups: 0, orphanParentRows: 0 },
    ...overrides,
  };
}

test("creates a deterministic menu profile without action or rights values", () => {
  const first = buildMenuMetadataProfile(input());
  const second = buildMenuMetadataProfile(input());

  assert.equal(first.hierarchyStatus, "review-required");
  assert.equal(first.authorizationStatus, "blocked-on-smart_system-and-running-legacy-verification");
  assert.equal(first.profileHash, second.profileHash);
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("requires every count and classifies hierarchy exceptions", () => {
  assert.throws(() => buildMenuMetadataProfile(input({ facts: {} })), /all menu profile counts/);
  const broken = input();
  broken.facts.orphanParentRows = 1;
  assert.equal(buildMenuMetadataProfile(broken).hierarchyStatus, "repair-or-exception-required");
});
