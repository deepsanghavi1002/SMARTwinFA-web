/**
 * Exports a deliberately sanitized structural catalogue from the local
 * PostgreSQL intake database. It never selects table rows, routine bodies,
 * query definitions, passwords, or connection configuration.
 *
 * This is a discovery tool, not an application runtime database client.
 * Usage: node scripts/export-postgres-intake-catalog.mjs --database smartwin_data_intake --observed-on 2026-08-21
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const requiredSchemas = ["smart_setup", "rishabh_plastic27"];
const metadataTables = ["program_top", "program_body", "menumaster", "query_table", "database_keys", "entry_control"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function assertHash(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hash`);
  return value.toLowerCase();
}

function assertChecksum(value, label) {
  if (!/^[a-f0-9]{32}$/i.test(value)) throw new Error(`${label} must be an MD5 checksum`);
  return value.toLowerCase();
}

function sortedTypeHistogram(histogram, label) {
  if (!histogram || typeof histogram !== "object" || Array.isArray(histogram)) throw new Error(`${label} must be an object`);
  return Object.fromEntries(Object.entries(histogram)
    .map(([type, count]) => [type, assertNonNegativeInteger(Number(count), `${label}.${type}`)])
    .sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Converts aggregate-only query results into a stable Git-safe catalogue.
 * The input shape intentionally has no location for row data or raw SQL.
 */
export function buildSanitizedIntakeCatalog({ observedOn, archiveHashes, structural, metadata }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) {
    throw new Error("observedOn must be an ISO date");
  }

  const schemas = structural.schemas.map((schema) => {
    if (!requiredSchemas.includes(schema.name)) throw new Error(`unexpected schema ${schema.name}`);
    return {
      name: schema.name,
      tables: assertNonNegativeInteger(Number(schema.tables), `${schema.name}.tables`),
      columns: assertNonNegativeInteger(Number(schema.columns), `${schema.name}.columns`),
      estimatedRows: assertNonNegativeInteger(Number(schema.estimatedRows), `${schema.name}.estimatedRows`),
      primaryKeys: assertNonNegativeInteger(Number(schema.primaryKeys), `${schema.name}.primaryKeys`),
      foreignKeys: assertNonNegativeInteger(Number(schema.foreignKeys), `${schema.name}.foreignKeys`),
      views: assertNonNegativeInteger(Number(schema.views), `${schema.name}.views`),
      triggers: assertNonNegativeInteger(Number(schema.triggers), `${schema.name}.triggers`),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  if (schemas.length !== requiredSchemas.length || new Set(schemas.map(({ name }) => name)).size !== requiredSchemas.length) {
    throw new Error("the required intake schemas must be present exactly once");
  }

  const metadataCounts = Object.fromEntries(metadataTables.map((table) => [
    table,
    assertNonNegativeInteger(Number(metadata.counts[table]), `metadata.counts.${table}`),
  ]));

  const accountMaster = {
    sourceId: `program_top:${assertNonNegativeInteger(Number(metadata.accountMaster.programTopKey), "accountMaster.programTopKey")}`,
    fieldCount: assertNonNegativeInteger(Number(metadata.accountMaster.fieldCount), "accountMaster.fieldCount"),
    addActiveFields: assertNonNegativeInteger(Number(metadata.accountMaster.addActiveFields), "accountMaster.addActiveFields"),
    updateActiveFields: assertNonNegativeInteger(Number(metadata.accountMaster.updateActiveFields), "accountMaster.updateActiveFields"),
    compulsoryFields: assertNonNegativeInteger(Number(metadata.accountMaster.compulsoryFields), "accountMaster.compulsoryFields"),
    validationFields: assertNonNegativeInteger(Number(metadata.accountMaster.validationFields), "accountMaster.validationFields"),
    lookupQueryFields: assertNonNegativeInteger(Number(metadata.accountMaster.lookupQueryFields), "accountMaster.lookupQueryFields"),
    duplicateCheckFields: assertNonNegativeInteger(Number(metadata.accountMaster.duplicateCheckFields), "accountMaster.duplicateCheckFields"),
    fieldTypes: sortedTypeHistogram(metadata.accountMaster.fieldTypes, "accountMaster.fieldTypes"),
    updateDefinitionLength: assertNonNegativeInteger(Number(metadata.accountMaster.updateDefinitionLength), "accountMaster.updateDefinitionLength"),
    updateDefinitionChecksum: assertChecksum(metadata.accountMaster.updateDefinitionChecksum, "accountMaster.updateDefinitionChecksum"),
    addonDefinitionLength: assertNonNegativeInteger(Number(metadata.accountMaster.addonDefinitionLength), "accountMaster.addonDefinitionLength"),
    addonDefinitionChecksum: assertChecksum(metadata.accountMaster.addonDefinitionChecksum, "accountMaster.addonDefinitionChecksum"),
  };

  const catalog = {
    catalogVersion: 1,
    observedOn,
    restrictedData: false,
    source: {
      kind: "isolated-local-postgresql-intake",
      archiveHashes: {
        companyYear: assertHash(archiveHashes.companyYear, "archiveHashes.companyYear"),
        smartSetup: assertHash(archiveHashes.smartSetup, "archiveHashes.smartSetup"),
      },
    },
    structural: { schemas },
    metadata: {
      counts: metadataCounts,
      logicalKeyRelationships: assertNonNegativeInteger(Number(metadata.logicalKeyRelationships), "metadata.logicalKeyRelationships"),
      accountMaster,
    },
  };

  return Object.freeze({ ...catalog, catalogHash: sha256(JSON.stringify(catalog)) });
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

async function collectAggregateCatalog(database) {
  const structural = await readJson(database, `
    WITH base_tables AS (
      SELECT n.nspname AS name, c.oid, c.relname, coalesce(s.n_live_tup, 0)::bigint AS estimated_rows
      FROM pg_namespace n
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p')
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname IN ('smart_setup', 'rishabh_plastic27')
    ), schema_stats AS (
      SELECT name,
        count(*)::int AS tables,
        (SELECT count(*)::int FROM pg_attribute a JOIN base_tables bt ON bt.oid = a.attrelid WHERE bt.name = base_tables.name AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
        sum(estimated_rows)::bigint AS estimated_rows,
        (SELECT count(*)::int FROM pg_constraint con JOIN base_tables bt ON bt.oid = con.conrelid WHERE bt.name = base_tables.name AND con.contype = 'p') AS primary_keys,
        (SELECT count(*)::int FROM pg_constraint con JOIN base_tables bt ON bt.oid = con.conrelid WHERE bt.name = base_tables.name AND con.contype = 'f') AS foreign_keys,
        (SELECT count(*)::int FROM pg_class v JOIN pg_namespace ns ON ns.oid = v.relnamespace WHERE ns.nspname = base_tables.name AND v.relkind IN ('v', 'm')) AS views,
        (SELECT count(*)::int FROM pg_trigger t JOIN base_tables bt ON bt.oid = t.tgrelid WHERE bt.name = base_tables.name AND NOT t.tgisinternal) AS triggers
      FROM base_tables
      GROUP BY name
    )
    SELECT json_build_object('schemas', coalesce(json_agg(json_build_object(
      'name', name, 'tables', tables, 'columns', columns, 'estimatedRows', estimated_rows,
      'primaryKeys', primary_keys, 'foreignKeys', foreign_keys, 'views', views, 'triggers', triggers
    ) ORDER BY name), '[]'::json)) FROM schema_stats;
  `);

  const metadata = await readJson(database, `
    WITH account AS (
      SELECT pt.program_top_key,
        count(pb.program_body_key)::int AS field_count,
        count(pb.program_body_key) FILTER (WHERE pb.add_active)::int AS add_active_fields,
        count(pb.program_body_key) FILTER (WHERE pb.update_active)::int AS update_active_fields,
        count(pb.program_body_key) FILTER (WHERE pb.value_compulsory)::int AS compulsory_fields,
        count(pb.program_body_key) FILTER (WHERE nullif(btrim(pb.field_validation), '') IS NOT NULL)::int AS validation_fields,
        count(pb.program_body_key) FILTER (WHERE nullif(btrim(pb.combo_query), '') IS NOT NULL)::int AS lookup_query_fields,
        count(pb.program_body_key) FILTER (WHERE pb.duplicate_chk)::int AS duplicate_check_fields,
        coalesce(json_object_agg(coalesce(nullif(btrim(pb.field_type), ''), '<blank>'), field_type_count), '{}'::json) AS field_types,
        length(coalesce(pt.update_query, ''))::int AS update_definition_length,
        md5(coalesce(pt.update_query, '')) AS update_definition_md5,
        length(coalesce(pt.addon_query, ''))::int AS addon_definition_length,
        md5(coalesce(pt.addon_query, '')) AS addon_definition_md5
      FROM smart_setup.program_top pt
      LEFT JOIN (
        SELECT program_top_id, program_body_key, add_active, update_active, value_compulsory, field_validation, combo_query, duplicate_chk, field_type,
          count(*) OVER (PARTITION BY program_top_id, coalesce(nullif(btrim(field_type), ''), '<blank>'))::int AS field_type_count,
          row_number() OVER (PARTITION BY program_top_id, coalesce(nullif(btrim(field_type), ''), '<blank>') ORDER BY program_body_key) AS type_row
        FROM smart_setup.program_body
      ) pb ON pb.program_top_id = pt.program_top_key
      WHERE pt.program_top_key = 14
      GROUP BY pt.program_top_key, pt.update_query, pt.addon_query
    )
    SELECT json_build_object(
      'counts', json_build_object(
        'program_top', (SELECT count(*) FROM smart_setup.program_top),
        'program_body', (SELECT count(*) FROM smart_setup.program_body),
        'menumaster', (SELECT count(*) FROM smart_setup.menumaster),
        'query_table', (SELECT count(*) FROM smart_setup.query_table),
        'database_keys', (SELECT count(*) FROM smart_setup.database_keys),
        'entry_control', (SELECT count(*) FROM smart_setup.entry_control)
      ),
      'logicalKeyRelationships', (SELECT count(*) FROM smart_setup.database_keys),
      'accountMaster', (SELECT json_build_object(
        'programTopKey', program_top_key, 'fieldCount', field_count, 'addActiveFields', add_active_fields,
        'updateActiveFields', update_active_fields, 'compulsoryFields', compulsory_fields,
        'validationFields', validation_fields, 'lookupQueryFields', lookup_query_fields,
        'duplicateCheckFields', duplicate_check_fields, 'fieldTypes', field_types,
        'updateDefinitionLength', update_definition_length,
        'updateDefinitionChecksum', update_definition_md5,
        'addonDefinitionLength', addon_definition_length,
        'addonDefinitionChecksum', addon_definition_md5
      ) FROM account)
    );
  `);
  return { structural, metadata };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { structural, metadata } = await collectAggregateCatalog(options.database);
  const catalog = buildSanitizedIntakeCatalog({
    observedOn: options["observed-on"],
    archiveHashes: {
      companyYear: "ed0124bb02497f397b874370fdbdac9d27febf90f6b677b63585a717398d8d6f",
      smartSetup: "e3cb5c1dea3f264f8152c734889c1b26319ef8c57e43eea34e8db3d74ca5768b",
    },
    structural,
    metadata,
  });
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
