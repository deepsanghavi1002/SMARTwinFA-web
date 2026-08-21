import assert from "node:assert/strict";
import test from "node:test";
import { buildSmartSystemMetadataProfile } from "../scripts/profile-smart-system-metadata.mjs";

function input(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    schemaStats: { tables: 4, columns: 20, rows: 50, functions: 1, procedures: 1, primaryKeys: 1, foreignKeys: 0, moneyColumns: 0 },
    controlCounts: { companyRows: 3, accountingYearRows: 4, userRows: 2, securityRows: 0, dashboardDefinitionRows: 1, userDashboardRows: 1, printStagingRows: 2, loginRows: 0 },
    ...overrides,
  };
}

test("creates a deterministic smart_system profile without control-plane values", () => {
  const first = buildSmartSystemMetadataProfile(input()); const second = buildSmartSystemMetadataProfile(input());
  assert.equal(first.profileHash, second.profileHash);
  assert.equal(first.routineStatus, "quarantined-not-executed");
  assert.doesNotMatch(JSON.stringify(first), /password=|rawSql|credential(?:Value|Hash)/i);
});

test("requires complete and bounded smart_system profile facts", () => {
  const incomplete = input(); delete incomplete.controlCounts.companyRows;
  assert.throws(() => buildSmartSystemMetadataProfile(incomplete), /all smart_system profile counts/);
  const inconsistent = input(); inconsistent.controlCounts.userRows = 51;
  assert.throws(() => buildSmartSystemMetadataProfile(inconsistent), /internally inconsistent/);
});
