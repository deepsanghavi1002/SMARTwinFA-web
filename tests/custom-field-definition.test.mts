import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomFieldValidationError,
  resolveActiveCustomField,
  validateCustomFieldDefinition,
  type CustomFieldDefinition,
} from "../platform/custom-fields/definition.ts";

const hash = "a".repeat(64);
const context = { tenantId: "tenant_demo", companyId: "company_demo", accountingYearId: "year_2026" };

function definition(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    stableId: "CF-ACCOUNT-001",
    version: "1.0.0",
    owner: "migration-team",
    changeReason: "Replace reviewed legacy add-on definition",
    sourceHash: hash,
    status: "active",
    effectiveFrom: "2026-04-01",
    scope: { module: "custom_fields" },
    entity: "account",
    fieldKey: "customer_class",
    label: "Customer class",
    valueType: "text",
    constraints: { maxLength: 80 },
    uses: ["master", "entry", "report"],
    required: false,
    readPermission: "masters.account.read",
    writePermission: "masters.account.write",
    auditEvent: "masters.account.custom_field_updated",
    ...overrides,
  };
}

test("validates a typed single-entity custom field and resolves a scoped override", () => {
  assert.equal(validateCustomFieldDefinition(definition()).fieldKey, "customer_class");

  const global = definition({ scope: {}, version: "1.0.0" });
  const company = definition({ version: "1.1.0", scope: { module: "custom_fields", tenantId: "tenant_demo", companyId: "company_demo" } });
  assert.equal(resolveActiveCustomField([global, company], "CF-ACCOUNT-001", context, "custom_fields", "2026-08-21")?.version, "1.1.0");
});

test("rejects raw legacy behavior, polymorphic entities, and invalid typed storage", () => {
  const unsafe = definition({ valueType: "decimal", constraints: { precision: 18, scale: 2 } }) as CustomFieldDefinition & { rawSql: string; entityTypes: string[] };
  unsafe.rawSql = "select * from addon_data";
  unsafe.entityTypes = ["account", "product"];

  assert.throws(() => validateCustomFieldDefinition(unsafe), (error: unknown) => {
    assert.ok(error instanceof CustomFieldValidationError);
    assert.match(error.message, /raw SQL/);
    assert.match(error.message, /exactly one entity/);
    return true;
  });

  assert.throws(() => validateCustomFieldDefinition(definition({ valueType: "text", constraints: {} })), /text fields require maxLength/);
  assert.throws(() => validateCustomFieldDefinition(definition({ valueType: "decimal", constraints: { precision: 2, scale: 3 } })), /decimal fields require precision/);
});
