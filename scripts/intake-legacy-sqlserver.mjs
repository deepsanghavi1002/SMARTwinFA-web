/**
 * Read-only, local-only SQL Server discovery for the legacy SMARTwinFA lower
 * environment. It intentionally emits no client rows, password, server name,
 * connection string, SQL text, view definition, or routine body.
 *
 * Usage:
 *   node scripts/intake-legacy-sqlserver.mjs \
 *     --ini /outside/repository/Connection.INI \
 *     --output /private/tmp/smartwinfa/sqlserver-sanitized.json \
 *     --private-output /private/tmp/smartwinfa/sqlserver-object-inventory.json \
 *     --observed-on 2026-08-24 \
 *     --allow-legacy-sa
 *
 * `--private-output` is optional and contains object identifiers/types but no
 * source data or definitions. Both output paths are refused inside this Git
 * repository. The supplied SQL login is only used in memory through
 * SQLCMDPASSWORD; it is never written to output or included in process args.
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const sqlcmd = process.env.SQLCMD_PATH?.trim() || "sqlcmd";

export class LegacySqlServerIntakeError extends Error {}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new LegacySqlServerIntakeError(`${label} must be a non-negative integer`);
  return parsed;
}

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new LegacySqlServerIntakeError("observed-on must be an ISO date");
  }
  return value;
}

/** Reads only the two legacy connection settings needed by the intake. */
export function parseLegacyConnectionIni(contents) {
  if (typeof contents !== "string") throw new LegacySqlServerIntakeError("Connection.INI must be text");
  const entries = new Map();

  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || [";", "'", "#", "["].includes(line[0])) continue;
    const delimiter = line.indexOf("=");
    if (delimiter < 1) continue;
    const key = line.slice(0, delimiter).trim().toLowerCase();
    const value = line.slice(delimiter + 1).trim();
    if (!["servername", "password"].includes(key)) continue;
    if (!value || [...value].some((character) => character.charCodeAt(0) < 32)) throw new LegacySqlServerIntakeError(`Connection.INI ${key} is invalid`);
    if (entries.has(key)) throw new LegacySqlServerIntakeError(`Connection.INI contains duplicate ${key}`);
    entries.set(key, value);
  }

  const server = entries.get("servername");
  const password = entries.get("password");
  if (!server || !password) throw new LegacySqlServerIntakeError("Connection.INI must contain ServerName and Password");
  return Object.freeze({ server, password });
}

function classifyDatabase(name) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "smart_setup") return "metadata";
  if (normalized === "smart_system") return "control-plane";
  return "company-or-other";
}

function majorVersion(version) {
  const match = /^(\d+)/.exec(String(version ?? ""));
  return match ? Number(match[1]) : null;
}

function sanitizeDatabaseSummary(facts) {
  const name = String(facts.databaseName ?? "");
  if (!name) throw new LegacySqlServerIntakeError("SQL Server database summary is missing databaseName");
  const counts = {};
  for (const key of ["schemas", "tables", "columns", "views", "procedures", "functions", "triggers", "indexes", "primaryKeys", "uniqueConstraints", "foreignKeys", "checkConstraints", "defaultConstraints", "identityColumns", "moneyColumns", "dateTimeColumns"]) {
    counts[key] = positiveInteger(facts[key], `database ${key}`);
  }
  return Object.freeze({
    databaseFingerprint: sha256(`sqlserver-database:${name}`),
    role: classifyDatabase(name),
    compatibilityLevel: positiveInteger(facts.compatibilityLevel, "database compatibilityLevel"),
    collationFingerprint: sha256(`sqlserver-collation:${String(facts.collationName ?? "")}`),
    counts: Object.freeze(counts),
  });
}

/** Builds a safe, deterministic evidence record without source identifiers. */
export function buildSanitizedSqlServerInventory({ observedOn, serverFacts, databaseFacts }) {
  if (!serverFacts || typeof serverFacts !== "object" || !Array.isArray(databaseFacts)) {
    throw new LegacySqlServerIntakeError("serverFacts and databaseFacts are required");
  }
  const sourceVersion = String(serverFacts.productVersion ?? "");
  if (!sourceVersion) throw new LegacySqlServerIntakeError("SQL Server product version is required");
  const databases = databaseFacts.map(sanitizeDatabaseSummary).sort((left, right) => left.databaseFingerprint.localeCompare(right.databaseFingerprint));
  const inventory = {
    inventoryVersion: 1,
    observedOn: isoDate(observedOn),
    restrictedData: false,
    source: {
      engine: "microsoft-sql-server",
      productMajorVersion: majorVersion(sourceVersion),
      productVersionFingerprint: sha256(`sqlserver-version:${sourceVersion}`),
      editionFingerprint: sha256(`sqlserver-edition:${String(serverFacts.edition ?? "")}`),
      connectionSource: "local Connection.INI; not stored or emitted",
    },
    databases,
    conclusion: "This is a read-only structural inventory. It contains no client rows, identifiers, routine/view definitions, connection values, or behavior/parity claim. Object-level mapping and routine review remain required before migration writes.",
  };
  return Object.freeze({ ...inventory, inventoryHash: sha256(JSON.stringify(inventory)) });
}

function parseArguments(args) {
  const options = { trustServerCertificate: false, allowLegacySa: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--trust-server-certificate") {
      options.trustServerCertificate = true;
      continue;
    }
    if (argument === "--allow-legacy-sa") {
      options.allowLegacySa = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new LegacySqlServerIntakeError(`unexpected argument ${argument}`);
    const key = argument.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--") || options[key]) throw new LegacySqlServerIntakeError(`${argument} requires one value`);
    options[key] = value;
    index += 1;
  }
  if (!options.ini || !options.output || !options["observed-on"]) {
    throw new LegacySqlServerIntakeError("usage: --ini PATH --output PATH --observed-on YYYY-MM-DD --allow-legacy-sa");
  }
  isoDate(options["observed-on"]);
  return options;
}

async function assertOutsideRepository(filePath, repositoryRoot) {
  const output = path.resolve(filePath);
  const relative = path.relative(repositoryRoot, output);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new LegacySqlServerIntakeError("intake output must be outside the Git repository");
  }
  await mkdir(path.dirname(output), { recursive: true });
  return output;
}

function parseSqlcmdJson(stdout) {
  const content = stdout.trim();
  if (!content) throw new LegacySqlServerIntakeError("SQL Server returned no inventory result");
  try {
    return JSON.parse(content);
  } catch {
    throw new LegacySqlServerIntakeError("SQL Server inventory output was not valid JSON");
  }
}

async function querySqlServer({ server, password, database, query, trustServerCertificate }) {
  const args = ["-S", server, "-U", "sa", "-d", database, "-l", "10", "-b", "-r", "1", "-X", "-h", "-1", "-W", "-w", "65535", "-y", "0", "-Y", "0", "-Q", query];
  if (trustServerCertificate) args.splice(8, 0, "-C");
  try {
    const { stdout } = await execFile(sqlcmd, args, {
      env: { ...process.env, SQLCMDPASSWORD: password },
      maxBuffer: 50 * 1024 * 1024,
      timeout: 45_000,
    });
    return parseSqlcmdJson(stdout);
  } catch (error) {
    if (error instanceof LegacySqlServerIntakeError) throw error;
    throw new LegacySqlServerIntakeError("SQL Server inventory query failed; check lower-environment reachability, SQL login access, and TLS settings");
  }
}

const DATABASE_LIST_QUERY = `
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW;
SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS productVersion,
       CAST(SERVERPROPERTY('Edition') AS nvarchar(256)) AS edition,
       JSON_QUERY((SELECT name, compatibility_level AS compatibilityLevel, collation_name AS collationName
                   FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name FOR JSON PATH)) AS databases
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`;

const DATABASE_SUMMARY_QUERY = `
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW;
SELECT DB_NAME() AS databaseName,
       DATABASEPROPERTYEX(DB_NAME(), 'CompatibilityLevel') AS compatibilityLevel,
       CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) AS collationName,
       (SELECT COUNT(*) FROM sys.schemas WHERE principal_id <> 0 AND name NOT IN ('sys', 'INFORMATION_SCHEMA')) AS schemas,
       (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0) AS tables,
       (SELECT COUNT(*) FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id WHERE t.is_ms_shipped = 0) AS columns,
       (SELECT COUNT(*) FROM sys.views WHERE is_ms_shipped = 0) AS views,
       (SELECT COUNT(*) FROM sys.procedures WHERE is_ms_shipped = 0) AS procedures,
       (SELECT COUNT(*) FROM sys.objects WHERE is_ms_shipped = 0 AND type IN ('FN', 'IF', 'TF', 'FS', 'FT')) AS functions,
       (SELECT COUNT(*) FROM sys.triggers WHERE is_ms_shipped = 0) AS triggers,
       (SELECT COUNT(*) FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id WHERE t.is_ms_shipped = 0 AND i.index_id > 0) AS indexes,
       (SELECT COUNT(*) FROM sys.key_constraints WHERE type = 'PK') AS primaryKeys,
       (SELECT COUNT(*) FROM sys.key_constraints WHERE type = 'UQ') AS uniqueConstraints,
       (SELECT COUNT(*) FROM sys.foreign_keys) AS foreignKeys,
       (SELECT COUNT(*) FROM sys.check_constraints) AS checkConstraints,
       (SELECT COUNT(*) FROM sys.default_constraints) AS defaultConstraints,
       (SELECT COUNT(*) FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id WHERE t.is_ms_shipped = 0 AND c.is_identity = 1) AS identityColumns,
       (SELECT COUNT(*) FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.types y ON y.user_type_id = c.user_type_id WHERE t.is_ms_shipped = 0 AND y.name IN ('money', 'smallmoney')) AS moneyColumns,
       (SELECT COUNT(*) FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.types y ON y.user_type_id = c.user_type_id WHERE t.is_ms_shipped = 0 AND y.name IN ('date', 'datetime', 'datetime2', 'datetimeoffset', 'smalldatetime', 'time')) AS dateTimeColumns
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`;

const DATABASE_OBJECT_QUERY = `
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW;
SELECT JSON_QUERY((SELECT s.name AS schemaName, t.name AS tableName, t.object_id AS objectId
                   FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
                   WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name FOR JSON PATH)) AS tables,
       JSON_QUERY((SELECT s.name AS schemaName, t.name AS tableName, c.name AS columnName,
                          y.name AS typeName, c.max_length AS maxLength, c.precision, c.scale,
                          c.is_nullable AS isNullable, c.is_identity AS isIdentity
                   FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
                   JOIN sys.schemas s ON s.schema_id = t.schema_id JOIN sys.types y ON y.user_type_id = c.user_type_id
                   WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name, c.column_id FOR JSON PATH)) AS columns,
       JSON_QUERY((SELECT s.name AS schemaName, o.name AS objectName, o.type AS objectType
                   FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
                   WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'PC', 'V', 'FN', 'IF', 'TF', 'FS', 'FT', 'TR')
                   ORDER BY s.name, o.type, o.name FOR JSON PATH)) AS programmableObjects,
       JSON_QUERY((SELECT kc.name AS constraintName, kc.type AS constraintType, s.name AS schemaName, t.name AS tableName
                   FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id
                   JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0
                   ORDER BY s.name, t.name, kc.name FOR JSON PATH)) AS keyConstraints
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`;

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.allowLegacySa) {
    throw new LegacySqlServerIntakeError("refusing legacy sa access without --allow-legacy-sa; use a dedicated read-only login when available");
  }

  const repositoryRoot = await realpath(process.cwd());
  const output = await assertOutsideRepository(options.output, repositoryRoot);
  const privateOutput = options["private-output"] ? await assertOutsideRepository(options["private-output"], repositoryRoot) : null;
  if (privateOutput === output) throw new LegacySqlServerIntakeError("sanitized and private output paths must differ");
  const connection = parseLegacyConnectionIni(await readFile(path.resolve(options.ini), "utf8"));
  const masterFacts = await querySqlServer({ ...connection, database: "master", query: DATABASE_LIST_QUERY, trustServerCertificate: options.trustServerCertificate });
  if (!Array.isArray(masterFacts.databases)) throw new LegacySqlServerIntakeError("SQL Server inventory is missing its database list");

  const summaries = [];
  const privateDatabases = [];
  for (const database of masterFacts.databases) {
    const databaseName = String(database.name ?? "");
    if (!databaseName) throw new LegacySqlServerIntakeError("SQL Server returned an invalid database name");
    const facts = await querySqlServer({ ...connection, database: databaseName, query: DATABASE_SUMMARY_QUERY, trustServerCertificate: options.trustServerCertificate });
    summaries.push(facts);
    if (privateOutput) {
      const objects = await querySqlServer({ ...connection, database: databaseName, query: DATABASE_OBJECT_QUERY, trustServerCertificate: options.trustServerCertificate });
      privateDatabases.push({ databaseName, compatibilityLevel: database.compatibilityLevel, collationName: database.collationName, ...objects });
    }
  }

  const sanitized = buildSanitizedSqlServerInventory({ observedOn: options["observed-on"], serverFacts: masterFacts, databaseFacts: summaries });
  await writeFile(output, `${JSON.stringify(sanitized, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  if (privateOutput) {
    const privateInventory = {
      inventoryVersion: 1,
      observedOn: options["observed-on"],
      restrictedData: true,
      source: { engine: "microsoft-sql-server", contents: "object identifiers and structural types only; no rows, definitions, or credentials" },
      databases: privateDatabases,
    };
    await writeFile(privateOutput, `${JSON.stringify(privateInventory, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`Sanitized SQL Server inventory written. Databases inventoried: ${summaries.length}.\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "legacy SQL Server intake failed"}\n`);
    process.exitCode = 1;
  });
}
