import assert from "node:assert/strict";
import test from "node:test";
import { resolveTenantContext } from "../platform/context/tenant-context.ts";
import { beginScopedTransaction, closeScopedTransaction, requireTransactionScope, ScopedTransactionError } from "../platform/database/transaction-context.ts";
import { createSyntheticFixture } from "../platform/testing/synthetic-fixtures.ts";

const fixture = createSyntheticFixture();
const alpha = resolveTenantContext("user_alice", { membershipId: "member_alice", companyId: "company_alpha", accountingYearId: "year_2026" }, [...fixture.memberships], [...fixture.companyYears]);
const beta = resolveTenantContext("user_bob", { membershipId: "member_bob", companyId: "company_beta", accountingYearId: "year_2026" }, [...fixture.memberships], [...fixture.companyYears]);

test("binds all PostgreSQL context settings to an active scoped transaction", () => {
  const transaction = beginScopedTransaction(alpha);
  assert.equal(transaction.settings["app.tenant_id"], "tenant_alpha");
  assert.equal(requireTransactionScope(transaction, alpha), transaction);
  assert.equal(closeScopedTransaction(transaction, "committed").state, "committed");
});

test("denies cross-scope reuse and completed transaction reuse", () => {
  const transaction = beginScopedTransaction(alpha);
  assert.throws(() => requireTransactionScope(transaction, beta), ScopedTransactionError);
  assert.throws(() => requireTransactionScope(closeScopedTransaction(transaction, "rolled_back"), alpha), /not active/);
});
