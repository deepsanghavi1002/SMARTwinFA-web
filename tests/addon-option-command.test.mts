import assert from "node:assert/strict";
import test from "node:test";
import { validateAddonFieldCommand, validateAddonOptionCommand } from "../platform/legacy-db/addon-master.ts";

test("normalizes allowlisted add-on option commands", () => {
  assert.deepEqual(validateAddonOptionCommand({ operation: "create", fieldKey: 7, name: "  Blue   Shade ", shortName: " BL " }), { operation: "create", fieldKey: 7, code: undefined, name: "Blue Shade", shortName: "BL", version: undefined });
  assert.deepEqual(validateAddonOptionCommand({ operation: "delete", fieldKey: 7, code: 12, version: "900" }), { operation: "delete", fieldKey: 7, code: 12, name: undefined, shortName: undefined, version: "900" });
});

test("rejects missing names, invalid keys, stale updates, and unknown operations", () => {
  assert.throws(() => validateAddonOptionCommand({ operation: "create", fieldKey: 7, name: "" }));
  assert.throws(() => validateAddonOptionCommand({ operation: "update", fieldKey: 7, code: 12, name: "Blue" }));
  assert.throws(() => validateAddonOptionCommand({ operation: "delete", fieldKey: -1, code: 12, version: "1" }));
  assert.throws(() => validateAddonOptionCommand({ operation: "execute", fieldKey: 7 }));
});

test("normalizes a bounded real add-on field definition command", () => {
  assert.deepEqual(validateAddonFieldCommand({ operation: "create", relation: "a", description: "  Delivery Zone ", shortName: " Zone ", storageName: "KEY_ZONE", type: "m", serial: "41", required: true, masterVisible: true, entryPosition: "Header" }), {
    operation: "create", key: undefined, version: undefined, relation: "A", description: "Delivery Zone", shortName: "Zone", storageName: "key_zone", type: "M", serial: 41, required: true, masterVisible: true, entryPosition: "Header",
  });
  assert.throws(() => validateAddonFieldCommand({ operation: "create", relation: "A", description: "Zone", shortName: "Zone", storageName: "drop table", type: "T", serial: 1 }));
  assert.throws(() => validateAddonFieldCommand({ operation: "update", key: 7, relation: "A", description: "Zone", shortName: "Zone", storageName: "key_zone", type: "T", serial: 1 }));
});
