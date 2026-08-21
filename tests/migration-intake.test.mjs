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

test("records sanitized local PostgreSQL restore evidence without claiming parity", async () => {
  const report = await readFile(new URL("../docs/intake/postgres-local-restore-2026-08-21.md", import.meta.url), "utf8");

  assert.match(report, /705,743/);
  assert.match(report, /146,964/);
  assert.match(report, /283 across 282 names/);
  assert.match(report, /smart_system` is absent/);
  assert.match(report, /Financial parity still[\s\S]*independent totals/);
  assert.doesNotMatch(report, /connection\.ini|Password=/i);
});

test("retains an aggregate-only metadata catalogue for the first Account Master contract", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/intake/postgres-metadata-catalog-2026-08-21.json", import.meta.url), "utf8"));

  assert.equal(catalogue.restrictedData, false);
  assert.equal(catalogue.metadata.accountMaster.sourceId, "program_top:14");
  assert.equal(catalogue.metadata.accountMaster.fieldCount, 87);
  assert.equal(catalogue.metadata.accountMaster.lookupQueryFields, 12);
  assert.match(catalogue.catalogHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(catalogue), /select\s|password|rawSql/i);
});

test("documents the Account Master structural field contract without asserting functional parity", async () => {
  const report = await readFile(new URL("../docs/intake/account-master-field-contract-2026-08-21.md", import.meta.url), "utf8");

  assert.match(report, /87 ordered field mappings/);
  assert.match(report, /expression-review-required/);
  assert.match(report, /no target field, lookup, validation,[\s\S]*write command is approved/i);
  assert.doesNotMatch(report, /select\s|password=/i);
});

test("documents Account Master integrity exceptions without exposing client rows", async () => {
  const report = await readFile(new URL("../docs/intake/account-master-integrity-profile-2026-08-21.md", import.meta.url), "utf8");

  assert.match(report, /5 duplicate.*groups/i);
  assert.match(report, /1 unmatched reference/i);
  assert.match(report, /no automatic cleanup or constraint migration[\s\S]*authorized/i);
  assert.doesNotMatch(report, /select\s|password=/i);
});

test("documents polymorphic add-on storage risk without exposing field definitions or values", async () => {
  const report = await readFile(new URL("../docs/intake/addon-metadata-profile-2026-08-21.md", import.meta.url), "utf8");

  assert.match(report, /118 add-on definitions/);
  assert.match(report, /polymorphic legacy projection/i);
  assert.match(report, /24 unmatched account codes/);
  assert.match(report, /does not authorize migration writes/i);
  assert.doesNotMatch(report, /select\s|password=/i);
});

test("documents Account Master type ambiguity without claiming target semantics", async () => {
  const report = await readFile(new URL("../docs/intake/account-master-type-matrix-2026-08-21.md", import.meta.url), "utf8");

  assert.match(report, /76 resolve directly/);
  assert.match(report, /11 do not/);
  assert.match(report, /does not map legacy codes to target types/i);
  assert.doesNotMatch(report, /select\s|password=/i);
});

test("documents menu hierarchy risk without exposing actions or marker values", async () => {
  const report = await readFile(new URL("../docs/intake/menu-metadata-profile-2026-08-21.md", import.meta.url), "utf8");

  assert.match(report, /592/);
  assert.match(report, /one orphan hierarchy reference/i);
  assert.match(report, /cannot be copied into[\s\S]*the web UI/i);
  assert.doesNotMatch(report, /select\s|password=/i);
});

test("documents program metadata integrity risk without exporting source fragments", async () => {
  const report = await readFile(new URL("../docs/intake/program-metadata-profile-2026-08-21.md", import.meta.url), "utf8");

  assert.match(report, /1,308/);
  assert.match(report, /five orphan field records/i);
  assert.match(report, /no fragment is permitted in the web runtime/i);
  assert.doesNotMatch(report, /select\s|password=/i);
});
