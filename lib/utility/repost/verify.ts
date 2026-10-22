import type { RepostContext } from "./context";
import { rows, run } from "./context";

/** The indexes the procedure makes sure of before it checks the data (it builds them where they are missing and rebuilds them). */
const INDEXES: readonly (readonly [table: string, index: string, column: string])[] = [
  ["product_master", "idx_prodmas_prod_key", "prod_key"],
  ["prod_balance", "idx_prodbal_prod_id", "prod_id"],
  ["prod_balance", "idx_prodbal_prec_flag", "prec_flag"],
  ["account", "idx_ac_code", "code"],
  ["ac_balance", "idx_acbal_code", "code"],
  ["addon_data", "idx_addon_prod_id", "prod_id"],
  ["addon_data", "idx_addon_ac_code", "code"],
  ["ledger", "idx_led_code", "code"],
  ["ledger_post", "idx_ledpost_code", "post_code"],
  // The procedure's second LEDGER_POST index is named for LED_ID and made on POST_CODE; it is made on LED_ID here, as its name says.
  ["ledger_post", "idx_ledpost_led_id", "led_id"],
];

/** The addon fields of one kind of record, whose saved text and key are made to agree: `table` the addon table, `fields` the where of the ADDON_FLD rows that belong to it. */
const ADDON_TABLES = [
  { table: "addon_aentry", alias: "aentry", fields: "fiel_pos = 'A' AND fiel_relate = 'A' AND fiel_type = 'M' AND fiel_entrypos = 'L'" },
  { table: "addon_ientry", alias: "ientry", fields: "fiel_pos = 'A' AND fiel_relate = 'P' AND fiel_type = 'M' AND fiel_entrypos = 'P'" },
  { table: "addon_data", alias: "adata", fields: "fiel_pos = 'A' AND fiel_masterpos = 'Y' AND fiel_type = 'M' AND (fiel_err <> 'GODOWN,' OR coalesce(fiel_err, '') = '')" },
] as const;

/** SP_REPOST_DATA, @bit_verifydata = 1: the indexes made sure of and rebuilt, and the saved text and key of each addon field made to agree (at most 25 fields of each kind). */
export async function repostVerify(ctx: RepostContext): Promise<void> {
  const { sch: s } = ctx;
  ctx.log("Verify data");

  for (const [table, index, column] of INDEXES) {
    await run(ctx, `Index ${index}`, `CREATE INDEX IF NOT EXISTS ${index} ON ${s}.${table} (${column})`);
    await run(ctx, `Rebuild ${index}`, `REINDEX INDEX ${s}.${index}`);
  }
  // The procedure rebuilds every index of the tables it names (ALTER INDEX ALL).
  for (const table of ["prod_balance", "addon_data", "ledger_post"]) await run(ctx, `Rebuild ${table}`, `REINDEX TABLE ${s}.${table}`);

  for (const { table, alias, fields } of ADDON_TABLES) {
    const found = await rows<{ fiel_key: number; fiel_save: string }>(ctx, `Addon fields of ${table}`, `SELECT fiel_key, fiel_save FROM ${s}.addon_fld WHERE ${fields} ORDER BY fiel_serial`);
    for (const { fiel_key, fiel_save } of found.slice(0, 25)) {
      if (!/^[A-Za-z0-9_]+$/.test(String(fiel_save).trim())) continue;
      const text = `txt_${String(fiel_save).trim()}`;
      const key = `key_${String(fiel_save).trim()}`;
      // The key from the text, then the text from the key (of the sub master of the field that is not deleted).
      await run(ctx, `Key of ${text} in ${table}`,
        `UPDATE ${s}.${table} ${alias} SET ${key} = asub.sub_code FROM ${s}.addon_sub asub WHERE asub.sub_pos <> 'D' AND asub.sub_name = ${alias}.${text} AND asub.para_id = ${Number(fiel_key)}`);
      await run(ctx, `Text of ${text} in ${table}`,
        `UPDATE ${s}.${table} ${alias} SET ${text} = asub.sub_name FROM ${s}.addon_sub asub WHERE asub.sub_pos <> 'D' AND asub.sub_code = ${alias}.${key} AND asub.para_id = ${Number(fiel_key)}`);
    }
  }
}
