/**
 * Produces an aggregate-only semantic boundary for the restored smart_system
 * schema. It never exports row values, credential material, SQL text, or
 * routine bodies.
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function normalizeCounts(group, label) {
  return Object.fromEntries(Object.entries(group).map(([key, value]) => [key, nonNegativeInteger(value, `${label}.${key}`)]));
}

export function buildSmartSystemContractProfile({ observedOn, routing, dashboard, print, security }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) throw new Error("observedOn must be an ISO date");
  const normalized = {
    routing: normalizeCounts(routing, "routing"),
    dashboard: normalizeCounts(dashboard, "dashboard"),
    print: normalizeCounts(print, "print"),
    security: normalizeCounts(security, "security"),
  };
  const required = {
    routing: ["companyRows", "yearRows", "companyPrimaryKeys", "yearPrimaryKeys", "declaredForeignKeys", "companiesWithRoutingName", "yearsWithValidRange", "duplicateCompanyKeys", "duplicateYearKeys"],
    dashboard: ["definitionRows", "assignmentRows", "definitionsWithRawQuerySlots", "orphanAssignments", "duplicateDefinitionKeys", "duplicateAssignmentKeys"],
    print: ["topRows", "bodyRows", "bottomRows", "requestRows", "tablesWithPrimaryKey", "declaredForeignKeys", "moneyColumns"],
    security: ["userRows", "securityRows", "loginRows", "credentialLikeColumns", "usersWithCredentialMaterial"],
  };
  for (const [group, keys] of Object.entries(required)) {
    if (keys.some((key) => normalized[group][key] === undefined)) throw new Error(`all ${group} contract counts are required`);
  }
  if (normalized.routing.companiesWithRoutingName > normalized.routing.companyRows || normalized.routing.yearsWithValidRange > normalized.routing.yearRows) throw new Error("routing counts are internally inconsistent");
  if (normalized.dashboard.orphanAssignments > normalized.dashboard.assignmentRows || normalized.security.usersWithCredentialMaterial > normalized.security.userRows) throw new Error("contract counts are internally inconsistent");

  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "smart_system", archiveSha256: "e1506122961941a20fbe347b2c85c374d3f7603b0f84329bba2b7255992379f5" },
    ...normalized,
    decisions: {
      routing: "candidate-only: company.co_key, company.co_dataname, and year_ac.year_key require source/runtime confirmation before target mapping",
      dashboard: "quarantine raw query slots; compile reviewed dashboards into typed definitions and resolve assignments by stable IDs",
      print: "replace shared staging tables with tenant/company/year-scoped, job-owned snapshots",
      security: "do not migrate credential fields directly; authentication and effective rights remain blocked on authoritative behavior and approved reset strategy",
    },
  };
  return Object.freeze({ ...profile, profileHash: createHash("sha256").update(JSON.stringify(profile)).digest("hex") });
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("usage: --database DATABASE --observed-on YYYY-MM-DD");
    options[key.slice(2)] = value;
  }
  if (!options.database || !options["observed-on"]) throw new Error("usage: --database DATABASE --observed-on YYYY-MM-DD");
  return options;
}

async function readFacts(database) {
  const sql = String.raw`
    SELECT json_build_object(
      'routing', json_build_object(
        'companyRows', (SELECT count(*) FROM smart_system.company),
        'yearRows', (SELECT count(*) FROM smart_system.year_ac),
        'companyPrimaryKeys', (SELECT count(*) FROM pg_constraint WHERE conrelid='smart_system.company'::regclass AND contype='p'),
        'yearPrimaryKeys', (SELECT count(*) FROM pg_constraint WHERE conrelid='smart_system.year_ac'::regclass AND contype='p'),
        'declaredForeignKeys', (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='smart_system' AND c.contype='f'),
        'companiesWithRoutingName', (SELECT count(*) FROM smart_system.company WHERE nullif(btrim(co_dataname), '') IS NOT NULL),
        'yearsWithValidRange', (SELECT count(*) FROM smart_system.year_ac WHERE year_start IS NOT NULL AND year_end IS NOT NULL AND year_start <= year_end),
        'duplicateCompanyKeys', (SELECT count(*) FROM (SELECT co_key FROM smart_system.company GROUP BY co_key HAVING count(*) > 1) d),
        'duplicateYearKeys', (SELECT count(*) FROM (SELECT year_key FROM smart_system.year_ac GROUP BY year_key HAVING count(*) > 1) d)
      ),
      'dashboard', json_build_object(
        'definitionRows', (SELECT count(*) FROM smart_system.dashboard_detail),
        'assignmentRows', (SELECT count(*) FROM smart_system.user_dashboard),
        'definitionsWithRawQuerySlots', (SELECT count(*) FROM smart_system.dashboard_detail WHERE nullif(btrim(sql_query_primary), '') IS NOT NULL OR nullif(btrim(sql_query_secondary), '') IS NOT NULL OR nullif(btrim(sql_query_detail), '') IS NOT NULL),
        'orphanAssignments', (SELECT count(*) FROM smart_system.user_dashboard u WHERE NOT EXISTS (SELECT 1 FROM smart_system.dashboard_detail d WHERE d.dashboard_menu=u.dashboard_menu)),
        'duplicateDefinitionKeys', (SELECT count(*) FROM (SELECT dashboard_key FROM smart_system.dashboard_detail GROUP BY dashboard_key HAVING count(*) > 1) d),
        'duplicateAssignmentKeys', (SELECT count(*) FROM (SELECT user_dashboard_key FROM smart_system.user_dashboard GROUP BY user_dashboard_key HAVING count(*) > 1) d)
      ),
      'print', json_build_object(
        'topRows', (SELECT count(*) FROM smart_system.document_top),
        'bodyRows', (SELECT count(*) FROM smart_system.document_body),
        'bottomRows', (SELECT count(*) FROM smart_system.document_bottom),
        'requestRows', (SELECT count(*) FROM smart_system.document_print),
        'tablesWithPrimaryKey', (SELECT count(DISTINCT conrelid) FROM pg_constraint WHERE conrelid IN ('smart_system.document_top'::regclass,'smart_system.document_body'::regclass,'smart_system.document_bottom'::regclass,'smart_system.document_print'::regclass) AND contype='p'),
        'declaredForeignKeys', (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('smart_system.document_top'::regclass,'smart_system.document_body'::regclass,'smart_system.document_bottom'::regclass,'smart_system.document_print'::regclass) AND contype='f'),
        'moneyColumns', (SELECT count(*) FROM information_schema.columns WHERE table_schema='smart_system' AND table_name IN ('document_top','document_body','document_bottom','document_print') AND data_type='money')
      ),
      'security', json_build_object(
        'userRows', (SELECT count(*) FROM smart_system.user_master),
        'securityRows', (SELECT count(*) FROM smart_system.security),
        'loginRows', (SELECT count(*) FROM smart_system.login),
        'credentialLikeColumns', (SELECT count(*) FROM information_schema.columns WHERE table_schema='smart_system' AND (column_name ILIKE '%pass%' OR column_name ILIKE '%pw%' OR column_name ILIKE '%token%' OR column_name ILIKE '%secret%' OR column_name ILIKE '%key%')),
        'usersWithCredentialMaterial', (SELECT count(*) FROM smart_system.user_master WHERE nullif(btrim(user_pw), '') IS NOT NULL OR nullif(btrim(super_pw), '') IS NOT NULL OR nullif(btrim(user_screen_pw), '') IS NOT NULL OR nullif(btrim(user_email_pass), '') IS NOT NULL)
      )
    );`;
  const { stdout } = await execFile("psql", ["-d", database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim());
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(buildSmartSystemContractProfile({ observedOn: options["observed-on"], ...(await readFacts(options.database)) }), null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
