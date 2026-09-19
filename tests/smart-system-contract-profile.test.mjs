import assert from "node:assert/strict";
import test from "node:test";
import { buildSmartSystemContractProfile } from "../scripts/profile-smart-system-contracts.mjs";

const facts = {
  observedOn: "2026-08-21",
  routing: { companyRows: 173, yearRows: 16, companyPrimaryKeys: 1, yearPrimaryKeys: 0, declaredForeignKeys: 0, companiesWithRoutingName: 173, yearsWithValidRange: 16, duplicateCompanyKeys: 0, duplicateYearKeys: 0 },
  dashboard: { definitionRows: 19, assignmentRows: 19, definitionsWithRawQuerySlots: 19, orphanAssignments: 0, duplicateDefinitionKeys: 0, duplicateAssignmentKeys: 0 },
  print: { topRows: 0, bodyRows: 0, bottomRows: 0, requestRows: 8, tablesWithPrimaryKey: 0, declaredForeignKeys: 0, moneyColumns: 61 },
  security: { userRows: 4, securityRows: 0, loginRows: 0, credentialLikeColumns: 47, usersWithCredentialMaterial: 4 },
};

test("builds a deterministic and non-restricted semantic profile", () => {
  const profile = buildSmartSystemContractProfile(facts);
  assert.equal(profile.restrictedData, false);
  assert.match(profile.profileHash, /^[a-f0-9]{64}$/);
  assert.equal(profile.profileHash, buildSmartSystemContractProfile(facts).profileHash);
  assert.match(profile.decisions.security, /do not migrate credential fields directly/);
  assert.match(profile.decisions.dashboard, /quarantine raw query slots/);
});

test("rejects incomplete and inconsistent aggregate facts", () => {
  assert.throws(() => buildSmartSystemContractProfile({ ...facts, security: { ...facts.security, loginRows: undefined } }), /non-negative integer/);
  assert.throws(() => buildSmartSystemContractProfile({ ...facts, routing: { ...facts.routing, companiesWithRoutingName: 174 } }), /internally inconsistent/);
});
