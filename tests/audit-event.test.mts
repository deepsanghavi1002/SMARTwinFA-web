import assert from "node:assert/strict";
import test from "node:test";
import { AuditEventError, createAuditEvent } from "../platform/audit/audit-event.ts";

const context = Object.freeze({ subjectId: "user_alice", membershipId: "member_alice", tenantId: "tenant_alpha", companyId: "company_alpha", accountingYearId: "year_2026" });

test("creates immutable, tenant-scoped audit events and redacts sensitive values", () => {
  const event = createAuditEvent({
    id: "audit_001",
    occurredAt: "2026-08-21T10:00:00.000Z",
    action: "master.account.updated",
    outcome: "succeeded",
    actorId: "user_alice",
    context,
    resource: { type: "account", id: "account_001" },
    correlationId: "request_001",
    details: { changedFields: ["name", "credit_limit"], password: "not-retained", nested: { apiToken: "not-retained", safe: "kept" } },
  });

  assert.equal(event.context.tenantId, "tenant_alpha");
  assert.equal(event.details.password, "[redacted]");
  assert.deepEqual(event.details.nested, { apiToken: "[redacted]", safe: "kept" });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.details), true);
});

test("rejects incomplete audit identifiers and timestamps", () => {
  assert.throws(() => createAuditEvent({
    id: "a", occurredAt: "not-a-date", action: "master.account.updated", outcome: "succeeded", actorId: "user_alice", context,
    resource: { type: "account", id: "account_001" }, correlationId: "request_001",
  }), AuditEventError);
});
