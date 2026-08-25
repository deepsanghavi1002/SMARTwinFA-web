import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";
const SCHEMA = legacyCompanySchema();
export async function recordLegacyDocumentPrint(raw: unknown) {
  if (process.env.SMARTWINFA_ENTRY_WRITES !== "true") throw new Error("Workflow writes are disabled in this environment");
  const source = raw as Record<string, unknown>; const requested = Array.isArray(source?.processKeys) ? source.processKeys : [];
  const processKeys = Array.from(new Set(requested.map(Number).filter((key: number) => Number.isInteger(key) && key > 0)));
  if (!processKeys.length || processKeys.length > 500) throw new Error("Select between one and 500 documents to print");
  const client = await legacyPool().connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [600141141541156]);
    const printed = await client.query(`UPDATE ${SCHEMA}.process SET print_count=COALESCE(print_count,0)+1,last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE process_key = ANY($1::int[]) AND COALESCE(il_pos,'')<>'D' RETURNING process_key,full_docno`, [processKeys]);
    if (printed.rowCount !== processKeys.length) throw new Error("One or more selected documents no longer exist"); await client.query("COMMIT"); return { source: "legacy-postgresql", printed: printed.rowCount };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
}
