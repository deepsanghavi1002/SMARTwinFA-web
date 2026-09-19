/**
 * Server-owned tenant context resolution. Browser input may select a company and
 * accounting year, but may never supply the tenant/cell/database routing value.
 */

export type Membership = {
  id: string;
  subjectId: string;
  tenantId: string;
  active: boolean;
  companyIds: readonly string[];
  accountingYearIds: readonly string[];
};

export type CompanyYearAccess = {
  tenantId: string;
  companyId: string;
  accountingYearId: string;
  open: boolean;
};

export type ContextSelection = {
  membershipId: string;
  companyId: string;
  accountingYearId: string;
};

export type TenantContext = Readonly<{
  subjectId: string;
  membershipId: string;
  tenantId: string;
  companyId: string;
  accountingYearId: string;
}>;

export class ContextResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextResolutionError";
  }
}

function requiresId(name: string, value: string) {
  if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(value)) throw new ContextResolutionError(`${name} is invalid`);
  return value;
}

/** Resolves a request context exclusively from server-owned membership/catalog data. */
export function resolveTenantContext(subjectId: string, selection: ContextSelection, memberships: Membership[], companyYears: CompanyYearAccess[]): TenantContext {
  requiresId("subjectId", subjectId);
  requiresId("membershipId", selection.membershipId);
  requiresId("companyId", selection.companyId);
  requiresId("accountingYearId", selection.accountingYearId);

  const membership = memberships.find((candidate) => candidate.id === selection.membershipId);
  if (!membership || membership.subjectId !== subjectId || !membership.active) {
    throw new ContextResolutionError("The selected membership is not active for this identity");
  }
  if (!membership.companyIds.includes(selection.companyId)) {
    throw new ContextResolutionError("The selected company is not allowed by this membership");
  }
  if (!membership.accountingYearIds.includes(selection.accountingYearId)) {
    throw new ContextResolutionError("The selected accounting year is not allowed by this membership");
  }

  const companyYear = companyYears.find((candidate) => candidate.tenantId === membership.tenantId
    && candidate.companyId === selection.companyId
    && candidate.accountingYearId === selection.accountingYearId);
  if (!companyYear || !companyYear.open) {
    throw new ContextResolutionError("The selected company and accounting year are unavailable");
  }

  return Object.freeze({
    subjectId,
    membershipId: membership.id,
    tenantId: membership.tenantId,
    companyId: companyYear.companyId,
    accountingYearId: companyYear.accountingYearId,
  });
}

/** Ensures cache, idempotency, and asynchronous job keys cannot cross scope. */
export function scopedKey(context: TenantContext, namespace: string, key: string) {
  if (!/^[a-z][a-z0-9_.-]{1,99}$/i.test(namespace)) throw new ContextResolutionError("namespace is invalid");
  if (!/^[a-z0-9][a-z0-9_.:-]{0,199}$/i.test(key)) throw new ContextResolutionError("key is invalid");
  return `${namespace}:${context.tenantId}:${context.companyId}:${context.accountingYearId}:${key}`;
}

/** Maps the immutable scope to transaction-local PostgreSQL settings. */
export function postgresContextSettings(context: TenantContext) {
  return Object.freeze({
    "app.tenant_id": context.tenantId,
    "app.company_id": context.companyId,
    "app.accounting_year_id": context.accountingYearId,
  });
}
