import { type TenantContext } from "../context/tenant-context.ts";

export type PermissionGrant = Readonly<{
  subjectId: string;
  tenantId: string;
  permission: string;
  companyIds?: readonly string[];
  accountingYearIds?: readonly string[];
  active: boolean;
}>;

export class PermissionDeniedError extends Error {
  constructor(message: string) { super(message); this.name = "PermissionDeniedError"; }
}

function validPermission(permission: string) {
  if (!/^[a-z][a-z0-9_-]{2,49}:[a-z][a-z0-9_-]{2,49}$/i.test(permission)) throw new PermissionDeniedError("permission is invalid");
  return permission;
}

/** Deny-by-default authorization against immutable server-owned request scope. */
export function requirePermission(input: { subjectId: string; context: TenantContext; permission: string; grants: readonly PermissionGrant[] }): PermissionGrant {
  validPermission(input.permission);
  const grant = input.grants.find((candidate) => candidate.active
    && candidate.subjectId === input.subjectId
    && candidate.tenantId === input.context.tenantId
    && candidate.permission === input.permission
    && (!candidate.companyIds || candidate.companyIds.includes(input.context.companyId))
    && (!candidate.accountingYearIds || candidate.accountingYearIds.includes(input.context.accountingYearId)));
  if (!grant) throw new PermissionDeniedError("permission is denied for this scoped context");
  return Object.freeze({ ...grant, companyIds: grant.companyIds ? Object.freeze([...grant.companyIds]) : undefined, accountingYearIds: grant.accountingYearIds ? Object.freeze([...grant.accountingYearIds]) : undefined });
}
