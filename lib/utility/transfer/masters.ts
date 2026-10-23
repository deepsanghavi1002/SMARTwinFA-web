import { rows } from "../repost/context";
import type { TransferContext } from "./context";
import { addonMasterFields, columnsOf, insertRows, q, same } from "./context";

/** The text of an addon field's saved name, as 'a'.'b' pairs in the statements below. */
const textKey = (save: string) => ({ key: `key_${save}`, txt: `txt_${save}` });

/** A key/text pair of every addon master field both years' ADDON_DATA have (at most 25, as the procedure keeps), the key looked up again in this year's ADDON_SUB. */
async function addonPairs(ctx: TransferContext, relate: "A" | "P", alias: string, subPos: boolean): Promise<[string, string][]> {
  const { sch: s } = ctx;
  const mine = await columnsOf(ctx, s, "addon_data");
  const last = await columnsOf(ctx, ctx.o, "addon_data");
  const fields = (await addonMasterFields(ctx, relate)).slice(0, 25);
  const pairs: [string, string][] = [];
  for (const field of fields) {
    const { key, txt } = textKey(field.save);
    if (!mine.has(key) || !mine.has(txt) || !last.has(txt)) continue;
    pairs.push([key, `(SELECT sub_code FROM ${s}.addon_sub WHERE ${subPos ? "sub_pos <> 'D' AND " : ""}sub_name = ${alias}.${txt} AND para_id = ${field.key} LIMIT 1)`]);
    pairs.push([txt, `${alias}.${txt}`]);
  }
  return pairs;
}

/** This year's account (by book and name) that last year's account `ly.code` became. */
export const newAccountOf = (ctx: TransferContext, lyCode: string, extra = "") =>
  `(SELECT newac.code FROM ${ctx.sch}.account newac JOIN ${ctx.o}.account oldac ON newac.book::text || ' ' || newac.name = oldac.book::text || ' ' || oldac.name WHERE oldac.code = ${lyCode} AND newac.a_pos = 'A' AND oldac.a_pos = 'A'${extra} LIMIT 1)`;

/** The last year's accounts that this year's company does not have yet (by book and name), as the codes of last year. */
const missingAccounts = (ctx: TransferContext, pos: string, alreadyIn: string, extra = "") =>
  `(SELECT ly_ac.code FROM ${ctx.sch}.account cy_ac LEFT JOIN ${ctx.o}.account ly_ac ON ly_ac.book::text || ' ' || ly_ac.name = cy_ac.book::text || ' ' || cy_ac.name`
  + ` WHERE ${pos}${extra} AND coalesce(cy_ac.code, 0) NOT IN (SELECT DISTINCT coalesce(code, 0) FROM ${ctx.sch}.${alreadyIn.split("|")[0]} WHERE coalesce(code, 0) > 0${alreadyIn.split("|")[1] ?? ""}))`;

/** @bit_lyaddon / @bit_lyaccount: last year's addon masters (sub masters), and the accounts that are new in last year, with their balances, addresses, assets, interest and addon data. */
export async function copyLastYearMasters(ctx: TransferContext): Promise<void> {
  const { sch: s, o, opt } = ctx;
  const y = ctx.yearId;
  ctx.log("Last year's masters");

  if (opt.lyAddon || opt.lyAccount) {
    const match = "ly_asub.para_id::text || ' ' || ly_asub.sub_name = cy_asub.para_id::text || ' ' || cy_asub.sub_name";
    await insertRows(ctx, "Addon masters of last year", "addon_sub",
      [...same("ly_asub", ["para_id", "sub_name", "address_1", "address_2", "address_3", "city", "pin_code", "tel_no", "std_code", "lst_no", "cst_no", "autho_no", "e_mail", "website", "mobile_no", "pager_no", "contact", "local_code", "add_remark", "fax", "sub_optmast", "sub_idata", "sub_startdt", "sub_lastdt", "sub_relate", "transporter", "district", "short_name", "pan_no", "sub_pos", "last_savedate", "last_savetime"]),
        ["trf_subcode", "ly_asub.sub_code"]],
      `FROM ${o}.addon_sub ly_asub LEFT JOIN ${s}.addon_sub cy_asub ON ${match} WHERE ly_asub.sub_pos <> 'D' AND cy_asub.para_id IS NULL`, { alias: "ly_asub", table: "addon_sub" });

    await insertRows(ctx, "Addon master balances of last year", "sub_balance",
      [["sub_code", `(SELECT newsub.sub_code FROM ${s}.addon_sub newsub JOIN ${o}.addon_sub oldsub ON newsub.para_id::text || ' ' || newsub.sub_name = oldsub.para_id::text || ' ' || oldsub.sub_name WHERE oldsub.sub_code = ly_sbal.sub_code AND oldsub.sub_pos = 'A' AND newsub.sub_pos = 'A' LIMIT 1)`],
        ["sub_yearid", `'${y}'`], ["sub_opening", "ly_sbal.sub_closing"], ["sub_debit", "0"], ["sub_credit", "0"], ["sub_closing", "ly_sbal.sub_closing"],
        ["sub_oqty1", "0"], ["sub_aqty1", "0"], ["sub_lqty1", "0"], ["sub_cqty1", "0"], ["sub_oqty2", "0"], ["sub_aqty2", "0"], ["sub_lqty2", "0"], ["sub_cqty2", "0"],
        ["sub_relate", "ly_sbal.sub_relate"], ["trf_subbalkey", "ly_sbal.subbal_key"]],
      `FROM ${o}.sub_balance ly_sbal WHERE ly_sbal.sub_code IN (SELECT ly_asub.sub_code FROM ${s}.addon_sub cy_asub LEFT JOIN ${o}.addon_sub ly_asub ON ${match}`
      + ` WHERE cy_asub.sub_pos <> 'D' AND ly_asub.sub_pos <> 'D' AND coalesce(cy_asub.sub_code, 0) NOT IN (SELECT coalesce(sub_code, 0) FROM ${s}.sub_balance))`, { alias: "ly_sbal", table: "sub_balance" });
  }

  if (!(opt.lyAccount && ctx.licence !== 3)) return;

  await insertRows(ctx, "Accounts of last year", "account",
    [...same("ly_ac", ["name", "book", "combine", "comb_code", "a_startdate", "a_lastdate", "a_pos", "a_dayclose", "a_posting", "a_mapcode", "a_short", "credit_days", "int_perc", "grace_days", "int_flag", "\"LIMIT\"", "warn_limit", "os_flag", "free_flag", "a_perc", "not2del", "info", "budget_flag", "budget", "budget_perc", "bs_id", "ac_opensty", "ac_nature", "ac_message", "narr_long", "last_savedate", "last_savetime", "exp_flag"]),
      ["trf_code", "ly_ac.code"]],
    `FROM ${o}.account ly_ac LEFT JOIN ${s}.account cy_ac ON ly_ac.book::text || ' ' || ly_ac.name = cy_ac.book::text || ' ' || cy_ac.name`
    + ` WHERE ly_ac.a_pos <> 'D' AND cy_ac.code IS NULL AND ly_ac.book BETWEEN 1 AND 3 AND ly_ac.a_lastdate IS NULL`, { alias: "ly_ac", table: "account" });

  await insertRows(ctx, "Account balances of last year", "ac_balance",
    [["code", newAccountOf(ctx, "ly_acbal.code", " AND ly_acbal.a_recflag = 'AC'")], ["year_id", `'${y}'`], ["a_recflag", "ly_acbal.a_recflag"], ["opening", "ly_acbal.closing"], ["debit", "0"], ["credit", "0"], ["closing", "ly_acbal.closing"], ["last_year", "0"],
      ["os_billdiff", "ly_acbal.os_billdiff"], ["bs_tempfig", "ly_acbal.bs_tempfig"], ["trf_acbalkey", "ly_acbal.acbal_key"]],
    `FROM ${o}.ac_balance ly_acbal WHERE ly_acbal.code IN ${missingAccounts(ctx, "ly_ac.a_pos = 'A' AND cy_ac.a_pos = 'A' AND ly_acbal.a_recflag = 'AC'", "ac_balance| AND a_recflag = 'AC'")}`, { alias: "ly_acbal", table: "ac_balance" });

  await insertRows(ctx, "Addresses of last year", "address",
    [["code", newAccountOf(ctx, "ly_add.code")], ...same("ly_add", ["address_id", "address_1", "address_2", "address_3", "city", "pin_code", "tel_no", "std_code", "telex", "lst_no", "cst_no", "autho_no", "pan_no", "e_mail", "website", "mobile_no", "pager_no", "contact", "designation", "local_code", "add_remark", "fax", "p_reg", "a_pos", "lbt_no", "gst_no", "dlic_no", "dlic_no1", "defa_add"]),
      ["trf_addresskey", "ly_add.address_key"]],
    `FROM ${o}.address ly_add WHERE ly_add.code IN ${missingAccounts(ctx, "ly_ac.a_pos = 'A' AND cy_ac.a_pos = 'A'", "address")}`, { alias: "ly_add", table: "address" });

  await insertRows(ctx, "Assets of last year", "asset_master",
    [["code", newAccountOf(ctx, "ly_asset.code")], ["year_id", `'${y}'`], ["gross_val", "ly_asset.gross_val"], ["cost_val", "ly_asset.cost_val"], ["purch_date", "ly_asset.purch_date"], ["cy_add", "0"], ["cy_less", "0"], ["tot_dep", "0"],
      ["dep_perc", "ly_asset.dep_perc"], ["dep_type", "ly_asset.dep_type"], ["tot_dep1", "0"], ["dep_perc1", "ly_asset.dep_perc1"], ["dep_type1", "ly_asset.dep_type1"], ["trf_assetkey", "ly_asset.asset_key"]],
    `FROM ${o}.asset_master ly_asset WHERE ly_asset.code IN ${missingAccounts(ctx, "ly_ac.a_pos = 'A' AND cy_ac.a_pos = 'A'", "asset_master")}`, { alias: "ly_asset", table: "asset_master" });

  await insertRows(ctx, "Interest masters of last year", "int_master",
    [["code", newAccountOf(ctx, "ly_int.code", " AND ly_int.int_recflag = 'AC'")], ["year_id", `'${y}'`], ["int_recflag", "ly_int.int_recflag"], ["last_date", "ly_int.last_date"], ["int_rperc", "ly_int.int_rperc"], ["int_pperc", "ly_int.int_pperc"],
      ["int_rround", "ly_int.int_rround"], ["int_pround", "ly_int.int_pround"], ["ly_loan", "0"], ["ly_int", "0"], ["ly_intdate", "NULL"], ["tds_req", "ly_int.tds_req"], ["tds_rate", "ly_int.tds_rate"], ["tds_round", "ly_int.tds_round"],
      ["tds_circle", "ly_int.tds_circle"], ["tds_cert", "ly_int.tds_cert"], ["tds_limit", "ly_int.tds_limit"], ["days_base", "ly_int.days_base"], ["trf_interestkey", "ly_int.interest_key"]],
    `FROM ${o}.int_master ly_int WHERE ly_int.code IN ${missingAccounts(ctx, "ly_ac.a_pos <> 'D' AND cy_ac.a_pos <> 'D'", "int_master")}`, { alias: "ly_int", table: "int_master" });

  await insertRows(ctx, "Addon data of the accounts of last year", "addon_data",
    [["code", newAccountOf(ctx, "ly_addon.code")], ["prod_id", "NULL"], ...(await addonPairs(ctx, "A", "ly_addon", false)), ["trf_aonkey", "ly_addon.aon_key"]],
    `FROM ${o}.addon_data ly_addon WHERE ly_addon.code IN ${missingAccounts(ctx, "ly_ac.a_pos = 'A' AND cy_ac.a_pos = 'A'", "addon_data")}`);
}

/** @bit_lyproduct: the products that are new in last year, with their balance rows, levels and addon data. */
export async function copyLastYearProducts(ctx: TransferContext): Promise<void> {
  const { sch: s, o } = ctx;
  ctx.log("Last year's products");
  const before = Number((await rows<{ top: string | null }>(ctx, "Last product key", `SELECT max(prod_key) AS top FROM ${s}.product_master`))[0]?.top ?? 0);

  await insertRows(ctx, "Products of last year", "product_master",
    [...same("trf_prodmst", ["prod_short", "post_short", "prod_desc", "bill_desc", "base_qty1", "base_qty2", "base_qty3", "base_pcs", "base_pack", "base_weight", "open_stk", "open_uom", "open_pcs", "open_pack", "open_weight", "open_qty1", "open_qty2", "open_qty3", "open_rate", "pcs_uom", "pack_uom", "weight_uom", "qty1_uom", "qty2_uom", "qty3_uom", "rep1_uom", "rep2_uom", "rep3_uom", "min_qty", "minuom_id", "max_qty", "maxuom_id", "icode_type", "inventory", "recduom_id", "issuuom_id", "prod_group", "level_1", "level_2", "level_3", "level_4", "level_5", "level_6", "level_7", "level_8", "level_9", "desc_1", "desc_2", "desc_3", "desc_4", "desc_5", "desc_6", "desc_7", "desc_8", "desc_9", "p_code", "s_code", "iflag_tax", "value_calc", "round_up", "iflag_free", "ivltype", "prod_map", "prod_info", "iflag_dis", "start_date", "last_date", "prod_pos", "lead_days", "re_order", "re_orderuom", "reserve_stk", "reserve_uom", "prod_photo", "rep_rate", "rep_uom", "vat_code", "factor_calc", "last_savedate", "last_savetime", "parent_id", "recdrateuom_id", "issurateuom_id", "rep_uom3", "prod_for", "value_formula"]),
      ["trf_prodkey", "trf_prodmst.prod_key"], ...same("trf_prodmst", ["hsn_code", "tax_perc", "tax_type"])],
    `FROM ${o}.product_master trf_prodmst WHERE trf_prodmst.prod_pos <> 'D' AND trf_prodmst.last_date IS NULL AND trf_prodmst.prod_short NOT IN (SELECT prod_short FROM ${s}.product_master WHERE prod_pos <> 'D')`, { alias: "trf_prodmst", table: "product_master" });

  // The balance rows of each new product (the procedure goes product by product; this is the same rows in one statement).
  await insertRows(ctx, "Balances of the new products", "prod_balance", prodBalancePairs(ctx, "newprod.prod_key", true),
    `FROM ${s}.product_master newprod JOIN ${o}.prod_balance trf_prodbal ON trf_prodbal.p_short = newprod.prod_short WHERE newprod.prod_key > ${before}`, { alias: "trf_prodbal", table: "prod_balance" });

  await insertRows(ctx, "Levels of last year", "level_desc",
    [...same("trf_lvldesc", ["level_no", "level_code", "level_name", "level_short", "level_desc"]), ["trf_levelkey", "trf_lvldesc.level_key"]],
    `FROM ${o}.level_desc trf_lvldesc LEFT JOIN ${s}.level_desc cy_lvldesc ON trf_lvldesc.level_no::text || ' ' || trf_lvldesc.level_code = cy_lvldesc.level_no::text || ' ' || cy_lvldesc.level_code WHERE cy_lvldesc.level_code IS NULL`, { alias: "trf_lvldesc", table: "level_desc" });

  await insertRows(ctx, "Addon data of the products of last year", "addon_data",
    [["code", "NULL"], ["prod_id", `(SELECT newprod.prod_key FROM ${s}.product_master newprod JOIN ${o}.product_master oldprod ON newprod.prod_short = oldprod.prod_short WHERE oldprod.prod_pos <> 'D' AND newprod.prod_pos <> 'D' AND oldprod.prod_key = imp_addon.prod_id LIMIT 1)`],
      ...(await addonPairs(ctx, "P", "imp_addon", true)), ["trf_aonkey", "imp_addon.aon_key"]],
    `FROM ${o}.addon_data imp_addon WHERE imp_addon.prod_id IN (SELECT imp_prod.prod_key FROM ${s}.product_master cy_prod LEFT JOIN ${o}.product_master imp_prod ON imp_prod.prod_short = cy_prod.prod_short`
    + ` WHERE imp_prod.prod_pos <> 'D' AND cy_prod.prod_pos <> 'D' AND cy_prod.prod_key NOT IN (SELECT DISTINCT coalesce(prod_id, 0) FROM ${s}.addon_data WHERE coalesce(prod_id, 0) > 0))`);
}

/**
 * The columns of a PROD_BALANCE row opened from last year's row `trf_prodbal`: its closing becomes the opening, the receipts and issues start at zero.
 * `withMasterKeys` keeps the master fields (new products); the other transfer leaves them empty.
 */
export function prodBalancePairs(ctx: TransferContext, prodId: string, withMasterKeys: boolean): [string, string][] {
  const t = "trf_prodbal";
  const zero = (names: string[]): [string, string][] => names.map((name) => [name, "0"]);
  return [
    ["p_short", `${t}.p_short`], ["year_id", `'${ctx.yearId}'`], ["prec_flag", `${t}.prec_flag`], ["prod_id", prodId], ["p_rate", `coalesce(${t}.p_rate, 0)`],
    ["i_mastfld", withMasterKeys ? `${t}.i_mastfld` : "NULL"], ["i_mastcd", withMasterKeys ? `${t}.i_mastcd` : "NULL"], ["i_paracd", withMasterKeys ? `${t}.i_paracd` : "NULL"],
    ["open_qty1", `${t}.clsg_qty1`], ["open_qty2", `${t}.clsg_qty2`], ["open_qty3", `${t}.clsg_qty3`], ["open_pcs", `${t}.clsg_pcs`], ["open_pack", `${t}.clsg_pack`], ["open_weight", `${t}.clsg_weight`], ["open_rate", `${t}.open_rate`],
    ...zero(["add_qty1", "add_qty2", "add_qty3", "add_pcs", "add_pack", "add_weight", "less_qty1", "less_qty2", "less_qty3", "less_pcs", "less_pack", "less_weight"]),
    ["clsg_qty1", `${t}.clsg_qty1`], ["clsg_qty2", `${t}.clsg_qty2`], ["clsg_qty3", `${t}.clsg_qty3`], ["clsg_pcs", `${t}.clsg_pcs`], ["clsg_pack", `${t}.clsg_pack`], ["clsg_weight", `${t}.clsg_weight`],
    ...same(t, ["pcs_uom", "pack_uom", "weight_uom", "iqty1_uom", "iqty2_uom", "iqty3_uom", "open_uom"]), ["open_stk", `${t}.clsg_pcs`],
    ...same(t, ["p_level1", "p_level2", "p_level3", "p_level4", "p_level5", "p_level6", "p_level7", "p_level8", "p_level9", "p_optioncd", "rep_uom", "rep_rate"]), ["trf_prodbalkey", `${t}.prodbal_key`],
  ];
}

/** The old SQL Server procedure kept the pending entries of a pre-2015 conversion in LED_DIV / AC_DIV / DOC_THROUGH; they are moved to the TRF_ keys once, if this database still has those columns. */
export async function oldDivisionKeys(ctx: TransferContext): Promise<void> {
  const { sch: s } = ctx;
  const ledger = await columnsOf(ctx, s, "ledger");
  if (!ledger.has("led_div") || !ledger.has("trf_ledkey")) return;
  const count = Number((await rows<{ n: string }>(ctx, "Entries with a division", `SELECT count(*) AS n FROM ${s}.ledger WHERE coalesce(led_div, 0) > 0 AND doc_posting <> 'P'`))[0]?.n ?? 0);
  if (count === 0) return;
  ctx.log("Old division keys");
  await q(ctx, "Division of the entries", `UPDATE ${s}.ledger SET trf_ledkey = led_div WHERE coalesce(led_div, 0) > 0 AND doc_posting <> 'P'`);
  await q(ctx, "Division of the entries cleared", `UPDATE ${s}.ledger SET led_div = NULL WHERE coalesce(led_div, 0) > 0 AND doc_posting <> 'P'`);
  const account = await columnsOf(ctx, s, "account");
  if (account.has("ac_div") && account.has("trf_code")) {
    await q(ctx, "Division of the accounts", `UPDATE ${s}.account SET trf_code = ac_div WHERE coalesce(ac_div, 0) > 0`);
    await q(ctx, "Division of the accounts cleared", `UPDATE ${s}.account SET ac_div = NULL`);
  }
  const sub = await columnsOf(ctx, s, "addon_sub");
  if (sub.has("doc_through") && sub.has("trf_subcode")) {
    await q(ctx, "Through of the addon masters", `UPDATE ${s}.addon_sub SET trf_subcode = doc_through WHERE coalesce(doc_through, 0) > 0`);
    await q(ctx, "Trf code of the addon masters cleared", `UPDATE ${s}.addon_sub SET trf_subcode = NULL`);
  }
}
