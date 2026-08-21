import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("records SQL Server to PostgreSQL as the confirmed migration direction", async () => {
  const [sourceRegister, databasePlan, backlog] = await Promise.all([
    readFile(new URL("docs/discovery/source-register.md", root), "utf8"),
    readFile(new URL("docs/migration/database-migration.md", root), "utf8"),
    readFile(new URL("docs/migration/backlog.csv", root), "utf8"),
  ]);

  assert.match(sourceRegister, /SQL Server is the system being migrated out of and PostgreSQL is the destination/);
  assert.match(databasePlan, /SQL Server is the legacy source; PostgreSQL is the destination; MySQL is out of scope/);
  assert.match(backlog, /"DISC-DB-001"[\s\S]*"discovered"/);
});
