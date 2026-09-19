/**
 * Profiles aggregate stored-query risk indicators without exporting query text,
 * parameters, output columns, names, or client rows.
 *
 * Usage: node scripts/profile-query-metadata.mjs --database smartwin_data_intake --observed-on 2026-08-21
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

/** Converts query-risk counters into a safe migration intake profile. */
export function buildQueryMetadataProfile({ observedOn, facts }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) throw new Error("observedOn must be an ISO date");
  const normalized = Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, count(value, `facts.${key}`)]));
  const required = ["queryRows", "queryTextRows", "otherQueryTextRows", "programLinkRows", "numericProgramLinkRows", "selectStarRows", "topRows", "dboRows", "sysTokenRows", "executeRows", "orphanNumericProgramLinkRows"];
  if (required.some((key) => normalized[key] === undefined)) throw new Error("all query profile counts are required");
  if (normalized.queryTextRows > normalized.queryRows || normalized.otherQueryTextRows > normalized.queryRows || normalized.programLinkRows > normalized.queryRows) throw new Error("query count cannot exceed queryRows");

  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "smart_setup", table: "query_table" },
    facts: normalized,
    runtimeStatus: "quarantined-not-runnable-in-web-runtime",
    conclusion: "Every stored query requires parsing into a reviewed typed query contract. Legacy token replacement, wildcard output, SQL dialect fragments, and text program links are never executable in the web runtime; source-to-program linkage must be resolved from metadata semantics and running behavior.",
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
      'queryRows', count(*),
      'queryTextRows', count(*) FILTER (WHERE nullif(btrim(query_string), '') IS NOT NULL),
      'otherQueryTextRows', count(*) FILTER (WHERE nullif(btrim(other_query_string), '') IS NOT NULL),
      'programLinkRows', count(*) FILTER (WHERE nullif(btrim(query_prog_id), '') IS NOT NULL),
      'numericProgramLinkRows', count(*) FILTER (WHERE btrim(query_prog_id) ~ '^[0-9]+$'),
      'selectStarRows', count(*) FILTER (WHERE query_string ~* '(^|[^a-z])select[[:space:]]+\\*'),
      'topRows', count(*) FILTER (WHERE query_string ~* '(^|[^a-z])top[[:space:]]+[0-9(]'),
      'dboRows', count(*) FILTER (WHERE query_string ~* '\\.dbo\\.'),
      'sysTokenRows', count(*) FILTER (WHERE query_string LIKE '%|sys.%|%'),
      'executeRows', count(*) FILTER (WHERE query_string ~* '(^|[^a-z])exec(ute)?[[:space:]]'),
      'orphanNumericProgramLinkRows', (SELECT count(*) FROM smart_setup.query_table q WHERE btrim(q.query_prog_id) ~ '^[0-9]+$' AND NOT EXISTS (SELECT 1 FROM smart_setup.program_top p WHERE p.program_top_key = q.query_prog_id::integer))
    ) FROM smart_setup.query_table;
  `);
  const profile = buildQueryMetadataProfile({ observedOn: options["observed-on"], facts });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
