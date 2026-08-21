import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const intakeRoot = new URL("../docs/intake/pranavcomputers-2026-08-21/", import.meta.url);

test("records the legacy-author intake with reproducible provenance", async () => {
  const provenance = await readFile(new URL("PROVENANCE.md", intakeRoot), "utf8");
  assert.match(provenance, /f5543eb7e972e5870a325be90819205f1ef22d40ace7e8dd0f89fd035e588926/);
  assert.match(provenance, /427585019d92f0d3a7971d29ecd15fad56f75a0fbf2513b543ca3e63d07c1d57/);
  assert.match(provenance, /22 text files/);
});

test("classifies the source as SQL Server and preserves database blockers", async () => {
  const [sourceMap, ddl, routines, handoff] = await Promise.all([
    readFile(new URL("source-engine-and-database-map.md", intakeRoot), "utf8"),
    readFile(new URL("schema/postgresql-migration-ddl.sql", intakeRoot), "utf8"),
    readFile(new URL("routines/routine-inventory.csv", intakeRoot), "utf8"),
    readFile(new URL("handoff-summary.md", intakeRoot), "utf8"),
  ]);

  assert.match(sourceMap, /Legacy engine \| Microsoft SQL Server/);
  assert.match(sourceMap, /MySQL \| No evidence found/);
  assert.match(ddl, /No executable PostgreSQL DDL is emitted/);
  assert.match(routines, /SP_ENTRY_SAVE/);
  assert.match(routines, /Database definition required/);
  assert.match(handoff, /routine bodies,[\s\S]*are absent/i);
});
