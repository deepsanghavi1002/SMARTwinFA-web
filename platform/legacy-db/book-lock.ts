import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";
const SCHEMA = legacyCompanySchema();

export async function changeLegacyBookLock(raw: unknown) {
  if (process.env.SMARTWINFA_ENTRY_WRITES !== "true") throw new Error("Workflow writes are disabled in this environment");
  const input = raw as Record<string, unknown>; const setupKey = Number(input?.setupKey); const action = input?.action;
  const from = typeof input?.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : "";
  const upto = typeof input?.upto === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.upto) ? input.upto : "";
  if (!Number.isInteger(setupKey) || setupKey < 1 || (action !== "lock" && action !== "unlock") || (action === "lock" && (!from || !upto || from > upto))) throw new Error("Select a valid lock action and date range");
  const client = await legacyPool().connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [600141141541155]);
    const result = await client.query(`UPDATE ${SCHEMA}.book_setup SET lock_from=CASE WHEN $2='lock' THEN $3::date ELSE NULL END, lock_upto=CASE WHEN $2='lock' THEN $4::date ELSE NULL END, open_from=CASE WHEN $2='unlock' THEN $3::date ELSE open_from END, open_upto=CASE WHEN $2='unlock' THEN $4::date ELSE open_upto END, last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE bs_rec=$1 RETURNING bs_rec,book,lock_from::date::text AS lock_from,lock_upto::date::text AS lock_upto`, [setupKey, action, from || null, upto || null]);
    if (!result.rowCount) throw new Error("The selected book setup no longer exists"); await client.query("COMMIT"); return { source: "legacy-postgresql", action, setup: result.rows[0] };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
}
