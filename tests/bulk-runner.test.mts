import assert from "node:assert/strict";
import test from "node:test";
import { completeBulkRun, migrationLedgerKey, processSyntheticBatch, startBulkRun, BulkMigrationError } from "../platform/migration/bulk-runner.ts";
import { resolveTenantContext } from "../platform/context/tenant-context.ts";
import { createSyntheticFixture } from "../platform/testing/synthetic-fixtures.ts";

const fixture = createSyntheticFixture();
const context = resolveTenantContext("user_alice", { membershipId: "member_alice", companyId: "company_alpha", accountingYearId: "year_2026" }, [...fixture.memberships], [...fixture.companyYears]);

test("runs resumable dry-run batches with a scoped idempotency ledger", () => {
  const run = startBulkRun({ id: "run_alpha", context, sourceFingerprint: "a".repeat(64) });
  const batch = processSyntheticBatch(run, { batch: 1, sourceKeys: ["source_one", "source_bad"], invalidKeys: ["source_bad"] });
  assert.deepEqual(batch.migratedKeys, ["source_one"]);
  assert.equal(batch.quarantined[0].reason, "invalid");
  assert.match(migrationLedgerKey(batch, "source_one"), /tenant_alpha:company_alpha:year_2026/);
  assert.equal(completeBulkRun(batch).status, "completed");
});

test("quarantines duplicates and rejects out-of-order or completed batches", () => {
  const run = startBulkRun({ id: "run_alpha", context, sourceFingerprint: "a".repeat(64) });
  const first = processSyntheticBatch(run, { batch: 1, sourceKeys: ["source_one"] });
  const second = processSyntheticBatch(first, { batch: 2, sourceKeys: ["source_one"] });
  assert.equal(second.quarantined[0].reason, "duplicate");
  assert.throws(() => processSyntheticBatch(run, { batch: 2, sourceKeys: [] }), BulkMigrationError);
  assert.throws(() => processSyntheticBatch(completeBulkRun(first), { batch: 2, sourceKeys: [] }), /not active/);
});
