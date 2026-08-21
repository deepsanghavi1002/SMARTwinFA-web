import assert from "node:assert/strict";
import test from "node:test";
import { ArchiveRegistryError, createRestorePlan, registerArchive } from "../platform/database/archive-registry.ts";

const archive = { id: "archive_system", sha256: "a".repeat(64), format: "postgres-custom" as const, restricted: true as const, status: "received" as const };

test("registers only checksum-verified restricted PostgreSQL archive provenance", () => {
  assert.equal(Object.isFrozen(registerArchive(archive)), true);
  assert.deepEqual(createRestorePlan(archive), { archiveId: "archive_system", verifyChecksum: true, noOwner: true, noPrivileges: true, singleTransaction: true, executable: false });
});

test("rejects unsafe provenance and executable restore intent", () => {
  assert.throws(() => registerArchive({ ...archive, sha256: "broken" }), ArchiveRegistryError);
  assert.throws(() => createRestorePlan({ ...archive, status: "restored" }), /only received/);
});
