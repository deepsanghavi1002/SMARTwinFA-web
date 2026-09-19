import assert from "node:assert/strict";
import test from "node:test";
import { resolveTenantContext } from "../platform/context/tenant-context.ts";
import { PermissionDeniedError, requirePermission } from "../platform/rbac/permission-guard.ts";
import { createSyntheticFixture } from "../platform/testing/synthetic-fixtures.ts";

const fixture = createSyntheticFixture();
const alpha = resolveTenantContext("user_alice", { membershipId: "member_alice", companyId: "company_alpha", accountingYearId: "year_2026" }, [...fixture.memberships], [...fixture.companyYears]);

test("allows an exact active grant in the complete server-owned scope", () => {
  assert.equal(requirePermission({ subjectId: "user_alice", context: alpha, permission: "account:read", grants: fixture.grants }).tenantId, "tenant_alpha");
});

test("denies absent, malformed, inactive, and cross-identity grants", () => {
  assert.throws(() => requirePermission({ subjectId: "user_alice", context: alpha, permission: "account:write", grants: fixture.grants }), PermissionDeniedError);
  assert.throws(() => requirePermission({ subjectId: "user_bob", context: alpha, permission: "account:read", grants: fixture.grants }), /denied/);
  assert.throws(() => requirePermission({ subjectId: "user_alice", context: alpha, permission: "bad permission", grants: fixture.grants }), /invalid/);
  assert.throws(() => requirePermission({ subjectId: "user_alice", context: alpha, permission: "account:read", grants: [{ ...fixture.grants[0], active: false }] }), /denied/);
});
