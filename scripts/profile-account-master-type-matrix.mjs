/**
 * Profiles aggregate type compatibility for Account Master metadata fields.
 * It emits counts only: no values, labels, expressions, or raw SQL.
 *
 * Usage: node scripts/profile-account-master-type-matrix.mjs --database smartwin_data_intake --observed-on 2026-08-21
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const legacyTypes = new Set(["T", "I", "N", "D"]);
const physicalTypes = new Set(["character varying", "integer", "smallint", "numeric", "money", "date", "timestamp without time zone", "<unresolved>"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(value, label) {
  if (!Number.isInteger(Number(value)) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

/** Converts aggregate source type facts into a review-only target mapping matrix. */
export function buildAccountMasterTypeMatrix({ observedOn, mappings, totals }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) {
    throw new Error("observedOn must be an ISO date");
  }
  const normalizedMappings = mappings.map((mapping) => {
    if (!legacyTypes.has(mapping.legacyType)) throw new Error("legacy field type is unsupported");
    if (!physicalTypes.has(mapping.physicalType)) throw new Error("physical type is unsupported");
    return { legacyType: mapping.legacyType, physicalType: mapping.physicalType, fields: count(mapping.fields, "mapping.fields") };
  }).sort((left, right) => left.legacyType.localeCompare(right.legacyType) || left.physicalType.localeCompare(right.physicalType));
  if (!normalizedMappings.length) throw new Error("at least one mapping row is required");

  const fieldDefinitions = count(totals.fieldDefinitions, "totals.fieldDefinitions");
  const directPhysicalMappings = count(totals.directPhysicalMappings, "totals.directPhysicalMappings");
  const unresolvedMappings = count(totals.unresolvedMappings, "totals.unresolvedMappings");
  if (directPhysicalMappings + unresolvedMappings !== fieldDefinitions) throw new Error("direct and unresolved mappings must reconcile to field definitions");
  if (normalizedMappings.reduce((sum, mapping) => sum + mapping.fields, 0) !== fieldDefinitions) throw new Error("mapping rows must reconcile to field definitions");

  const matrix = {
    matrixVersion: 1,
    observedOn,
    restrictedData: false,
    source: { programTopId: "program_top:14", schema: "rishabh_plastic27" },
    totals: {
      fieldDefinitions,
      directPhysicalMappings,
      unresolvedMappings,
      moneyMappings: count(totals.moneyMappings, "totals.moneyMappings"),
      localTimestampMappings: count(totals.localTimestampMappings, "totals.localTimestampMappings"),
      numericMappings: count(totals.numericMappings, "totals.numericMappings"),
    },
    mappings: normalizedMappings.map((mapping) => ({ ...mapping, targetTypeStatus: "review-required" })),
    conclusion: "Legacy field codes and physical PostgreSQL types are evidence, not target types. Unresolved mappings must be converted to reviewed source contracts; money and timestamp mappings require explicit financial and time semantics before a typed Account Master read model is approved.",
  };
  return Object.freeze({ ...matrix, matrixHash: sha256(JSON.stringify(matrix)) });
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const facts = await readJson(options.database, `
    WITH mapping AS (
      SELECT coalesce(nullif(btrim(pb.field_type), ''), '<unresolved>') AS legacy_type,
        coalesce(c.data_type, '<unresolved>') AS physical_type
      FROM smart_setup.program_body pb
      LEFT JOIN information_schema.columns c ON c.table_schema = 'rishabh_plastic27'
        AND c.table_name = lower(btrim(pb.database_name))
        AND c.column_name = lower(btrim(pb.field_name))
      WHERE pb.program_top_id = 14
    )
    SELECT json_build_object(
      'mappings', (SELECT json_agg(json_build_object('legacyType', legacy_type, 'physicalType', physical_type, 'fields', total) ORDER BY legacy_type, physical_type) FROM (SELECT legacy_type, physical_type, count(*)::int AS total FROM mapping GROUP BY legacy_type, physical_type) grouped),
      'totals', json_build_object(
        'fieldDefinitions', (SELECT count(*) FROM mapping),
        'directPhysicalMappings', (SELECT count(*) FROM mapping WHERE physical_type <> '<unresolved>'),
        'unresolvedMappings', (SELECT count(*) FROM mapping WHERE physical_type = '<unresolved>'),
        'moneyMappings', (SELECT count(*) FROM mapping WHERE physical_type = 'money'),
        'localTimestampMappings', (SELECT count(*) FROM mapping WHERE physical_type = 'timestamp without time zone'),
        'numericMappings', (SELECT count(*) FROM mapping WHERE physical_type = 'numeric')
      )
    );
  `);
  const matrix = buildAccountMasterTypeMatrix({ observedOn: options["observed-on"], ...facts });
  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
