/**
 * Profiles aggregate application-level key declarations without exporting table,
 * field, record-type, relationship, or client-data values.
 *
 * Usage: node scripts/profile-logical-key-metadata.mjs --database smartwin_data_intake --observed-on 2026-08-21
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function count(value, label) {
  if (!Number.isInteger(Number(value)) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

/** Builds a reproducible, non-enforcing profile of legacy logical key metadata. */
export function buildLogicalKeyMetadataProfile({ observedOn, facts }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) throw new Error("observedOn must be an ISO date");
  const normalized = Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, count(value, `facts.${key}`)]));
  const required = ["keyRows", "primaryTableRows", "foreignTableRows", "primaryFirstFieldRows", "primaryAdditionalFieldSlots", "foreignFirstFieldRows", "foreignAdditionalFieldSlots", "primaryRowsMissingFirstField", "foreignRowsMissingFirstField", "recordTypeVariants", "blankRecordTypeRows"];
  if (required.some((key) => normalized[key] === undefined)) throw new Error("all logical-key profile counts are required");
  if (normalized.primaryTableRows > normalized.keyRows || normalized.foreignTableRows > normalized.keyRows || normalized.primaryFirstFieldRows > normalized.primaryTableRows || normalized.foreignFirstFieldRows > normalized.foreignTableRows || normalized.primaryAdditionalFieldSlots > normalized.keyRows * 3 || normalized.foreignAdditionalFieldSlots > normalized.keyRows * 3 || normalized.primaryRowsMissingFirstField > normalized.primaryTableRows || normalized.foreignRowsMissingFirstField > normalized.foreignTableRows || normalized.blankRecordTypeRows > normalized.keyRows) throw new Error("logical-key counts are internally inconsistent");

  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "smart_setup", table: "database_keys" },
    facts: normalized,
    relationshipStatus: normalized.foreignTableRows === 0 ? "no-declared-relationships" : "review-required",
    conclusion: "Legacy database_keys records are application metadata, not target database constraints. They must be reconciled with physical schemas, program behavior, and tenant/company boundaries before any target key or foreign-key rule is approved.",
  };
  return Object.freeze({ ...profile, profileHash: sha256(JSON.stringify(profile)) });
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) throw new Error(`unexpected argument ${args[index]}`);
    const key = args[index].slice(2); const value = args[index + 1];
    if (!value || value.startsWith("--") || options[key]) throw new Error(`--${key} requires one value`);
    options[key] = value; index += 1;
  }
  if (!options.database || !options["observed-on"]) throw new Error("usage: --database DATABASE --observed-on YYYY-MM-DD");
  return options;
}

async function readJson(database, sql) {
  const { stdout } = await execFile("psql", ["-d", database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim());
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const facts = await readJson(options.database, `
    SELECT json_build_object(
      'keyRows', count(*),
      'primaryTableRows', count(*) FILTER (WHERE nullif(btrim(primary_table_name), '') IS NOT NULL),
      'foreignTableRows', count(*) FILTER (WHERE nullif(btrim(foreign_table_name), '') IS NOT NULL),
      'primaryFirstFieldRows', count(*) FILTER (WHERE nullif(btrim(pk_field_1), '') IS NOT NULL),
      'primaryAdditionalFieldSlots', (count(*) FILTER (WHERE nullif(btrim(pk_field_2), '') IS NOT NULL) + count(*) FILTER (WHERE nullif(btrim(pk_field_3), '') IS NOT NULL) + count(*) FILTER (WHERE nullif(btrim(pk_field_4), '') IS NOT NULL)),
      'foreignFirstFieldRows', count(*) FILTER (WHERE nullif(btrim(fk_field_1), '') IS NOT NULL),
      'foreignAdditionalFieldSlots', (count(*) FILTER (WHERE nullif(btrim(fk_field_2), '') IS NOT NULL) + count(*) FILTER (WHERE nullif(btrim(fk_field_3), '') IS NOT NULL) + count(*) FILTER (WHERE nullif(btrim(fk_field_4), '') IS NOT NULL)),
      'primaryRowsMissingFirstField', count(*) FILTER (WHERE nullif(btrim(primary_table_name), '') IS NOT NULL AND nullif(btrim(pk_field_1), '') IS NULL),
      'foreignRowsMissingFirstField', count(*) FILTER (WHERE nullif(btrim(foreign_table_name), '') IS NOT NULL AND nullif(btrim(fk_field_1), '') IS NULL),
      'recordTypeVariants', count(DISTINCT nullif(btrim(rec_type), '')),
      'blankRecordTypeRows', count(*) FILTER (WHERE nullif(btrim(rec_type), '') IS NULL)
    ) FROM smart_setup.database_keys;
  `);
  const profile = buildLogicalKeyMetadataProfile({ observedOn: options["observed-on"], facts });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
