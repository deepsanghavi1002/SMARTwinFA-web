#!/usr/bin/env node

/**
 * Indexes every company schema needs that the legacy databases never had.
 *
 * Company schemas (rishabh_plastic27 and each client's own) come from the desktop's company
 * creation or from a clone, with primary keys only. The Product master joins pricelist,
 * addon_data and prod_balance on prod_id once per product; without these indexes its grid
 * query took 33 s for 18,007 products, and 0.9 s with them (2026-09-29).
 *
 * Run after a company schema is created or restored (safe to run again: an index that exists
 * is left as it is):
 *   node scripts/company-indexes.mjs                  every schema that has the tables
 *   node scripts/company-indexes.mjs --schema <name>  one schema
 *   node scripts/company-indexes.mjs --dry-run        list what is missing, change nothing
 * The connection is --target-url, else DATABASE_URL with DB_PASSWORD, else DB_HOST/DB_PORT/
 * DB_NAME/DB_USER/DB_PASSWORD, read from the environment or .env.local.
 *
 * Indexes are built CONCURRENTLY, so people working in the company are not locked out while
 * they build; the tables are analysed afterwards so the planner uses them.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** name, table, columns. Add new company-schema indexes here. */
export const COMPANY_INDEXES = Object.freeze([
  { name: "ix_pricelist_prod_pos_wefrom", table: "pricelist", columns: ["prod_id", "pl_pos", "pl_wefrom"] },
  { name: "ix_addon_data_prod", table: "addon_data", columns: ["prod_id"] },
  { name: "ix_prod_balance_prod_year", table: "prod_balance", columns: ["prod_id", "year_id"] },
]);

function identifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value || "")) throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  return `"${value.replaceAll('"', '""')}"`;
}

/** The schemas holding at least one table these indexes are for. */
export async function companySchemas(client) {
  const tables = [...new Set(COMPANY_INDEXES.map((index) => index.table))];
  const { rows } = await client.query(
    "SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_name = ANY($1) ORDER BY table_schema",
    [tables],
  );
  return rows.map((row) => row.table_schema);
}

/**
 * Creates the indexes missing in one schema. A table the schema lacks, or one without every
 * indexed column, is skipped and reported. Returns what was (or, dryRun, would be) created.
 */
export async function applyCompanyIndexes(client, schema, { dryRun = false, log = console.log } = {}) {
  const created = [];
  const touched = new Set();
  for (const index of COMPANY_INDEXES) {
    const { rows: columns } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
      [schema, index.table],
    );
    const have = new Set(columns.map((row) => row.column_name));
    const missing = index.columns.filter((column) => !have.has(column));
    if (columns.length === 0 || missing.length > 0) {
      log(`  ${schema}.${index.table}: skipped (${columns.length === 0 ? "no such table" : `no column ${missing.join(", ")}`})`);
      continue;
    }
    const exists = await client.query("SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2", [schema, index.name]);
    if (exists.rowCount) continue;
    const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${identifier(index.name)} ON ${identifier(schema)}.${identifier(index.table)} (${index.columns.map(identifier).join(", ")})`;
    if (dryRun) {
      log(`  would create ${schema}.${index.name} on ${index.table} (${index.columns.join(", ")})`);
    } else {
      const started = Date.now();
      await client.query(sql);
      log(`  created ${schema}.${index.name} on ${index.table} (${index.columns.join(", ")}) in ${Date.now() - started} ms`);
      touched.add(index.table);
    }
    created.push(`${schema}.${index.name}`);
  }
  if (touched.size > 0) await client.query(`ANALYZE ${[...touched].map((table) => `${identifier(schema)}.${identifier(table)}`).join(", ")}`);
  return created;
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** The environment, filled in from .env.local where it says nothing. */
function settings() {
  const file = path.resolve(".env.local");
  const local = fs.existsSync(file)
    ? Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => /^\w+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]))
    : {};
  return { ...local, ...process.env };
}

function connection() {
  const env = settings();
  const url = option("--target-url");
  if (url) return { connectionString: url };
  if (env.DB_NAME) {
    return { host: env.DB_HOST || "localhost", port: Number(env.DB_PORT || 5432), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD };
  }
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL, password: env.DB_PASSWORD };
  throw new Error("No database: pass --target-url, or set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD (environment or .env.local).");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = new pg.Client({ ...connection(), application_name: "smartwinfa-company-indexes" });
  await client.connect();
  try {
    const only = option("--schema");
    const schemas = only ? [only] : await companySchemas(client);
    if (schemas.length === 0) { console.log("No company schema found."); return; }
    let total = 0;
    for (const schema of schemas) {
      console.log(`${schema}:`);
      const created = await applyCompanyIndexes(client, schema, { dryRun });
      if (created.length === 0) console.log("  all indexes present");
      total += created.length;
    }
    console.log(dryRun ? `${total} index(es) missing.` : `${total} index(es) created.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Company indexes failed: ${error.message}`);
    process.exitCode = 1;
  });
}
