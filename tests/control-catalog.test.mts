import assert from "node:assert/strict";
import test from "node:test";
import { ControlCatalogError, createControlCatalog } from "../platform/context/control-catalog.ts";
import { createSyntheticFixture } from "../platform/testing/synthetic-fixtures.ts";

test("creates an immutable catalog only when memberships resolve to server-owned scope", () => {
  const fixture = createSyntheticFixture();
  const catalog = createControlCatalog(fixture.memberships, fixture.companyYears);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.memberships[0].companyIds), true);
});

test("rejects duplicate and dangling membership control records", () => {
  const fixture = createSyntheticFixture();
  assert.throws(() => createControlCatalog([fixture.memberships[0], fixture.memberships[0]], fixture.companyYears), ControlCatalogError);
  assert.throws(() => createControlCatalog([{ ...fixture.memberships[0], companyIds: ["company_missing"] }], fixture.companyYears), /missing/);
});
