import assert from "node:assert/strict";
import test from "node:test";
import { createControlRecord } from "../platform/database/control-record.ts";
import { reconcile } from "../platform/migration/reconciliation.ts";
import { resolveTenantContext } from "../platform/context/tenant-context.ts";
import { createSyntheticFixture } from "../platform/testing/synthetic-fixtures.ts";
const fixture=createSyntheticFixture(); const context=resolveTenantContext("user_alice",{membershipId:"member_alice",companyId:"company_alpha",accountingYearId:"year_2026"},[...fixture.memberships],[...fixture.companyYears]);
test("uses a tenant-aware composite control identity",()=>assert.match(createControlRecord(context,"company_settings").scopeKey,/tenant_alpha:company_alpha:year_2026/));
test("reports deterministic reconciliation within an explicit tolerance",()=>{assert.equal(reconcile(100,101,1).status,"matched");assert.equal(reconcile(100,102,1).status,"mismatched");});
