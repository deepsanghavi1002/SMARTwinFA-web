import { type CompanyYearAccess, type Membership } from "../context/tenant-context.ts";
import { type PermissionGrant } from "../rbac/permission-guard.ts";

export type SyntheticFixture = Readonly<{
  memberships: readonly Membership[];
  companyYears: readonly CompanyYearAccess[];
  grants: readonly PermissionGrant[];
}>;

/** Creates deterministic, non-client multi-tenant fixtures for contract tests. */
export function createSyntheticFixture(): SyntheticFixture {
  const memberships = Object.freeze([
    Object.freeze({ id: "member_alice", subjectId: "user_alice", tenantId: "tenant_alpha", active: true, companyIds: Object.freeze(["company_alpha"]), accountingYearIds: Object.freeze(["year_2026"]) }),
    Object.freeze({ id: "member_bob", subjectId: "user_bob", tenantId: "tenant_beta", active: true, companyIds: Object.freeze(["company_beta"]), accountingYearIds: Object.freeze(["year_2026"]) }),
  ]);
  const companyYears = Object.freeze([
    Object.freeze({ tenantId: "tenant_alpha", companyId: "company_alpha", accountingYearId: "year_2026", open: true }),
    Object.freeze({ tenantId: "tenant_beta", companyId: "company_beta", accountingYearId: "year_2026", open: true }),
  ]);
  const grants = Object.freeze([
    Object.freeze({ subjectId: "user_alice", tenantId: "tenant_alpha", permission: "account:read", companyIds: Object.freeze(["company_alpha"]), accountingYearIds: Object.freeze(["year_2026"]), active: true }),
  ]);
  return Object.freeze({ memberships, companyYears, grants });
}
