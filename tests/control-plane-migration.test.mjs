import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../db/migrations/0001_control_plane.sql", import.meta.url);

test("control-plane migration carries tenant scope through keys and relationships", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of ["company", "accounting_year", "membership", "role", "audit.event", "jobs.job", "migration.run"]) {
    assert.match(sql, new RegExp(`CREATE TABLE (?:control\\.)?${table.replace(".", "\\.")} \\([\\s\\S]*?tenant_id uuid NOT NULL`, "i"));
  }
  assert.match(sql, /FOREIGN KEY \(tenant_id, company_id, accounting_year_id\) REFERENCES control\.accounting_year/g);
  assert.doesNotMatch(sql, /search_path|CREATE EXTENSION|BYPASSRLS/i);
});

test("control-plane migration forces RLS and revokes public access", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY tenant_isolation/);
  assert.match(sql, /current_setting\(''app\.tenant_id'', true\)/);
  assert.match(sql, /CREATE POLICY company_scope ON jobs\.job AS RESTRICTIVE/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES[\s\S]*FROM PUBLIC/);
});

test("control-plane migration stores only hashes or secret references", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /secret_reference text NOT NULL/);
  assert.match(sql, /token_hash bytea NOT NULL/);
  assert.match(sql, /password_hash text/);
  assert.match(sql, /password_reset_required boolean NOT NULL DEFAULT true/);
  assert.doesNotMatch(sql, /password\s+text|connection_string|secret_value/i);
});
