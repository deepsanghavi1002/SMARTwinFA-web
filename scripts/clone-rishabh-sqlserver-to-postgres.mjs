#!/usr/bin/env node

/**
 * Creates an isolated PostgreSQL reference clone from the legacy, read-only
 * SQL Server company database.  It never modifies the source, existing app
 * schema, or an already-existing target schema.
 *
 * Example:
 *   node scripts/clone-rishabh-sqlserver-to-postgres.mjs \
 *     --source-ini /secure/Connection.INI \
 *     --target-url postgresql://user@localhost/smartwin_data_intake \
 *     --schema rishabh_plastic27_reference_20260824
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import sql from "mssql";
import pg from "pg";

const { Client } = pg;

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function identifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value || "")) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function readIni(iniPath) {
  const raw = fs.readFileSync(iniPath, "utf8");
  const values = new Map();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("[") || line.startsWith("'")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  const serverName = values.get("servername");
  const password = values.get("password");
  if (!serverName || !password) throw new Error("The source INI must include ServerName and Password.");
  const comma = serverName.lastIndexOf(",");
  return {
    server: comma >= 0 ? serverName.slice(0, comma) : serverName,
    port: comma >= 0 ? Number(serverName.slice(comma + 1)) : 1433,
    password,
  };
}

function pgType(column) {
  const type = column.type_name.toLowerCase();
  if (type === "bigint") return "bigint";
  if (type === "int") return "integer";
  if (type === "smallint" || type === "tinyint") return "smallint";
  if (type === "bit") return "boolean";
  if (type === "decimal" || type === "numeric") return `numeric(${column.precision},${column.scale})`;
  if (type === "money") return "numeric(19,4)";
  if (type === "smallmoney") return "numeric(10,4)";
  if (type === "float") return "double precision";
  if (type === "real") return "real";
  if (type === "date") return "date";
  if (type === "time") return "time";
  if (type === "datetime" || type === "datetime2" || type === "smalldatetime" || type === "datetimeoffset") return "timestamp";
  if (type === "uniqueidentifier") return "uuid";
  if (["binary", "varbinary", "image", "timestamp", "rowversion"].includes(type)) return "bytea";
  return "text";
}

function sourceExpression(column) {
  const name = `[${column.column_name.replaceAll("]", "]]" )}]`;
  const type = column.type_name.toLowerCase();
  if (["decimal", "numeric", "money", "smallmoney"].includes(type)) return `CONVERT(varchar(100), ${name}) AS ${name}`;
  if (["datetime", "datetime2", "smalldatetime", "datetimeoffset"].includes(type)) return `CONVERT(varchar(40), ${name}, 126) AS ${name}`;
  if (type === "date") return `CONVERT(varchar(10), ${name}, 23) AS ${name}`;
  if (type === "time") return `CONVERT(varchar(30), ${name}, 114) AS ${name}`;
  if (type === "uniqueidentifier" || type === "xml" || type === "sql_variant" || type === "ntext" || type === "text") return `CONVERT(nvarchar(max), ${name}) AS ${name}`;
  return name;
}

function outputName(value) {
  return value.toLowerCase();
}

async function insertBatch(client, schema, table, columns, batch) {
  if (!batch.length) return;
  const columnSql = columns.map((column) => identifier(outputName(column.column_name))).join(", ");
  const perRow = columns.length;
  const valueSql = batch.map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * perRow + columnIndex + 1}`).join(", ")})`).join(", ");
  const values = batch.flatMap((row) => columns.map((column) => row[column.column_name] ?? null));
  await client.query(`INSERT INTO ${identifier(schema)}.${identifier(outputName(table))} (${columnSql}) VALUES ${valueSql}`, values);
}

async function cloneTable(sourcePool, target, schema, table) {
  const columns = await sourcePool.request().query(`
    SELECT c.column_id, c.name AS column_name, ty.name AS type_name,
           c.max_length, c.precision, c.scale, c.is_nullable
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE s.name = 'dbo' AND t.name = @tableName AND c.is_computed = 0
    ORDER BY c.column_id;
  `.replace("@tableName", `'${table.replaceAll("'", "''")}'`));
  const fields = columns.recordset;
  if (!fields.length) throw new Error(`No importable columns found for ${table}.`);

  const definition = fields.map((column) => `${identifier(outputName(column.column_name))} ${pgType(column)}${column.is_nullable ? "" : " NOT NULL"}`).join(", ");
  await target.query(`CREATE TABLE ${identifier(schema)}.${identifier(outputName(table))} (${definition})`);

  const query = `SELECT ${fields.map(sourceExpression).join(", ")} FROM [dbo].[${table.replaceAll("]", "]]" )}]`;
  const request = sourcePool.request();
  request.stream = true;
  const batchSize = Math.max(1, Math.min(200, Math.floor(60_000 / fields.length)));
  let copied = 0;
  let pending = [];
  let flush = Promise.resolve();

  await new Promise((resolve, reject) => {
    request.on("row", (row) => {
      pending.push(row);
      if (pending.length < batchSize) return;
      const batch = pending;
      pending = [];
      request.pause();
      flush = flush.then(() => insertBatch(target, schema, table, fields, batch)).then(() => {
        copied += batch.length;
        request.resume();
      });
      flush.catch(reject);
    });
    request.on("error", reject);
    request.on("done", () => resolve());
    request.query(query);
  });
  await flush;
  await insertBatch(target, schema, table, fields, pending);
  copied += pending.length;
  return copied;
}

async function main() {
  const sourceIni = option("--source-ini");
  const targetUrl = option("--target-url") || process.env.LEGACY_DATABASE_URL;
  const schema = option("--schema");
  if (!sourceIni || !targetUrl || !schema) {
    throw new Error("Usage: --source-ini <path> --target-url <url> --schema <new_schema>");
  }
  const ini = readIni(path.resolve(sourceIni));
  const source = await sql.connect({
    server: ini.server,
    port: ini.port,
    user: "sa",
    password: ini.password,
    database: "rishabh_plastic27",
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 15_000,
    requestTimeout: 0,
  });
  const target = new Client({ connectionString: targetUrl, application_name: "smartwinfa-source-clone" });
  await target.connect();
  try {
    const exists = await target.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [schema]);
    if (exists.rowCount) throw new Error(`Target schema ${schema} already exists; refusing to overwrite it.`);
    const sourceTables = await source.request().query("SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='dbo' ORDER BY t.name");
    await target.query(`CREATE SCHEMA ${identifier(schema)}`);
    console.log(`Creating PostgreSQL reference clone ${schema} from ${sourceTables.recordset.length} source tables.`);
    let copiedRows = 0;
    for (const [index, record] of sourceTables.recordset.entries()) {
      const tableRows = await cloneTable(source, target, schema, record.name);
      copiedRows += tableRows;
      console.log(`${index + 1}/${sourceTables.recordset.length} ${record.name}: ${tableRows} rows`);
    }
    const verified = await target.query(`SELECT COUNT(*)::integer AS tables FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'`, [schema]);
    console.log(`Clone complete: ${verified.rows[0].tables} tables, ${copiedRows} rows.`);
  } finally {
    await target.end();
    await source.close();
  }
}

main().catch((error) => {
  console.error(`Clone failed: ${error.message}`);
  process.exitCode = 1;
});
