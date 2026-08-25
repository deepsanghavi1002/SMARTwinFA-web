import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";
const SCHEMA = legacyCompanySchema();

export async function cancelLegacyEntry(raw: unknown) {
  if (process.env.SMARTWINFA_ENTRY_WRITES !== "true") throw new Error("Entry writes are disabled in this environment");
  const processKey = Number((raw as Record<string, unknown>)?.processKey); if (!Number.isInteger(processKey) || processKey < 1) throw new Error("Select a document to cancel");
  const client = await legacyPool().connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [600141141541150]);
    const header = await client.query<{ full_docno: string; year_id: string }>(`SELECT full_docno,year_id FROM ${SCHEMA}.process WHERE process_key=$1 AND COALESCE(il_pos,'')<>'D' FOR UPDATE`, [processKey]);
    if (!header.rowCount) throw new Error("The document is already cancelled or no longer exists"); const document = header.rows[0];
    const lines = await client.query<{ prod_id: number; quantity: string }>(`SELECT prod_id,quantity::text FROM ${SCHEMA}.prod_ledger WHERE full_docno=$1 AND COALESCE(il_pos,'')<>'D' FOR UPDATE`, [document.full_docno]);
    for (const line of lines.rows) await client.query(`UPDATE ${SCHEMA}.prod_balance SET less_pcs=COALESCE(less_pcs,0)-$1,clsg_pcs=COALESCE(clsg_pcs,0)+$1 WHERE prod_id=$2 AND year_id=$3 AND prec_flag='RP'`, [line.quantity, line.prod_id, document.year_id]);
    await client.query(`UPDATE ${SCHEMA}.prod_ledger SET il_pos='D' WHERE full_docno=$1 AND COALESCE(il_pos,'')<>'D'`, [document.full_docno]);
    await client.query(`UPDATE ${SCHEMA}.ledger SET doc_pos='D' WHERE full_docno=$1 AND COALESCE(doc_pos,'')<>'D'`, [document.full_docno]);
    await client.query(`UPDATE ${SCHEMA}.process SET il_pos='D',last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE process_key=$1`, [processKey]);
    await client.query("COMMIT"); return { source: "legacy-postgresql", cancelled: true, processKey, stockLinesRestored: lines.rowCount };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
}
