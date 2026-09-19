import assert from "node:assert/strict";
import test from "node:test";
import {
  MetadataValidationError,
  resolveActiveDefinition,
  validateMetadataDefinition,
  type MetadataDefinition,
} from "../platform/metadata/definition.ts";

const sha256 = "a".repeat(64);
const context = { tenantId: "tenant_demo", companyId: "company_demo", accountingYearId: "year_2026" };

function definition(overrides: Partial<MetadataDefinition> = {}): MetadataDefinition {
  return {
    stableId: "MST-001",
    version: "1.0.0",
    owner: "migration-team",
    changeReason: "Create safe account-master read contract",
    sourceHash: sha256,
    status: "active",
    effectiveFrom: "2026-04-01",
    scope: {},
    parameters: [{ id: "account_group", type: "text", required: false }],
    output: [{ id: "account_name", label: "Account name", type: "text", nullable: false, source: { table: "account", column: "name" } }],
    query: { tables: ["account"], filters: [{ field: "account_name", operator: "contains", parameter: "account_group" }], orderBy: [{ field: "account_name", direction: "asc" }], pageSize: 100 },
    actions: [{ id: "read", kind: "read", permission: "masters.account.read" }],
    ...overrides,
  };
}

test("validates an allowlisted metadata contract", () => {
  assert.equal(validateMetadataDefinition(definition()).stableId, "MST-001");
});

test("rejects raw SQL, unscoped accounting years, and unaudited writes", () => {
  const unsafe = definition({
    scope: { accountingYearId: "year_2026" },
    actions: [{ id: "save", kind: "write", permission: "masters.account.write" }],
  }) as MetadataDefinition & { rawSql: string };
  unsafe.rawSql = "select * from account";

  assert.throws(() => validateMetadataDefinition(unsafe), (error: unknown) => {
    assert.ok(error instanceof MetadataValidationError);
    assert.match(error.message, /raw SQL is prohibited/);
    assert.match(error.message, /accounting-year scope requires company and tenant scope/);
    assert.match(error.message, /write action save requires a namespaced audit event/);
    return true;
  });
});

test("selects the most specific active override and then its newest version", () => {
  const global = definition();
  const tenant = definition({ version: "1.2.0", scope: { tenantId: "tenant_demo" } });
  const company = definition({ version: "1.1.0", scope: { tenantId: "tenant_demo", companyId: "company_demo" } });
  const year = definition({ version: "1.0.0", scope: context });

  assert.equal(resolveActiveDefinition([global, tenant, company, year], "MST-001", context, "masters", "2026-05-01")?.version, "1.0.0");
  assert.equal(resolveActiveDefinition([global, tenant, company], "MST-001", context, "masters", "2026-05-01")?.version, "1.1.0");
});

test("rejects ambiguous active overrides and ignores inactive/future definitions", () => {
  const one = definition({ scope: { tenantId: "tenant_demo" } });
  const duplicate = definition({ scope: { tenantId: "tenant_demo" }, owner: "another-owner" });
  assert.throws(() => resolveActiveDefinition([one, duplicate], "MST-001", context, "masters", "2026-05-01"), /ambiguous active definition/);

  const inactive = definition({ status: "approved" });
  const future = definition({ version: "2.0.0", effectiveFrom: "2027-04-01" });
  assert.equal(resolveActiveDefinition([inactive, future], "MST-001", context, "masters", "2026-05-01"), null);
});
