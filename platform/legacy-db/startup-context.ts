import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";

const COMPANY_SCHEMA = legacyCompanySchema();

export type LegacyStartupContext = Readonly<{
  source: "legacy-postgresql";
  authenticationMode: "migration-test";
  companies: ReadonlyArray<Readonly<{ id: string; name: string; code: string; address: string }>>;
  years: ReadonlyArray<Readonly<{ id: string; label: string }>>;
}>;

function formatDate(value: string) {
  const day = value.slice(0, 2);
  const monthNumber = Number(value.slice(2, 4));
  const year = value.slice(4, 8);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day}/${months[monthNumber - 1] ?? value.slice(2, 4)}/${year}`;
}

function yearLabel(yearId: string) {
  return yearId.length === 16
    ? `${formatDate(yearId.slice(0, 8))} to ${formatDate(yearId.slice(8, 16))}`
    : yearId;
}

export async function readLegacyStartupContext(): Promise<LegacyStartupContext> {
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await client.query<{ year_id: string }>(`
      SELECT year_id
      FROM (
        SELECT DISTINCT year_id FROM ${COMPANY_SCHEMA}.ac_balance WHERE year_id IS NOT NULL
        UNION
        SELECT DISTINCT year_id FROM ${COMPANY_SCHEMA}.prod_balance WHERE year_id IS NOT NULL
      ) years
      ORDER BY year_id DESC
    `);
    if (!result.rows.length) throw new Error("No accounting year is available in the restored company database");
    await client.query("COMMIT");
    return {
      source: "legacy-postgresql",
      authenticationMode: "migration-test",
      companies: [{
        id: COMPANY_SCHEMA,
        name: "RISHABH PLASTIC 27 (RESTORED)",
        code: "RP27",
        address: "Restored PostgreSQL company database",
      }],
      years: result.rows.map(({ year_id }) => ({ id: year_id, label: yearLabel(year_id) })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
