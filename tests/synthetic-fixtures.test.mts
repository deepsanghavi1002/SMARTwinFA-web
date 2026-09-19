import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticFixture } from "../platform/testing/synthetic-fixtures.ts";

test("provides deterministic isolated synthetic tenant fixtures", () => {
  const fixture = createSyntheticFixture();
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(fixture.memberships.length, 2);
  assert.notEqual(fixture.memberships[0].tenantId, fixture.memberships[1].tenantId);
  assert.equal(fixture.grants[0].subjectId, fixture.memberships[0].subjectId);
});
