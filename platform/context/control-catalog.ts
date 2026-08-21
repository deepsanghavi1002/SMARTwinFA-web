import { type CompanyYearAccess, type Membership } from "./tenant-context.ts";

export type ControlCatalog = Readonly<{ memberships: readonly Membership[]; companyYears: readonly CompanyYearAccess[] }>;
export class ControlCatalogError extends Error { constructor(message: string) { super(message); this.name = "ControlCatalogError"; } }

/** Validates server-owned control data before it is used for request-context resolution. */
export function createControlCatalog(memberships: readonly Membership[], companyYears: readonly CompanyYearAccess[]): ControlCatalog {
  if (!memberships.length || !companyYears.length) throw new ControlCatalogError("control catalog cannot be empty");
  if (new Set(memberships.map((membership) => membership.id)).size !== memberships.length) throw new ControlCatalogError("membership ids must be unique");
  for (const membership of memberships) {
    if (!membership.companyIds.length || !membership.accountingYearIds.length) throw new ControlCatalogError("membership must contain company and accounting-year access");
    for (const companyId of membership.companyIds) for (const accountingYearId of membership.accountingYearIds) {
      if (!companyYears.some((candidate) => candidate.tenantId === membership.tenantId && candidate.companyId === companyId && candidate.accountingYearId === accountingYearId)) throw new ControlCatalogError("membership scope is missing from the company-year catalog");
    }
  }
  return Object.freeze({
    memberships: Object.freeze(memberships.map((membership) => Object.freeze({ ...membership, companyIds: Object.freeze([...membership.companyIds]), accountingYearIds: Object.freeze([...membership.accountingYearIds]) }))),
    companyYears: Object.freeze(companyYears.map((companyYear) => Object.freeze({ ...companyYear }))),
  });
}
