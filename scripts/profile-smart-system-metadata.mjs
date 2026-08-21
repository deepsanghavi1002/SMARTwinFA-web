/**
 * Profiles aggregate smart_system control-plane metadata without exporting
 * client rows, credential fields, table/column values, or routine bodies.
 *
 * Usage: node scripts/profile-smart-system-metadata.mjs --database smartwin_data_intake --observed-on 2026-08-21
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

/** Builds a reproducible, non-executable control-plane inventory profile. */
export function buildSmartSystemMetadataProfile({ observedOn, schemaStats, controlCounts }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) throw new Error("observedOn must be an ISO date");
  const normalizedSchema = Object.fromEntries(Object.entries(schemaStats).map(([key, value]) => [key, count(value, `schemaStats.${key}`)]));
  const normalizedControl = Object.fromEntries(Object.entries(controlCounts).map(([key, value]) => [key, count(value, `controlCounts.${key}`)]));
  const requiredSchema = ["tables", "columns", "rows", "functions", "procedures", "primaryKeys", "foreignKeys", "moneyColumns"];
  const requiredControl = ["companyRows", "accountingYearRows", "userRows", "securityRows", "dashboardDefinitionRows", "userDashboardRows", "printStagingRows", "loginRows"];
  if (requiredSchema.some((key) => normalizedSchema[key] === undefined) || requiredControl.some((key) => normalizedControl[key] === undefined)) throw new Error("all smart_system profile counts are required");
  if (normalizedSchema.primaryKeys > normalizedSchema.tables || normalizedSchema.foreignKeys > normalizedSchema.tables || Object.values(normalizedControl).some((value) => value > normalizedSchema.rows)) throw new Error("smart_system profile counts are internally inconsistent");

  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "smart_system", archiveSha256: "e1506122961941a20fbe347b2c85c374d3f7603b0f84329bba2b7255992379f5" },
    schemaStats: normalizedSchema,
    controlCounts: normalizedControl,
    routineStatus: "quarantined-not-executed",
    conclusion: "This inventory proves only structural availability. Identity, password migration, authorization semantics, company/year routing, dashboard behavior, print staging lifecycle, data classification, and target constraints require reviewed source contracts and runtime parity evidence.",
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
    WITH base_tables AS (
      SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'smart_system'
    ), exact_rows AS (
      SELECT coalesce(sum(((xpath('/row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text)::bigint), 0)::bigint AS rows
      FROM base_tables
    )
    SELECT json_build_object(
      'schemaStats', json_build_object(
        'tables', (SELECT count(*) FROM base_tables),
        'columns', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'smart_system'),
        'rows', (SELECT rows FROM exact_rows),
        'functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'smart_system' AND p.prokind = 'f'),
        'procedures', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'smart_system' AND p.prokind = 'p'),
        'primaryKeys', (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'smart_system' AND c.contype = 'p'),
        'foreignKeys', (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'smart_system' AND c.contype = 'f'),
        'moneyColumns', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'smart_system' AND data_type = 'money')
      ),
      'controlCounts', json_build_object(
        'companyRows', (SELECT count(*) FROM smart_system.company),
        'accountingYearRows', (SELECT count(*) FROM smart_system.year_ac),
        'userRows', (SELECT count(*) FROM smart_system.user_master),
        'securityRows', (SELECT count(*) FROM smart_system.security),
        'dashboardDefinitionRows', (SELECT count(*) FROM smart_system.dashboard_detail),
        'userDashboardRows', (SELECT count(*) FROM smart_system.user_dashboard),
        'printStagingRows', ((SELECT count(*) FROM smart_system.document_top) + (SELECT count(*) FROM smart_system.document_body) + (SELECT count(*) FROM smart_system.document_bottom) + (SELECT count(*) FROM smart_system.document_print)),
        'loginRows', (SELECT count(*) FROM smart_system.login)
      )
    );
  `);
  const profile = buildSmartSystemMetadataProfile({ observedOn: options["observed-on"], ...facts });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
