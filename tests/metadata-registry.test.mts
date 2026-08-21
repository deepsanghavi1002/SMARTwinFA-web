import assert from "node:assert/strict";
import test from "node:test";
import { type MetadataDefinition } from "../platform/metadata/definition.ts";
import { metadataDefinitionKey, MetadataRegistryError, registerDraft, transitionDefinition } from "../platform/metadata/registry.ts";

function draft(overrides: Partial<MetadataDefinition> = {}): MetadataDefinition {
  return {
    stableId: "RPT-001",
    version: "1.0.0",
    owner: "reporting-team",
    changeReason: "Create a typed trial-balance definition",
    sourceHash: "b".repeat(64),
    status: "draft",
    effectiveFrom: "2026-04-01",
    scope: {},
    parameters: [{ id: "as_of_date", type: "date", required: true }],
    output: [{ id: "account_name", label: "Account", type: "text", nullable: false, source: { table: "account_balance", column: "account_name" } }],
    query: { tables: ["account_balance"], filters: [], orderBy: [{ field: "account_name", direction: "asc" }], pageSize: 100 },
    actions: [{ id: "read", kind: "read", permission: "reports.trial_balance.read" }],
    ...overrides,
  };
}

function advanceToActive(registry: readonly MetadataDefinition[], key: string) {
  let next = transitionDefinition(registry, key, "validated", "reviewer_one", "2026-08-21T10:00:00Z").registry;
  next = transitionDefinition(next, key, "approved", "reviewer_one", "2026-08-21T10:01:00Z").registry;
  return transitionDefinition(next, key, "active", "release_one", "2026-08-21T10:02:00Z");
}

test("moves a definition through the controlled lifecycle with immutable audit evidence", () => {
  const definition = draft();
  const key = metadataDefinitionKey(definition);
  const registry = registerDraft([], definition);
  const active = advanceToActive(registry, key);

  assert.equal(active.definition.status, "active");
  assert.equal(active.event.event, "metadata.definition_activated");
  assert.equal(active.event.definitionKey, key);
  assert.equal(Object.isFrozen(active.definition), true);
  assert.equal(Object.isFrozen(active.definition.output), true);

  const retired = transitionDefinition(active.registry, key, "retired", "release_one", "2026-09-01T10:00:00Z");
  assert.equal(retired.definition.status, "retired");
  assert.equal(retired.event.event, "metadata.definition_retired");
});

test("rejects duplicate drafts and skipped approvals", () => {
  const definition = draft();
  const key = metadataDefinitionKey(definition);
  const registry = registerDraft([], definition);

  assert.throws(() => registerDraft(registry, definition), /already exists/);
  assert.throws(() => transitionDefinition(registry, key, "active", "release_one", "2026-08-21T10:00:00Z"), /cannot transition/);
});

test("blocks overlapping active versions at the same scope but allows scoped overrides", () => {
  const first = draft();
  const second = draft({ version: "2.0.0", effectiveFrom: "2026-07-01" });
  const override = draft({ version: "1.1.0", scope: { tenantId: "tenant_demo" } });
  let registry = registerDraft([], first);
  registry = registerDraft(registry, second);
  registry = registerDraft(registry, override);
  registry = advanceToActive(registry, metadataDefinitionKey(first)).registry;

  let secondReady = transitionDefinition(registry, metadataDefinitionKey(second), "validated", "reviewer_one", "2026-08-21T10:03:00Z").registry;
  secondReady = transitionDefinition(secondReady, metadataDefinitionKey(second), "approved", "reviewer_one", "2026-08-21T10:04:00Z").registry;
  assert.throws(
    () => transitionDefinition(secondReady, metadataDefinitionKey(second), "active", "release_one", "2026-08-21T10:05:00Z"),
    MetadataRegistryError,
  );

  const overrideActive = advanceToActive(secondReady, metadataDefinitionKey(override));
  assert.equal(overrideActive.definition.status, "active");
});
