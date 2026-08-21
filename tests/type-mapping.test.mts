import assert from "node:assert/strict";
import test from "node:test";
import { mapPhysicalType, TypeMappingError } from "../platform/database/type-mapping.ts";

test("maps approved source physical types to explicit target representations", () => {
  assert.equal(mapPhysicalType("money"), "money_minor_units");
  assert.equal(mapPhysicalType("timestamp"), "utc_timestamp");
});
test("requires review for unresolved legacy type evidence", () => {
  assert.throws(() => mapPhysicalType("unresolved"), TypeMappingError);
});
