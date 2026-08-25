import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";

const SCHEMA = legacyCompanySchema();
const maxRows = 500;

export type ProductImportRow = Readonly<{ prod_short: string; prod_desc?: string; bill_desc?: string; bar_code?: string; hsn_code?: string; uom?: string; rate?: number; openingStock?: number }>;
export type ProductImportCommand = Readonly<{ groupKey: number; yearId: string; rows: ReadonlyArray<ProductImportRow> }>;

function clean(value: unknown, length: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, length);
}

export function validateProductImport(raw: unknown): ProductImportCommand {
  if (!raw || typeof raw !== "object") throw new Error("Invalid product import command");
  const source = raw as Record<string, unknown>;
  const groupKey = Number(source.groupKey);
  const yearId = typeof source.yearId === "string" && /^\d{16}$/.test(source.yearId) ? source.yearId : "";
  if (!Number.isSafeInteger(groupKey) || groupKey <= 0) throw new Error("Select a valid product group");
  if (!yearId) throw new Error("A valid accounting year is required");
  if (!Array.isArray(source.rows) || !source.rows.length || source.rows.length > maxRows) throw new Error(`Import between 1 and ${maxRows} product rows at a time`);
  const rows = source.rows.map((rawRow, index) => {
    if (!rawRow || typeof rawRow !== "object") throw new Error(`Invalid product row ${index + 1}`);
    const row = rawRow as Record<string, unknown>;
    const prod_short = clean(row.prod_short, 250);
    if (!prod_short) throw new Error(`Product name is required on row ${index + 1}`);
    const rate = Number(row.rate ?? 0); const openingStock = Number(row.openingStock ?? 0);
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(openingStock)) throw new Error(`Invalid rate or opening stock on row ${index + 1}`);
    return { prod_short, prod_desc: clean(row.prod_desc, 250), bill_desc: clean(row.bill_desc, 250), bar_code: clean(row.bar_code, 250), hsn_code: clean(row.hsn_code, 80), uom: clean(row.uom, 40), rate, openingStock };
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.prod_short.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate product name in import: ${row.prod_short}`);
    seen.add(key);
  }
  return { groupKey, yearId, rows };
}

export async function importLegacyProducts(raw: unknown) {
  if (process.env.SMARTWINFA_MASTER_WRITES !== "true") throw new Error("Master writes are disabled in this environment");
  const command = validateProductImport(raw);
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='30000ms'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [600141141143]);
    const names = command.rows.map((row) => row.prod_short);
    const duplicates = await client.query<{ prod_short: string }>(`SELECT prod_short FROM ${SCHEMA}.product_master WHERE prod_group=$1 AND prod_pos<>'D' AND lower(btrim(prod_short)) = ANY(SELECT lower(unnest($2::text[])))`, [command.groupKey, names]);
    if (duplicates.rowCount) throw new Error(`Active product already exists: ${duplicates.rows.map((row) => row.prod_short).join(", ")}`);
    const inserted: number[] = [];
    for (const row of command.rows) {
      const uom = row.uom ? await client.query<{ uom_key: number }>(`SELECT uom_key FROM ${SCHEMA}.prod_uom WHERE lower(btrim(uom_short))=lower($1) AND COALESCE(uom_pos,'A')<>'D' ORDER BY uom_key LIMIT 1`, [row.uom]) : { rows: [] as { uom_key: number }[] };
      const uomKey = uom.rows[0]?.uom_key ?? 0;
      const result = await client.query<{ code: number }>(`INSERT INTO ${SCHEMA}.product_master(prod_key,prod_short,prod_desc,bill_desc,bar_code,hsn_code,issuuom_id,prod_group,prod_pos,last_savedate,last_savetime) SELECT COALESCE(MAX(prod_key),0)+1,$1,$2,$3,$4,$5,$6,$7,'A',CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS') FROM ${SCHEMA}.product_master RETURNING prod_key AS code`, [row.prod_short, row.prod_desc, row.bill_desc, row.bar_code, row.hsn_code, uomKey, command.groupKey]);
      const code = result.rows[0].code;
      await client.query(`INSERT INTO ${SCHEMA}.prod_balance(prodbal_key,prod_id,year_id,prec_flag) SELECT COALESCE(MAX(prodbal_key),0)+1,$1,$2,'RP' FROM ${SCHEMA}.prod_balance`, [code, command.yearId]);
      await client.query(`UPDATE ${SCHEMA}.prod_balance SET open_pcs=$1,add_pcs=$1,clsg_pcs=$1,p_rate=$2,rep_rate=$2 WHERE prod_id=$3 AND year_id=$4 AND prec_flag='RP'`, [row.openingStock, row.rate, code, command.yearId]);
      if ((row.rate ?? 0) > 0) await client.query(`INSERT INTO ${SCHEMA}.pricelist(pl_key,prod_id,pl_wefrom,pl_srate,pl_suom,pl_pos,last_savedate,last_savetime) SELECT COALESCE(MAX(pl_key),0)+1,$1,CURRENT_DATE,$2,$3,'A',CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS') FROM ${SCHEMA}.pricelist`, [code, row.rate ?? 0, uomKey]);
      inserted.push(code);
    }
    await client.query("COMMIT");
    return { source: "legacy-postgresql" as const, operation: "product-import" as const, imported: inserted.length, productKeys: inserted };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
