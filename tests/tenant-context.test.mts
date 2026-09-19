import assert from "node:assert/strict";
import test from "node:test";
import {
  ContextResolutionError,
  postgresContextSettings,
  resolveTenantContext,
  scopedKey,
} from "../platform/context/tenant-context.ts";

const memberships = [
  { id: "member_alice", subjectId: "user_alice", tenantId: "tenant_alpha", active: true, companyIds: ["company_alpha"], accountingYearIds: ["year_2026"] },
  { id: "member_bob", subjectId: "user_bob", tenantId: "tenant_beta", active: true, companyIds: ["company_beta"], accountingYearIds: ["year_2026"] },
];

const companyYears = [
  { tenantId: "tenant_alpha", companyId: "company_alpha", accountingYearId: "year_2026", open: true },
  { tenantId: "tenant_beta", companyId: "company_beta", accountingYearId: "year_2026", open: true },
];

test("resolves and freezes a server-owned tenant context", () => {
  const context = resolveTenantContext("user_alice", { membershipId: "member_alice", companyId: "company_alpha", accountingYearId: "year_2026" }, memberships, companyYears);

  assert.equal(context.tenantId, "tenant_alpha");
  assert.equal(Object.isFrozen(context), true);
  assert.equal(scopedKey(context, "report-cache", "trial-balance"), "report-cache:tenant_alpha:company_alpha:year_2026:trial-balance");
  assert.deepEqual(postgresContextSettings(context), {
    "app.tenant_id": "tenant_alpha",
    "app.company_id": "company_alpha",
    "app.accounting_year_id": "year_2026",
  });
});

test("denies cross-identity and cross-tenant selections", () => {
  assert.throws(
    () => resolveTenantContext("user_alice", { membershipId: "member_bob", companyId: "company_beta", accountingYearId: "year_2026" }, memberships, companyYears),
    ContextResolutionError,
  );
  assert.throws(
    () => resolveTenantContext("user_alice", { membershipId: "member_alice", companyId: "company_beta", accountingYearId: "year_2026" }, memberships, companyYears),
    /company is not allowed/,
  );
});

test("denies closed or malformed scope and prevents unscoped keys", () => {
  assert.throws(
    () => resolveTenantContext("user_alice", { membershipId: "member_alice", companyId: "company_alpha", accountingYearId: "year_2026" }, memberships, [{ ...companyYears[0], open: false }]),
    /unavailable/,
  );
  const context = resolveTenantContext("user_alice", { membershipId: "member_alice", companyId: "company_alpha", accountingYearId: "year_2026" }, memberships, companyYears);
  assert.throws(() => scopedKey(context, "bad namespace", "report"), ContextResolutionError);
  assert.throws(() => scopedKey(context, "report", "../unsafe"), ContextResolutionError);
});
