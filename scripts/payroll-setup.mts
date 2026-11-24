#!/usr/bin/env node

/**
 * Opens the Payroll structure in every company database.
 *
 * For each company schema (every schema that has the account, ac_balance and ledger tables) it creates the payroll tables that are missing
 * (lib/payroll/schema.ts), and once for the whole installation it adds the Payroll menu rows to smart_setup.menumaster (lib/payroll/menu.ts).
 * Safe to run again: what exists is left as it is, and a company already at the current version is skipped. Run it after the software is
 * updated, and after a company is created or restored. (The web screens also make a company's tables on first use if it was missed.)
 *
 *   node --experimental-strip-types scripts/payroll-setup.mts                  every company schema, plus the menu
 *   node --experimental-strip-types scripts/payroll-setup.mts --schema <name>  one company schema
 *   node --experimental-strip-types scripts/payroll-setup.mts --dry-run        do everything, then roll it back: proves the SQL, changes nothing
 *   node --experimental-strip-types scripts/payroll-setup.mts --activate       also put "PAYROLL," in smart_system.setup.menu_para (module on)
 *   node --experimental-strip-types scripts/payroll-setup.mts --no-menu        tables only
 *
 * The module shows in the web menu only while smart_system.setup.menu_para contains "PAYROLL,". Back up the database before the first real run.
 * The connection is --target-url, else DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, else DATABASE_URL with DB_PASSWORD (environment or .env.local).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { PAYROLL_ACTIVATION, PAYROLL_NEEDS, applyPayroll } from "../lib/payroll/schema.ts";
import { applyPayrollMenu } from "../lib/payroll/menu.ts";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function settings(): Record<string, string | undefined> {
  const file = path.resolve(".env.local");
  const local = fs.existsSync(file)
    ? Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => /^\w+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]))
    : {};
  return { ...local, ...process.env };
}

function connection(): pg.ClientConfig {
  const env = settings();
  const url = option("--target-url");
  if (url) return { connectionString: url };
  if (env.DB_NAME) return { host: env.DB_HOST || "localhost", port: Number(env.DB_PORT || 5432), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD };
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL, password: env.DB_PASSWORD };
  throw new Error("No database: pass --target-url, or set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD (environment or .env.local).");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = new pg.Client({ ...connection(), application_name: "smartwinfa-payroll-setup" });
  await client.connect();
  const env = settings();
  const systemSchema = env.DB_SCHEMA_SYSTEM || "smart_system";
  const setupSchema = env.DB_SCHEMA_SETUP || "smart_setup";
  const finish = async (commit: boolean) => { await client.query(commit && !dryRun ? "COMMIT" : "ROLLBACK"); };
  try {
    const only = option("--schema");
    const schemas = only
      ? [only]
      : (await client.query(
          "SELECT table_schema FROM information_schema.tables WHERE table_name = ANY($1) GROUP BY table_schema HAVING COUNT(DISTINCT table_name) = $2 ORDER BY table_schema",
          [[...PAYROLL_NEEDS], PAYROLL_NEEDS.length],
        )).rows.map((row) => String(row.table_schema));
    if (schemas.length === 0) { console.log("No company schema found."); return; }
    console.log(dryRun ? "DRY RUN: every change is rolled back." : "Applying.");

    let failed = 0;
    for (const schema of schemas) {
      await client.query("BEGIN");
      try {
        const applied = await applyPayroll(client, schema, console.log);
        console.log(applied.length === 0 ? `  ${schema}: already current` : `  ${schema}: ${applied.length} step(s) ${dryRun ? "would be applied" : "applied"}`);
        await finish(true);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        failed += 1;
        console.error(`  ${schema}: FAILED - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!process.argv.includes("--no-menu")) {
      await client.query("BEGIN");
      try {
        const added = await applyPayrollMenu(client, setupSchema);
        console.log(added.length === 0 ? "Menu: Payroll rows already present" : `Menu: ${dryRun ? "would add" : "added"} ${added.join(", ")}`);
        await finish(true);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        failed += 1;
        console.error(`Menu: FAILED - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (process.argv.includes("--activate")) {
      await client.query("BEGIN");
      try {
        const row = (await client.query(`SELECT menu_para FROM ${systemSchema}.setup WHERE setup_key = 1`)).rows[0];
        if (!row) throw new Error(`${systemSchema}.setup has no row 1`);
        const current = String(row.menu_para ?? "");
        if (current.toUpperCase().includes(PAYROLL_ACTIVATION)) console.log("Activation: menu_para already has PAYROLL,");
        else {
          await client.query(`UPDATE ${systemSchema}.setup SET menu_para = $1 WHERE setup_key = 1`, [`${current}${PAYROLL_ACTIVATION}`]);
          console.log(`Activation: menu_para ${dryRun ? "would become" : "is now"} "${current}${PAYROLL_ACTIVATION}"`);
        }
        await finish(true);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        failed += 1;
        console.error(`Activation: FAILED - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (failed > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Payroll setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
