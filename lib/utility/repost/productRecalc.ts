import type { RepostContext } from "./context";
import { reseed, rows, run, scalar } from "./context";

/** The columns of PROD_BALANCE a new row is made with, and the values the procedure gives them (the quantities 0, the units and levels of the product). */
export const PROD_BALANCE_COLUMNS = ["p_short", "prod_id", "open_stk", "open_pcs", "open_pack", "open_weight", "open_qty1", "open_qty2", "open_qty3", "open_uom", "pcs_uom", "pack_uom", "weight_uom", "iqty1_uom", "iqty2_uom", "iqty3_uom",
  "clsg_pcs", "clsg_pack", "clsg_weight", "clsg_qty1", "clsg_qty2", "clsg_qty3", "open_rate", "add_pcs", "add_pack", "add_weight", "add_qty1", "add_qty2", "add_qty3", "less_pcs", "less_pack", "less_weight", "less_qty1", "less_qty2", "less_qty3",
  "p_level1", "p_level2", "p_level3", "p_level4", "p_level5", "p_level6", "p_level7", "p_level8", "p_level9", "p_rate", "prec_flag", "year_id"] as const;

/** SP_REPOST_DATA, @bit_productrecalc = 1: the product entry and the product master recalculated (the levels, the balance rows, the entries of deleted vouchers). */
export async function repostProductRecalc(ctx: RepostContext): Promise<void> {
  const { sch: s, yearId: y } = ctx;
  const q = (step: string, sql: string) => run(ctx, step, sql);
  ctx.log("Product entry - conversion recalc");

  const addonField = Number(await scalar(ctx, "Product addon field", `SELECT count(*) FROM ${s}.addon_fld WHERE fiel_relate = 'P' AND fiel_masterpos = 'Y' AND fiel_pos <> 'D' AND fiel_key <> 0`)) > 0;

  await q("Balance rows of the products",
    `INSERT INTO ${s}.prod_balance (${PROD_BALANCE_COLUMNS.join(",")})`
    + ` SELECT product.prod_short, product.prod_key, 0, 0, 0, 0, 0, 0, 0, 0, product.pcs_uom, product.pack_uom, product.weight_uom, product.qty1_uom, product.qty2_uom, product.qty3_uom, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,`
    + ` product.level_1, product.level_2, product.level_3, product.level_4, product.level_5, product.level_6, product.level_7, product.level_8, product.level_9, 0, 'RP', '${y}'`
    + ` FROM ${s}.product_master product WHERE product.prod_pos <> 'D' AND product.inventory = 'Y' AND product.prod_key NOT IN (SELECT coalesce(prod_id, 0) FROM ${s}.prod_balance WHERE prec_flag = 'RP')`);

  if (addonField) {
    await q("Addon rows of the products", `INSERT INTO ${s}.addon_data (prod_id) SELECT product.prod_key FROM ${s}.product_master product WHERE product.prod_pos <> 'D' AND product.prod_key NOT IN (SELECT coalesce(prod_id, 0) FROM ${s}.addon_data)`);
    await q("Addon rows of nothing", `DELETE FROM ${s}.addon_data WHERE coalesce(code, 0) = 0 AND coalesce(prod_id, 0) = 0`);
  }

  await q("Addon of deleted product lines", `DELETE FROM ${s}.addon_ientry WHERE aoni_il_id IN (SELECT il_key FROM ${s}.prod_ledger WHERE il_pos = 'D')`);
  await q("Addon of deleted vouchers", `DELETE FROM ${s}.addon_aentry WHERE aona_ledid IN (SELECT led_key FROM ${s}.ledger WHERE doc_pos = 'D')`);
  await q("Addon of deleted products", `DELETE FROM ${s}.addon_data WHERE prod_id IN (SELECT prod_key FROM ${s}.product_master WHERE prod_pos = 'D')`);
  await q("Balance rows without a product", `DELETE FROM ${s}.prod_balance WHERE prod_id IS NULL`);
  await q("Godown balance rows without a master", `DELETE FROM ${s}.prod_balance WHERE prec_flag = 'GW' AND i_mastcd IS NULL`);
  await q("Balance rows of deleted products", `DELETE FROM ${s}.prod_balance WHERE prod_id IN (SELECT prod_key FROM ${s}.product_master WHERE prod_pos = 'D')`);
  await q("Ledger lines of deleted product lines", `DELETE FROM ${s}.ledger_ext WHERE il_id IN (SELECT il_key FROM ${s}.prod_ledger WHERE il_pos = 'D')`);
  await q("Product lines of processes not found", `UPDATE ${s}.prod_ledger SET il_pos = 'D' WHERE coalesce(process_id, 0) > 0 AND process_id NOT IN (SELECT process_key FROM ${s}.process WHERE il_pos = 'A')`);
  await q("Product lines of deleted processes", `UPDATE ${s}.prod_ledger SET il_pos = 'D' WHERE coalesce(process_id, 0) > 0 AND process_id IN (SELECT process_key FROM ${s}.process WHERE il_pos = 'D')`);
  await q("Less challans", `UPDATE ${s}.prod_ledger SET trn_module = 'SVOU-LESS', trn_stkmid = 'SL' WHERE left(full_docno, 4) = 'Less' AND btrim(trn_module) = 'CHLN-OUT'`);
  await q("Product lines of deleted vouchers", `UPDATE ${s}.prod_ledger SET il_pos = 'D' WHERE led_id IN (SELECT led_key FROM ${s}.ledger WHERE doc_pos = 'D' AND year_id = '${y}')`);

  // The level descriptions again, and the short names of the products from their levels.
  await q("Clear LEVEL_DESC", `DELETE FROM ${s}.level_desc`);
  await reseed(ctx, "level_desc");
  const levelNoIsText = !["integer", "smallint", "bigint", "numeric"].includes(String(await scalar(ctx, "LEVEL_NO type", "SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'level_desc' AND column_name = 'level_no'", [ctx.sch])));
  const levelNo = (n: number) => (levelNoIsText ? `'${n}'` : `${n}`);
  const joined = (prefix: string, upto: number, separator: string) => Array.from({ length: upto }, (_, at) => `coalesce(${prefix}${prefix === "p_level" ? "" : "_"}${at + 1}, '')`).join(` || '${separator}' || `);
  const levels = (await rows<{ div_maxlvl: number }>(ctx, "Levels", `SELECT div_maxlvl FROM ${s}.level_master WHERE level_pos = 'A' ORDER BY div_maxlvl`)).map((row) => Number(row.div_maxlvl));
  for (const n of levels) {
    if (n < 1 || n > 8) continue;
    const code = joined("level", n, "/");
    const desc = joined("desc", n, " ");
    // The procedure's own text for level 3 tests LEVEL_2 for blank, where every other level tests the next one; the next one is meant.
    await q(`Short names of the products, level ${n}`,
      `UPDATE ${s}.product_master SET prod_short = ${code}, post_short = ${code}, prod_desc = ${desc}, bill_desc = ${desc}, prod_map = ${code} WHERE coalesce(level_${n}, '') <> '' AND coalesce(level_${n + 1}, '') = ''`);
    await q(`Short names of the balance rows, level ${n}`,
      `UPDATE ${s}.prod_balance SET p_short = ${joined("p_level", n, "/")} WHERE coalesce(p_level${n}, '') <> '' AND coalesce(p_level${n + 1}, '') = ''`);
    for (let at = 1; at <= n; at += 1) {
      await q(`Level ${at} descriptions`,
        `INSERT INTO ${s}.level_desc (level_no, level_code, level_name, level_short, level_desc) SELECT DISTINCT ${levelNo(at)}, level_${at}, desc_${at}, level_${at}, desc_${at} FROM ${s}.product_master`
        + ` WHERE prod_pos <> 'D' AND coalesce(level_${at}, '') <> '' AND coalesce(desc_${at}, '') <> '' AND coalesce(level_${at}, '') NOT IN (SELECT level_code FROM ${s}.level_desc WHERE level_no::text = '${at}')`);
    }
  }

  // The godowns: one balance row for each godown of each product.
  const godown = Number(await scalar(ctx, "Godown field", `SELECT count(*) FROM ${s}.addon_fld WHERE fiel_err = 'GODOWN,' AND fiel_pos <> 'D' AND fiel_key <> 0`)) > 0;
  if (godown) {
    await q("Duplicate godown balance rows",
      `DELETE FROM ${s}.prod_balance WHERE prec_flag = 'GW' AND coalesce(i_paracd::text, '') <> '' AND prodbal_key IN (SELECT prodbal_key FROM (SELECT prodbal_key, row_number() OVER (PARTITION BY prod_id, i_paracd ORDER BY prodbal_key) AS n FROM ${s}.prod_balance WHERE prec_flag = 'GW' AND coalesce(i_paracd::text, '') <> '') x WHERE n > 1)`);
    await q("Short names of godown rows", `UPDATE ${s}.prod_balance SET p_short = p_level1 WHERE coalesce(p_short, '') = ''`);
    const godowns = await rows<{ sub_code: number; para_id: number }>(ctx, "Godowns",
      `SELECT asub.sub_code, asub.para_id FROM ${s}.addon_sub asub LEFT JOIN ${s}.addon_fld adfld ON adfld.fiel_key = asub.para_id WHERE adfld.fiel_err = 'GODOWN,' AND asub.sub_pos = 'A' ORDER BY adfld.fiel_key`);
    for (const { sub_code, para_id } of godowns) {
      const names = PROD_BALANCE_COLUMNS.slice();
      const values = names.map((name) => {
        if (["p_short", "prod_id", "pcs_uom", "pack_uom", "weight_uom", "iqty1_uom", "iqty2_uom", "iqty3_uom", "p_rate"].includes(name) || name.startsWith("p_level")) return `prodbal.${name}`;
        if (name === "prec_flag") return "'GW'";
        if (name === "year_id") return `'${y}'`;
        return "0";
      });
      // i_mastcd and i_paracd follow prod_id in the procedure's column list.
      const columns = [...names.slice(0, 2), "i_mastcd", "i_paracd", ...names.slice(2)];
      const selects = [...values.slice(0, 2), `${Number(para_id)}`, `${Number(sub_code)}`, ...values.slice(2)];
      await q(`Godown balance rows ${sub_code}`,
        `INSERT INTO ${s}.prod_balance (${columns.join(",")}) SELECT ${selects.join(", ")} FROM ${s}.product_master product LEFT JOIN ${s}.prod_balance prodbal ON prodbal.prod_id = product.prod_key`
        + ` WHERE product.prod_pos <> 'D' AND prodbal.prec_flag = 'RP' AND prodbal.year_id = '${y}' AND product.prod_key NOT IN (SELECT coalesce(prod_id, 0) FROM ${s}.prod_balance WHERE prec_flag = 'GW' AND i_paracd::text = '${Number(sub_code)}' AND year_id = '${y}')`);
    }
  }
}
