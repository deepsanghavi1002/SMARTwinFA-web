import type { RepostContext } from "./context";
import { rows, run } from "./context";

/**
 * The indexes the re-post's statements look up by (the desktop's company databases have them). Each statement below reads the ledger, the product
 * lines or the outstanding once for every account, product or bill; without these every one of them is a scan of the whole table. A missing one is made
 * (IF NOT EXISTS) before the blocks run and stays: the screens and reports use them too.
 */
const WANTED: readonly (readonly [table: string, column: string])[] = [
  ["ledger", "code"], ["ledger", "post_bkcode"], ["ledger", "doc_date"], ["ledger", "year_id"], ["ledger", "book"],
  ["ledger_ext", "led_id"], ["ledger_ext", "il_id"], ["ledger_ext", "tax_id"], ["ledger_ext", "slab_id"],
  ["ledger_post", "led_id"], ["ledger_post", "post_code"],
  ["ac_balance", "code"], ["account", "code"],
  ["prod_ledger", "prod_id"], ["prod_ledger", "led_id"], ["prod_ledger", "process_id"], ["prod_ledger", "il_date"],
  ["prod_balance", "prod_id"],
  ["outclear", "out_ledid"], ["outclear", "code"], ["outclear", "out_ag_outid"], ["outclear", "out_fulldocno"],
  ["addon_ientry", "aoni_il_id"], ["addon_aentry", "aona_ledid"], ["addon_data", "prod_id"], ["addon_data", "code"],
  ["process", "process_key"], ["tax_master", "tax_rec"], ["slab_master", "slab_key"],
];

export async function ensureIndexes(ctx: RepostContext, tables: ReadonlySet<string>): Promise<void> {
  const have = await rows<{ table_name: string; column_name: string }>(ctx, "Columns for the indexes",
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[])", [ctx.sch, [...tables]]);
  const present = new Set(have.map((row) => `${row.table_name}.${row.column_name}`));
  ctx.log("Indexes");
  const existing = new Set((await rows<{ indexname: string }>(ctx, "Existing indexes", "SELECT indexname FROM pg_indexes WHERE schemaname = $1", [ctx.sch])).map((row) => row.indexname));
  const made = new Set<string>();
  for (const [table, column] of WANTED) {
    const name = `rp_${table}_${column}`;
    if (!tables.has(table) || !present.has(`${table}.${column}`) || existing.has(name)) continue;
    await run(ctx, `Index of ${table}.${column}`, `CREATE INDEX ${name} ON ${ctx.sch}.${table} (${column})`);
    made.add(table);
  }
  // Statistics only of the tables that got a new index (a whole-database ANALYZE took 20 to 30 seconds).
  for (const table of made) await run(ctx, `Statistics of ${table}`, `ANALYZE ${ctx.sch}.${table}`);
}
