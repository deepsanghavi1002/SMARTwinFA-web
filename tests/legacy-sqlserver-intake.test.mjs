import assert from "node:assert/strict";
import test from "node:test";

import { LegacySqlServerIntakeError, buildSanitizedSqlServerInventory, parseLegacyConnectionIni } from "../scripts/intake-legacy-sqlserver.mjs";

const databaseFacts = [
  {
    databaseName: "smart_setup", compatibilityLevel: 160, collationName: "SQL_Latin1_General_CP1_CI_AS",
    schemas: 2, tables: 37, columns: 940, views: 3, procedures: 20, functions: 8, triggers: 1, indexes: 44,
    primaryKeys: 36, uniqueConstraints: 2, foreignKeys: 1, checkConstraints: 4, defaultConstraints: 10,
    identityColumns: 3, moneyColumns: 8, dateTimeColumns: 12,
  },
  {
    databaseName: "rishabh_plastic27", compatibilityLevel: 160, collationName: "SQL_Latin1_General_CP1_CI_AS",
    schemas: 1, tables: 75, columns: 1864, views: 0, procedures: 0, functions: 0, triggers: 0, indexes: 0,
    primaryKeys: 0, uniqueConstraints: 0, foreignKeys: 0, checkConstraints: 0, defaultConstraints: 0,
    identityColumns: 0, moneyColumns: 83, dateTimeColumns: 94,
  },
];

test("parses only the legacy server and password settings without echoing comments", () => {
  const connection = parseLegacyConnectionIni("; lower environment only\nServerName=PC1\\SQLEXPRESS\nPassword=fixture-password\nDataPath=E:\\DATA\n");
  assert.equal(connection.server, "PC1\\SQLEXPRESS");
  assert.equal(connection.password, "fixture-password");
  assert.throws(() => parseLegacyConnectionIni("ServerName=one\nServerName=two\nPassword=x"), LegacySqlServerIntakeError);
  assert.throws(() => parseLegacyConnectionIni("ServerName=one"), /ServerName and Password/);
});

test("builds deterministic aggregate evidence without identifiers or connection values", () => {
  const input = { observedOn: "2026-08-24", serverFacts: { productVersion: "16.0.1000.6", edition: "Express Edition" }, databaseFacts };
  const first = buildSanitizedSqlServerInventory(input);
  const second = buildSanitizedSqlServerInventory(input);
  const serialized = JSON.stringify(first);
  assert.equal(first.inventoryHash, second.inventoryHash);
  assert.equal(first.source.engine, "microsoft-sql-server");
  assert.equal(first.source.productMajorVersion, 16);
  assert.deepEqual(first.databases.map((database) => database.role).sort(), ["company-or-other", "metadata"]);
  assert.doesNotMatch(serialized, /rishabh_plastic27|smart_setup|fixture-password|PC1/i);
  assert.throws(() => buildSanitizedSqlServerInventory({ ...input, databaseFacts: [{ ...databaseFacts[0], tables: -1 }] }), /non-negative integer/);
});
