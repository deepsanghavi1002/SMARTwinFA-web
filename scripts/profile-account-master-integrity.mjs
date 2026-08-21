/**
 * Profiles only aggregate integrity facts for Account Master source tables.
 * It does not export table rows, key values, PII, raw SQL definitions, or run
 * any legacy procedure. Results are review evidence, never a migration action.
 *
 * Usage: node scripts/profile-account-master-integrity.mjs --database smartwin_data_intake --observed-on 2026-08-21
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const validIdentifier = /^[a-z][a-z0-9_]*$/;
const allowedTables = new Set(["account", "address", "ac_balance", "addon_data", "int_master", "balsheet", "idopt_master", "book_properties"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertCount(value, label) {
  if (!Number.isInteger(Number(value)) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !validIdentifier.test(value)) throw new Error(`${label} must be a lower-case catalog identifier`);
  return value;
}

function normalizeCandidate(candidate) {
  const table = assertIdentifier(candidate.table, "candidate.table");
  if (!allowedTables.has(table)) throw new Error(`candidate table ${table} is outside the Account Master boundary`);
  const columns = candidate.columns.map((column) => assertIdentifier(column, "candidate.column"));
  if (!columns.length || new Set(columns).size !== columns.length) throw new Error("candidate columns must be present and unique");
  const rows = assertCount(candidate.rows, "candidate.rows");
  const missing = assertCount(candidate.missing, "candidate.missing");
  const duplicateGroups = assertCount(candidate.duplicateGroups, "candidate.duplicateGroups");
  if (missing > rows) throw new Error("candidate missing count cannot exceed rows");

  return {
    id: `${table}.${columns.join("_")}`,
    evidence: candidate.evidence === "metadata-declared" ? "metadata-declared" : "inferred-from-non-null-unique-profile",
    table,
    columns,
    rows,
    missing,
    duplicateGroups,
    status: missing || duplicateGroups ? "repair-or-exception-required" : "review-required",
  };
}

function normalizeRelationship(relationship) {
  const childTable = assertIdentifier(relationship.childTable, "relationship.childTable");
  const parentTable = assertIdentifier(relationship.parentTable, "relationship.parentTable");
  if (!allowedTables.has(childTable) || !allowedTables.has(parentTable)) throw new Error("relationship tables must be inside the Account Master boundary");
  const childColumns = relationship.childColumns.map((column) => assertIdentifier(column, "relationship.childColumn"));
  const parentColumns = relationship.parentColumns.map((column) => assertIdentifier(column, "relationship.parentColumn"));
  if (!childColumns.length || childColumns.length !== parentColumns.length) throw new Error("relationship column counts must match");
  const childRows = assertCount(relationship.childRows, "relationship.childRows");
  const missingKeyRows = assertCount(relationship.missingKeyRows, "relationship.missingKeyRows");
  const unmatchedRows = assertCount(relationship.unmatchedRows, "relationship.unmatchedRows");
  const duplicateNaturalKeyGroups = assertCount(relationship.duplicateNaturalKeyGroups, "relationship.duplicateNaturalKeyGroups");

  return {
    id: `${childTable}.${childColumns.join("_")}→${parentTable}.${parentColumns.join("_")}`,
    childTable,
    childColumns,
    parentTable,
    parentColumns,
    childRows,
    missingKeyRows,
    unmatchedRows,
    duplicateNaturalKeyGroups,
    status: missingKeyRows || unmatchedRows || duplicateNaturalKeyGroups ? "repair-or-exception-required" : "review-required",
  };
}

/** Converts aggregate-only profiling output into a stable integrity report. */
export function buildAccountMasterIntegrityProfile({ observedOn, tables, candidates, relationships }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) {
    throw new Error("observedOn must be an ISO date");
  }

  const normalizedTables = tables.map((table) => {
    const name = assertIdentifier(table.name, "table.name");
    if (!allowedTables.has(name)) throw new Error(`table ${name} is outside the Account Master boundary`);
    return {
      name,
      rows: assertCount(table.rows, `${name}.rows`),
      moneyColumns: assertCount(table.moneyColumns, `${name}.moneyColumns`),
      localTimestampColumns: assertCount(table.localTimestampColumns, `${name}.localTimestampColumns`),
      textColumns: assertCount(table.textColumns, `${name}.textColumns`),
      nullableColumns: assertCount(table.nullableColumns, `${name}.nullableColumns`),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (normalizedTables.length !== allowedTables.size || new Set(normalizedTables.map(({ name }) => name)).size !== allowedTables.size) {
    throw new Error("all Account Master boundary tables must be present exactly once");
  }

  const normalizedCandidates = candidates.map(normalizeCandidate).sort((left, right) => left.id.localeCompare(right.id));
  const normalizedRelationships = relationships.map(normalizeRelationship).sort((left, right) => left.id.localeCompare(right.id));
  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "rishabh_plastic27", boundary: "account-master" },
    tables: normalizedTables,
    candidateKeys: normalizedCandidates,
    candidateRelationships: normalizedRelationships,
    conclusion: "No source constraint is approved for direct target enforcement. Every candidate requires domain review; nonzero integrity exceptions require repair, an explicit legacy exception, or an intentionally different target rule.",
  };
  return Object.freeze({ ...profile, profileHash: sha256(JSON.stringify(profile)) });
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) throw new Error(`unexpected argument ${args[index]}`);
    const key = args[index].slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--") || options[key]) throw new Error(`--${key} requires one value`);
    options[key] = value;
    index += 1;
  }
  if (!options.database || !options["observed-on"]) throw new Error("usage: --database DATABASE --observed-on YYYY-MM-DD");
  return options;
}

async function readJson(database, sql) {
  const { stdout } = await execFile("psql", ["-d", database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim());
}

async function collectProfileFacts(database) {
  return readJson(database, `
    WITH table_stats AS (
      SELECT c.table_name,
        CASE WHEN c.table_name = 'account' THEN (SELECT count(*) FROM rishabh_plastic27.account) END AS account_rows,
        CASE WHEN c.table_name = 'address' THEN (SELECT count(*) FROM rishabh_plastic27.address) END AS address_rows,
        CASE WHEN c.table_name = 'ac_balance' THEN (SELECT count(*) FROM rishabh_plastic27.ac_balance) END AS ac_balance_rows,
        CASE WHEN c.table_name = 'addon_data' THEN (SELECT count(*) FROM rishabh_plastic27.addon_data) END AS addon_data_rows,
        CASE WHEN c.table_name = 'int_master' THEN (SELECT count(*) FROM rishabh_plastic27.int_master) END AS int_master_rows,
        CASE WHEN c.table_name = 'balsheet' THEN (SELECT count(*) FROM rishabh_plastic27.balsheet) END AS balsheet_rows,
        CASE WHEN c.table_name = 'idopt_master' THEN (SELECT count(*) FROM rishabh_plastic27.idopt_master) END AS idopt_master_rows,
        CASE WHEN c.table_name = 'book_properties' THEN (SELECT count(*) FROM rishabh_plastic27.book_properties) END AS book_properties_rows,
        count(*) FILTER (WHERE c.data_type = 'money')::int AS money_columns,
        count(*) FILTER (WHERE c.data_type = 'timestamp without time zone')::int AS local_timestamp_columns,
        count(*) FILTER (WHERE c.data_type = 'character varying')::int AS text_columns,
        count(*) FILTER (WHERE c.is_nullable = 'YES')::int AS nullable_columns
      FROM information_schema.columns c
      WHERE c.table_schema = 'rishabh_plastic27'
        AND c.table_name IN ('account', 'address', 'ac_balance', 'addon_data', 'int_master', 'balsheet', 'idopt_master', 'book_properties')
      GROUP BY c.table_name
    ), tables AS (
      SELECT json_agg(json_build_object(
        'name', table_name,
        'rows', coalesce(account_rows, address_rows, ac_balance_rows, addon_data_rows, int_master_rows, balsheet_rows, idopt_master_rows, book_properties_rows),
        'moneyColumns', money_columns, 'localTimestampColumns', local_timestamp_columns,
        'textColumns', text_columns, 'nullableColumns', nullable_columns
      ) ORDER BY table_name) AS value FROM table_stats
    ), candidates AS (
      SELECT json_agg(value ORDER BY value->>'table', value->'columns'->>0) AS value FROM (
        SELECT json_build_object('table', 'account', 'columns', json_build_array('code'), 'rows', count(*), 'missing', count(*) FILTER (WHERE code IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT code FROM rishabh_plastic27.account GROUP BY code HAVING count(*) > 1) groups), 'evidence', 'metadata-declared') AS value FROM rishabh_plastic27.account
        UNION ALL SELECT json_build_object('table', 'address', 'columns', json_build_array('address_key'), 'rows', count(*), 'missing', count(*) FILTER (WHERE address_key IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT address_key FROM rishabh_plastic27.address GROUP BY address_key HAVING count(*) > 1) groups), 'evidence', 'inferred') FROM rishabh_plastic27.address
        UNION ALL SELECT json_build_object('table', 'ac_balance', 'columns', json_build_array('acbal_key'), 'rows', count(*), 'missing', count(*) FILTER (WHERE acbal_key IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT acbal_key FROM rishabh_plastic27.ac_balance GROUP BY acbal_key HAVING count(*) > 1) groups), 'evidence', 'inferred') FROM rishabh_plastic27.ac_balance
        UNION ALL SELECT json_build_object('table', 'addon_data', 'columns', json_build_array('aon_key'), 'rows', count(*), 'missing', count(*) FILTER (WHERE aon_key IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT aon_key FROM rishabh_plastic27.addon_data GROUP BY aon_key HAVING count(*) > 1) groups), 'evidence', 'inferred') FROM rishabh_plastic27.addon_data
        UNION ALL SELECT json_build_object('table', 'int_master', 'columns', json_build_array('interest_key'), 'rows', count(*) FILTER (WHERE true), 'missing', count(*) FILTER (WHERE interest_key IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT interest_key FROM rishabh_plastic27.int_master GROUP BY interest_key HAVING count(*) > 1) groups), 'evidence', 'inferred') FROM rishabh_plastic27.int_master
        UNION ALL SELECT json_build_object('table', 'balsheet', 'columns', json_build_array('bs_key'), 'rows', count(*), 'missing', count(*) FILTER (WHERE bs_key IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT bs_key FROM rishabh_plastic27.balsheet GROUP BY bs_key HAVING count(*) > 1) groups), 'evidence', 'inferred') FROM rishabh_plastic27.balsheet
        UNION ALL SELECT json_build_object('table', 'idopt_master', 'columns', json_build_array('idopt_key'), 'rows', count(*), 'missing', count(*) FILTER (WHERE idopt_key IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT idopt_key FROM rishabh_plastic27.idopt_master GROUP BY idopt_key HAVING count(*) > 1) groups), 'evidence', 'inferred') FROM rishabh_plastic27.idopt_master
        UNION ALL SELECT json_build_object('table', 'book_properties', 'columns', json_build_array('book_key'), 'rows', count(*), 'missing', count(*) FILTER (WHERE book_key IS NULL), 'duplicateGroups', (SELECT count(*) FROM (SELECT book_key FROM rishabh_plastic27.book_properties GROUP BY book_key HAVING count(*) > 1) groups), 'evidence', 'inferred') FROM rishabh_plastic27.book_properties
      ) candidates
    ), relationships AS (
      SELECT json_build_array(
        json_build_object('childTable', 'address', 'childColumns', json_build_array('code'), 'parentTable', 'account', 'parentColumns', json_build_array('code'), 'childRows', (SELECT count(*) FROM rishabh_plastic27.address), 'missingKeyRows', (SELECT count(*) FROM rishabh_plastic27.address WHERE code IS NULL), 'unmatchedRows', (SELECT count(*) FROM rishabh_plastic27.address a WHERE a.code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rishabh_plastic27.account p WHERE p.code = a.code)), 'duplicateNaturalKeyGroups', (SELECT count(*) FROM (SELECT code, address_id FROM rishabh_plastic27.address GROUP BY code, address_id HAVING count(*) > 1) groups)),
        json_build_object('childTable', 'ac_balance', 'childColumns', json_build_array('code'), 'parentTable', 'account', 'parentColumns', json_build_array('code'), 'childRows', (SELECT count(*) FROM rishabh_plastic27.ac_balance), 'missingKeyRows', (SELECT count(*) FROM rishabh_plastic27.ac_balance WHERE code IS NULL), 'unmatchedRows', (SELECT count(*) FROM rishabh_plastic27.ac_balance b WHERE b.code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rishabh_plastic27.account p WHERE p.code = b.code)), 'duplicateNaturalKeyGroups', (SELECT count(*) FROM (SELECT code, year_id FROM rishabh_plastic27.ac_balance GROUP BY code, year_id HAVING count(*) > 1) groups)),
        json_build_object('childTable', 'int_master', 'childColumns', json_build_array('code'), 'parentTable', 'account', 'parentColumns', json_build_array('code'), 'childRows', (SELECT count(*) FROM rishabh_plastic27.int_master), 'missingKeyRows', (SELECT count(*) FROM rishabh_plastic27.int_master WHERE code IS NULL), 'unmatchedRows', (SELECT count(*) FROM rishabh_plastic27.int_master i WHERE i.code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rishabh_plastic27.account p WHERE p.code = i.code)), 'duplicateNaturalKeyGroups', (SELECT count(*) FROM (SELECT code, year_id FROM rishabh_plastic27.int_master GROUP BY code, year_id HAVING count(*) > 1) groups))
      ) AS value
    )
    SELECT json_build_object('tables', (SELECT value FROM tables), 'candidates', (SELECT value FROM candidates), 'relationships', (SELECT value FROM relationships));
  `);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const facts = await collectProfileFacts(options.database);
  const profile = buildAccountMasterIntegrityProfile({ observedOn: options["observed-on"], ...facts });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
