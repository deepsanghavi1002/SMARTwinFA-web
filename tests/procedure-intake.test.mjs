import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { analyzeProcedureText, formatRoutineTriageCsv } from "../scripts/analyze-procedure-intake.mjs";

test("reconciles source and target procedure names", () => {
  const source = `
CREATE PROCEDURE [dbo].[SP_ONE] AS SELECT 1;
GO
ALTER PROCEDURE [dbo].[SP_TWO] AS SELECT TOP 1 * FROM [dbo].[ACCOUNT];
`;
  const target = `
CREATE OR REPLACE PROCEDURE sp_one()
LANGUAGE plpgsql AS $body$ BEGIN NULL; END; $body$;
`;
  const result = analyzeProcedureText(target, source);

  assert.equal(result.source.uniqueNames, 2);
  assert.equal(result.target.uniqueNames, 1);
  assert.equal(result.coverage.matchedNames, 1);
  assert.deepEqual(result.coverage.missingFromPostgres, ["sp_two"]);
  assert.equal(result.classification, "quarantined-not-deployable");
});

test("detects residual T-SQL and unresolved conversion markers", () => {
  const source = "CREATE PROCEDURE [dbo].[SP_ONE] AS SELECT 1;";
  const target = `
CREATE OR REPLACE PROCEDURE sp_one()
LANGUAGE plpgsql AS $body$
BEGIN
  -- TODO(review): replace SQL Server expression
  EXECUTE 'SELECT TOP 1 ISNULL(name, '''') FROM [dbo].account';
  COMMIT;
END;
$body$;
`;
  const result = analyzeProcedureText(target, source);

  assert.equal(result.residualTsql.dboIdentifiers, 1);
  assert.equal(result.residualTsql.topClauses, 1);
  assert.equal(result.residualTsql.isnullCalls, 1);
  assert.equal(result.unresolvedMarkers.todo, 1);
  assert.equal(result.unresolvedMarkers.explicitCommit, 1);
});

test("classifies a complete structurally clean conversion without claiming runtime parity", () => {
  const source = "CREATE PROCEDURE [dbo].[SP_ONE] AS SELECT 1;";
  const target = "CREATE OR REPLACE PROCEDURE sp_one() LANGUAGE plpgsql AS $body$ BEGIN NULL; END; $body$;";
  const result = analyzeProcedureText(target, source);

  assert.equal(result.classification, "structurally-clean-unverified");
  assert.equal(result.coverage.sourceNameCoveragePercent, 100);
  assert.equal(result.routineTriage.summary.staticCandidates, 1);
  assert.equal(result.routineTriage.routines[0].status, "static-candidate");
});

test("creates a per-routine repair queue with explicit blocker reasons", () => {
  const source = `
CREATE PROCEDURE [dbo].[SP_CLEAN] AS SELECT 1;
CREATE PROCEDURE [dbo].[SP_REPAIR] AS SELECT 1;
`;
  const target = `
CREATE OR REPLACE PROCEDURE sp_clean()
LANGUAGE plpgsql AS $body$ BEGIN NULL; END; $body$;

CREATE OR REPLACE PROCEDURE sp_repair()
LANGUAGE plpgsql AS $body$
BEGIN
  -- TODO(review): remove the SQL Server fragment
  EXECUTE 'SELECT TOP 1 * FROM [dbo].account';
  COMMIT;
END;
$body$;
`;
  const result = analyzeProcedureText(target, source);
  const repair = result.routineTriage.routines.find(({ name }) => name === "sp_repair");

  assert.equal(result.routineTriage.summary.routines, 2);
  assert.equal(result.routineTriage.summary.staticCandidates, 1);
  assert.equal(result.routineTriage.summary.repairRequired, 1);
  assert.deepEqual(repair.blockers, ["residual-tsql", "unresolved-todo", "dynamic-sql-review", "transaction-review"]);
  assert.equal(result.routineTriage.summary.blockerCounts["residual-tsql"], 1);

  const csv = formatRoutineTriageCsv(result);
  assert.match(csv, /^name,source_name_matched,start_line,lines,status,blockers,/);
  assert.match(csv, /sp_clean,true,\d+,\d+,static-candidate,/);
  assert.match(csv, /sp_repair,true,\d+,\d+,repair-required,residual-tsql;unresolved-todo;dynamic-sql-review;transaction-review,/);
});

test("retains the received procedure bundle analysis as quarantined evidence", async () => {
  const analysis = JSON.parse(await readFile(new URL("../docs/intake/postgres-procedures-2026-08-21/analysis.json", import.meta.url), "utf8"));

  assert.equal(analysis.artifacts.postgres.sha256, "c523c759b028f3b425b1b02c7aad39924bf428fe013883c3b46676b84f76c9b2");
  assert.equal(analysis.artifacts.sqlServer.sha256, "bfae0e7e424a02a709583f122832d76cfa6b683140eea26fa8092c8e3269e4d3");
  assert.equal(analysis.source.uniqueNames, 325);
  assert.equal(analysis.target.uniqueNames, 282);
  assert.equal(analysis.classification, "quarantined-not-deployable");
  assert.ok(analysis.coverage.missingFromPostgres.includes("sp_entry_save"));
  assert.ok(analysis.unresolvedMarkers.todo > 0);
  assert.equal(analysis.routineTriage.summary.routines, 282);
  assert.equal(analysis.routineTriage.summary.staticCandidates, 19);
  assert.equal(analysis.routineTriage.summary.repairRequired, 263);
});
