import type { TransferContext } from "./context";
import { addonEntryColumns, insertRows, q, same } from "./context";

const ORDER_MODULES = "'ORD-OUT', 'ORD-IN'";
const ALL_ORDER_MODULES = "'ORD-OUT', 'ORD-IN', 'IND-PURCH', 'QTN-PURCH'";
const JOB_MODULES = "'JOB-IN', 'JOB-OUT'";
const JOB_LINES = "((trn_module = 'JOB-IN' AND (trn_stkmid = 'LJ' OR trn_stkmid = 'JI')) OR (trn_module = 'JOB-OUT' AND trn_stkmid = 'JO'))";

const PROD_LEDGER_COLUMNS = ["il_serial", "doc_no1", "prod_id", "il_prodcd", "il_billdesc", "quantity", "rate", "master_rate", "il_value", "book", "book_code", "rateuom_id", "uomentry_id", "type", "il_date", "stock_nat", "code", "il_pos", "il_div", "full_docno", "order_no", "slab_cost", "cost_rate", "inventory", "stock_type", "factor", "trn_qty1", "trn_qty2", "trn_qty3", "trn_pcs", "trn_pack", "trn_weight", "trn_module", "trn_stkmid", "ag_qty", "ag_fact"];

/** SP_TRANSFER_DATA, @bit_pendorder = 1: the pending orders (and indents, quotations, job work) of last year with the quantity still to be supplied are carried over, with their lines, taxes and addon entries. */
export async function transferPendingOrders(ctx: TransferContext): Promise<void> {
  const { sch: s, o, t1, licence } = ctx;
  const y = ctx.yearId;
  ctx.log("Pending orders");
  const aentry = await addonEntryColumns(ctx, "L", "A");
  const ientry = await addonEntryColumns(ctx, "P", "P");
  const processOf = (alias: string, modules: string) => `(SELECT process_key FROM ${s}.process WHERE trf_processkey = ${alias}.process_id AND stk_module IN (${modules}) AND il_pos = 'A' LIMIT 1)`;
  const stamp = (name: string): [string, string][] => name === "date" ? [["last_savedate", "current_date"]] : [["last_savetime", "to_char(now(), 'HH24:MI:SS')"]];

  // The orders already carried over last time that no bill refers to are taken out first, so they come again from last year as they now stand.
  const deadProcess = `SELECT coalesce(process_key, 0) FROM ${s}.process WHERE il_pos = 'D' AND stk_module IN (${ALL_ORDER_MODULES})`;
  await q(ctx, "Orders no bill refers to", `UPDATE ${s}.process SET il_pos = 'D' WHERE stk_module IN (${ALL_ORDER_MODULES}) AND coalesce(trf_processkey, 0) > 0 AND coalesce(process_key, 0) NOT IN (SELECT coalesce(led_rec1, 0) FROM ${s}.prod_link)`);
  await q(ctx, "Lines of those orders", `UPDATE ${s}.prod_ledger SET il_pos = 'D' WHERE trn_module IN (${ALL_ORDER_MODULES}) AND coalesce(trf_ilkey, 0) > 0 AND coalesce(process_id, 0) IN (${deadProcess})`);
  await q(ctx, "Addon entries of those orders", `DELETE FROM ${s}.addon_aentry WHERE coalesce(aona_processid, 0) IN (${deadProcess})`);
  await q(ctx, "Addon line entries of those orders", `DELETE FROM ${s}.addon_ientry WHERE coalesce(aoni_processid, 0) IN (${deadProcess})`);
  await q(ctx, "Taxes of those orders", `DELETE FROM ${s}.ledger_ext WHERE coalesce(process_id, 0) IN (${deadProcess})`);
  await q(ctx, "Those orders deleted", `DELETE FROM ${s}.process WHERE il_pos = 'D' AND stk_module IN (${ALL_ORDER_MODULES}) AND coalesce(trf_processkey, 0) > 0`);
  await q(ctx, "Lines of those orders deleted", `DELETE FROM ${s}.prod_ledger WHERE il_pos = 'D' AND trn_module IN (${ALL_ORDER_MODULES}) AND coalesce(trf_ilkey, 0) > 0`);

  await insertRows(ctx, "Orders of last year", "process",
    [...same("fp", ["stk_module", "doc_no2", "book", "p_date", "post_date", "code", "il_pos", "p_docseries", "full_docno", "p_bkdbcode", "p_amount", "entry_for", "stk_remark", "entry_no"]), ["year_id", `'${y}'`],
      ...same("fp", ["ent_approve", "ent_address_id", "eway_billno", "eway_billdate", "eway_valid", "supply_type", "sub_supply_type", "eway_doc_type", "trp_mode", "distance_km", "eway_veh_type"]), ["trf_processkey", "fp.process_key"], ["user_id", "fp.user_id"], ...stamp("date"), ...stamp("time")],
    `FROM ${o}.process fp WHERE fp.stk_module IN (${ORDER_MODULES}) AND fp.il_pos = 'A' AND fp.process_key IN (SELECT process_id FROM ${o}.prod_ledger WHERE il_pos = 'A' AND trn_module IN (${ALL_ORDER_MODULES}) AND quantity - (ag_qty + coalesce(setof_qty, 0)) > 0)`
    + ` AND coalesce(fp.process_key, 0) NOT IN (SELECT coalesce(trf_processkey, 0) FROM ${s}.process WHERE il_pos = 'A' AND stk_module IN (${ORDER_MODULES}))`, { alias: "fp", table: "process" });

  await insertRows(ctx, "Order lines of last year", "prod_ledger",
    [...same("prodled", PROD_LEDGER_COLUMNS), ["process_id", processOf("prodled", ALL_ORDER_MODULES)], ...same("prodled", ["ag_pack", "loose_qty"]), ["year_id", `'${y}'`], ["trf_ilkey", "prodled.il_key"], ...same("prodled", ["pack_qty", "bundle"]), ...(licence === 21 ? [["act_value", "prodled.ag_qty"] as [string, string]] : [])],
    `FROM ${o}.prod_ledger prodled WHERE prodled.trn_module IN (${ORDER_MODULES}) AND prodled.il_pos = 'A' AND prodled.quantity - (prodled.ag_qty + coalesce(prodled.setof_qty, 0)) > 0`
    + ` AND coalesce(prodled.il_key, 0) NOT IN (SELECT coalesce(trf_ilkey, 0) FROM ${s}.prod_ledger WHERE il_pos = 'A' AND trn_module IN (${ORDER_MODULES}))`, { alias: "prodled", table: "prod_ledger" });

  await renumber(ctx, `trn_module IN (${ORDER_MODULES})`);

  const ledgerExt = ["slab_id", "slab_amt", "tax_id", "s_lastot", "form_recd", "slab_perc"];
  await insertRows(ctx, "Order line taxes of last year", "ledger_ext",
    [["il_id", "prodled.il_key"], ...same("ledext", ledgerExt), ["process_id", "proce.process_key"], ["year_id", `'${y}'`], ["trf_ledextkey", "ledext.ledext_key"]],
    `FROM ${o}.ledger_ext ledext LEFT JOIN ${s}.process proce ON proce.trf_processkey = ledext.process_id LEFT JOIN ${s}.prod_ledger prodled ON prodled.trf_ilkey = ledext.il_id WHERE ledext.il_id IS NOT NULL AND proce.stk_module IN (${ORDER_MODULES}) AND proce.il_pos = 'A'`
    + ` AND prodled.trn_module IN (${ORDER_MODULES}) AND prodled.il_pos = 'A' AND coalesce(ledext.ledext_key, 0) NOT IN (SELECT coalesce(trf_ledextkey, 0) FROM ${s}.ledger_ext)`, { alias: "ledext", table: "ledger_ext" });
  await insertRows(ctx, "Order taxes of last year", "ledger_ext",
    [["il_id", "ledext.il_id"], ...same("ledext", ledgerExt), ["process_id", "proce.process_key"], ["year_id", `'${y}'`], ["trf_ledextkey", "ledext.ledext_key"]],
    `FROM ${o}.ledger_ext ledext LEFT JOIN ${s}.process proce ON proce.trf_processkey = ledext.process_id WHERE ledext.il_id IS NULL AND proce.stk_module IN (${ORDER_MODULES}) AND proce.il_pos = 'A' AND coalesce(ledext.ledext_key, 0) NOT IN (SELECT coalesce(trf_ledextkey, 0) FROM ${s}.ledger_ext)`, { alias: "ledext", table: "ledger_ext" });

  if (aentry.length > 0) {
    await insertRows(ctx, "Order addon entries of last year", "addon_aentry",
      [["aona_accode", "aent.aona_accode"], ["aona_processid", "proce.process_key"], ["aona_recid", "'P'"], ["trf_aonakey", "aent.aona_key"], ...same("aent", aentry)],
      `FROM ${o}.addon_aentry aent LEFT JOIN ${s}.process proce ON proce.trf_processkey = aent.aona_processid WHERE proce.stk_module IN (${ORDER_MODULES}) AND proce.il_pos = 'A' AND coalesce(aent.aona_key, 0) NOT IN (SELECT coalesce(trf_aonakey, 0) FROM ${s}.addon_aentry)`, { alias: "aent", table: "addon_aentry" });
  }
  const ientryHead = ["aoni_stknat", "aoni_entry_qty", "aoni_entry_uom", "aoni_entry_fact", "aoni_entry_factuom", "aoni_rep_qty", "aoni_clear_qty", "aoni_rate", "aoni_date"];
  if (ientry.length > 0) {
    await insertRows(ctx, "Order line addon entries of last year", "addon_ientry",
      [["aoni_processid", "prodled.process_id"], ["aoni_il_id", "prodled.il_key"], ["aoni_prodid", "prodled.prod_id"], ...same("aent", ientryHead), ["trf_aonikey", "aent.aoni_key"], ...same("aent", ientry)],
      `FROM ${o}.addon_ientry aent LEFT JOIN ${s}.prod_ledger prodled ON prodled.trf_ilkey = aent.aoni_il_id WHERE prodled.trn_module IN (${ORDER_MODULES}) AND prodled.il_pos = 'A' AND coalesce(aent.aoni_key, 0) NOT IN (SELECT coalesce(trf_aonikey, 0) FROM ${s}.addon_ientry)`, { alias: "aent", table: "addon_ientry" });
  }

  if (licence === 21) await jobWork(ctx, aentry, ientry, ientryHead, ledgerExt, processOf, stamp);

  if (licence === 17) {
    const day = (alias = "") => `to_char(${alias}p_date, 'DD/MM/YYYY')`;
    await q(ctx, "Order numbers by date", `UPDATE ${s}.process SET doc_no2 = ${day()} || '(' || btrim(doc_no2) || ')', full_docno = 'ODi/' || ${day()} || '(' || btrim(doc_no2) || ')' WHERE p_date < '${t1}' AND stk_module = 'ORD-IN'`);
    await q(ctx, "Order dates", `UPDATE ${s}.process SET p_date = '${t1}' WHERE p_date < '${t1}' AND stk_module = 'ORD-IN'`);
    await q(ctx, "Order line dates", `UPDATE ${s}.prod_ledger SET il_date = '${t1}' WHERE il_date < '${t1}' AND trn_module = 'ORD-IN'`);
    await q(ctx, "Order addon line dates", `UPDATE ${s}.addon_ientry SET aoni_date = '${t1}' WHERE aoni_date < '${t1}' AND aoni_il_id IN (SELECT il_key FROM ${s}.prod_ledger WHERE trn_module = 'ORD-IN' AND il_pos = 'A')`);
    await q(ctx, "Order lines from the orders", `UPDATE ${s}.prod_ledger prodled SET full_docno = proce.full_docno, il_date = proce.p_date FROM ${s}.process proce WHERE proce.process_key = prodled.process_id AND proce.p_date = '${t1}' AND proce.stk_module = 'ORD-IN' AND prodled.trn_module = 'ORD-IN'`);
  }

  if (licence === 21 || licence === 39 || licence === 62) await bomEntries(ctx);
}

/** The lines of the orders (or job work) are numbered again from 1 within each order. */
async function renumber(ctx: TransferContext, where: string): Promise<void> {
  const { sch: s } = ctx;
  await q(ctx, "Order lines numbered", `UPDATE ${s}.prod_ledger pl SET il_serial = r.rnk FROM (SELECT il_key, row_number() OVER (PARTITION BY process_id ORDER BY il_serial, il_key) AS rnk FROM ${s}.prod_ledger WHERE il_pos = 'A' AND ${where} AND trf_ilkey > 0) r WHERE pl.il_key = r.il_key`);
}

/** Licence 21: the open job work (job in / job out) of last year. */
async function jobWork(ctx: TransferContext, aentry: string[], ientry: string[], ientryHead: string[], ledgerExt: string[], processOf: (alias: string, modules: string) => string, stamp: (name: string) => [string, string][]): Promise<void> {
  const { sch: s, o } = ctx;
  const y = ctx.yearId;
  const pending = "(quantity - (ag_qty + cost_rate) > 0 OR (ag_qty = 0 AND quantity < cost_rate))";
  await q(ctx, "Job orders no bill refers to", `UPDATE ${s}.process SET il_pos = 'D' WHERE stk_module IN (${JOB_MODULES}) AND trf_processkey > 0 AND process_key NOT IN (SELECT led_rec1 FROM ${s}.prod_link)`);
  await q(ctx, "Job lines of those orders", `UPDATE ${s}.prod_ledger SET il_pos = 'D' WHERE ${JOB_LINES} AND trf_ilkey > 0 AND coalesce(process_id, 0) IN (SELECT coalesce(process_key, 0) FROM ${s}.process WHERE il_pos = 'D' AND stk_module IN (${JOB_MODULES}))`);
  await q(ctx, "Job addon line entries of those orders", `DELETE FROM ${s}.addon_ientry WHERE aoni_processid IN (SELECT process_key FROM ${s}.process WHERE stk_module IN (${JOB_MODULES}) AND trf_processkey > 0 AND il_pos = 'D')`);
  await q(ctx, "Those job orders deleted", `DELETE FROM ${s}.process WHERE il_pos = 'D' AND stk_module IN (${JOB_MODULES}) AND coalesce(trf_processkey, 0) > 0`);
  await q(ctx, "Job lines of those orders deleted", `DELETE FROM ${s}.prod_ledger WHERE il_pos = 'D' AND ${JOB_LINES} AND coalesce(trf_ilkey, 0) > 0`);

  await insertRows(ctx, "Job orders of last year", "process",
    [...same("fp", ["stk_module", "doc_no2", "book", "p_date", "code", "il_pos", "p_docseries", "full_docno", "p_bkdbcode", "p_amount", "entry_for", "stk_remark", "entry_no"]), ["year_id", `'${y}'`], ["trf_processkey", "fp.process_key"], ["user_id", "fp.user_id"], ...stamp("date"), ...stamp("time"), ["ent_approve", "fp.ent_approve"]],
    `FROM ${o}.process fp WHERE fp.stk_module IN (${JOB_MODULES}) AND fp.il_pos = 'A' AND fp.process_key IN (SELECT process_id FROM ${o}.prod_ledger WHERE il_pos = 'A' AND ${JOB_LINES} AND ${pending})`
    + ` AND coalesce(fp.process_key, 0) NOT IN (SELECT coalesce(trf_processkey, 0) FROM ${s}.process WHERE il_pos = 'A' AND stk_module IN (${JOB_MODULES}))`, { alias: "fp", table: "process" });

  const jobOut = "(prodled.trn_module = 'JOB-OUT' AND (prodled.ag_qty > 0 OR prodled.cost_rate > 0))";
  const remaining = "prodled.quantity - (prodled.ag_qty + prodled.cost_rate)";
  const swap = (column: string) => `CASE WHEN ${jobOut} THEN ${remaining} ELSE prodled.${column} END`;
  await insertRows(ctx, "Job lines of last year", "prod_ledger",
    [...same("prodled", ["il_serial", "doc_no1", "prod_id", "il_prodcd", "il_billdesc"]), ["quantity", swap("quantity")], ...same("prodled", ["rate", "master_rate", "il_value", "book", "book_code", "rateuom_id", "uomentry_id", "type", "il_date", "stock_nat", "code", "il_pos", "il_div", "full_docno", "order_no", "slab_cost"]),
      ["cost_rate", "0"], ...same("prodled", ["inventory", "stock_type"]), ["factor", swap("factor")], ["trn_qty1", swap("trn_qty1")], ["trn_qty2", swap("trn_qty2")], ["trn_qty3", swap("trn_qty3")], ["trn_pcs", swap("trn_pcs")], ["trn_pack", swap("trn_pack")], ["trn_weight", swap("trn_weight")],
      ...same("prodled", ["trn_module", "trn_stkmid"]), ["ag_qty", "0"], ["ag_fact", "0"], ["process_id", processOf("prodled", JOB_MODULES)], ["ag_pack", "prodled.ag_pack"], ["year_id", `'${y}'`], ["trf_ilkey", "prodled.il_key"], ...same("prodled", ["pack_qty", "bundle"])],
    `FROM ${o}.prod_ledger prodled WHERE ${JOB_LINES.replace(/trn_/g, "prodled.trn_")} AND prodled.il_pos = 'A' AND ${pending.replace(/quantity/g, "prodled.quantity").replace(/ag_qty/g, "prodled.ag_qty").replace(/cost_rate/g, "prodled.cost_rate")}`
    + ` AND coalesce(prodled.il_key, 0) NOT IN (SELECT coalesce(trf_ilkey, 0) FROM ${s}.prod_ledger WHERE il_pos = 'A' AND ${JOB_LINES})`, { alias: "prodled", table: "prod_ledger" });

  await renumber(ctx, "trn_module = 'JOB-IN' AND trn_stkmid = 'LJ'");
  await renumber(ctx, "trn_module = 'JOB-OUT' AND trn_stkmid = 'JO'");

  await insertRows(ctx, "Job line taxes of last year", "ledger_ext",
    [["il_id", `(SELECT il_key FROM ${s}.prod_ledger WHERE trf_ilkey = ledext.il_id AND il_pos = 'A' AND trn_module IN ('JOB-OUT', 'JOB-IN') LIMIT 1)`], ...same("ledext", ledgerExt),
      ["process_id", `(SELECT process_key FROM ${s}.process WHERE trf_processkey = ledext.process_id AND stk_module IN ('JOB-OUT', 'JOB-IN') AND il_pos = 'A' LIMIT 1)`], ["year_id", `'${y}'`], ["trf_ledextkey", "ledext.ledext_key"]],
    `FROM ${o}.ledger_ext ledext WHERE ledext.process_id IN (SELECT trf_processkey FROM ${s}.process WHERE stk_module IN ('JOB-OUT', 'JOB-IN') AND il_pos = 'A') AND coalesce(ledext.ledext_key, 0) NOT IN (SELECT coalesce(trf_ledextkey, 0) FROM ${s}.ledger_ext)`, { alias: "ledext", table: "ledger_ext" });

  if (aentry.length > 0) {
    await insertRows(ctx, "Job addon entries of last year", "addon_aentry",
      [["aona_accode", "aent.aona_accode"], ["aona_processid", `(SELECT process_key FROM ${s}.process WHERE trf_processkey = aent.aona_processid AND stk_module IN ('JOB-OUT', 'JOB-IN') AND il_pos = 'A' LIMIT 1)`], ["aona_recid", "'P'"], ["trf_aonakey", "aent.aona_key"], ...same("aent", aentry)],
      `FROM ${o}.addon_aentry aent LEFT JOIN ${o}.process proce ON proce.process_key = aent.aona_processid WHERE proce.stk_module IN ('JOB-OUT', 'JOB-IN') AND aent.aona_processid IN (SELECT trf_processkey FROM ${s}.process WHERE stk_module IN ('JOB-OUT', 'JOB-IN') AND il_pos = 'A')`
      + ` AND coalesce(aent.aona_key, 0) NOT IN (SELECT coalesce(trf_aonakey, 0) FROM ${s}.addon_aentry)`, { alias: "aent", table: "addon_aentry" });
  }
  if (ientry.length > 0) {
    const jobLine = (column: string) => `(SELECT ${column} FROM ${s}.prod_ledger WHERE trf_ilkey = aent.aoni_il_id AND il_pos = 'A' AND trn_module IN ('JOB-OUT', 'JOB-IN') LIMIT 1)`;
    await insertRows(ctx, "Job line addon entries of last year", "addon_ientry",
      [["aoni_processid", jobLine("process_id")], ["aoni_il_id", jobLine("il_key")], ["aoni_prodid", jobLine("prod_id")], ...same("aent", ientryHead), ["trf_aonikey", "aent.aoni_key"], ...same("aent", ientry)],
      `FROM ${o}.addon_ientry aent LEFT JOIN ${o}.prod_ledger prodled ON prodled.il_key = aent.aoni_il_id WHERE prodled.trn_module IN ('JOB-OUT', 'JOB-IN') AND coalesce(aent.aoni_il_id, 0) IN (SELECT coalesce(trf_ilkey, 0) FROM ${s}.prod_ledger WHERE trn_module IN ('JOB-OUT', 'JOB-IN') AND il_pos = 'A')`
      + ` AND coalesce(aent.aoni_key, 0) NOT IN (SELECT coalesce(trf_aonikey, 0) FROM ${s}.addon_ientry)`, { alias: "aent", table: "addon_ientry" });
  }
}

/** Licences 21, 39 and 62: the bill-of-material entries of last year come in dated the first day of this year. */
async function bomEntries(ctx: TransferContext): Promise<void> {
  const { sch: s, o, t1 } = ctx;
  const y = ctx.yearId;
  await insertRows(ctx, "Bill of material entries", "process",
    [...same("imp_process", ["code", "book_code", "stk_module", "doc_no2", "book"]), ["p_date", `'${t1}'`], ...same("imp_process", ["il_pos", "p_docseries", "full_docno", "p_bkdbcode", "p_amount", "delv_days", "delv_date", "entry_for", "stk_remark"]), ["year_id", `'${y}'`],
      ...same("imp_process", ["last_savedate", "last_savetime", "entry_no", "post_date", "ent_approve"]), ["trf_processkey", "imp_process.process_key"]],
    `FROM ${o}.process imp_process WHERE il_pos = 'A' AND stk_module = 'MFG-BOM' AND process_key NOT IN (SELECT imp_prodbal1.process_key FROM ${o}.process imp_prodbal1 LEFT JOIN ${s}.process newpbal ON newpbal.trf_processkey = imp_prodbal1.process_key`
    + ` WHERE imp_prodbal1.il_pos = 'A' AND newpbal.il_pos = 'A' AND coalesce(newpbal.trf_processkey, 0) > 0 AND imp_prodbal1.stk_module = 'MFG-BOM' AND newpbal.stk_module = 'MFG-BOM')`, { alias: "imp_process", table: "process" });

  await insertRows(ctx, "Bill of material lines", "prod_ledger",
    [...same("imp_prodled", ["led_id", "code", "book_code", "il_serial", "doc_no1", "prod_id", "il_prodcd", "il_billdesc", "quantity", "rate", "master_rate", "prate_id", "il_value", "book", "rateuom_id", "uomentry_id", "type"]), ["il_date", `'${t1}'`],
      ...same("imp_prodled", ["stock_nat", "il_pos", "il_div", "full_docno", "order_no", "slab_cost", "cost_rate", "expiry_date", "inventory", "stock_type", "factor", "trn_qty1", "trn_qty2", "trn_qty3", "trn_pcs", "trn_pack", "trn_weight", "trn_module", "trn_stkmid", "trn_freeid", "link_stkmdl", "ag_qty", "ag_fact", "ag_pack"]),
      ["process_id", `(CASE WHEN imp_prodled.process_id IS NULL THEN NULL ELSE (SELECT newprocess.process_key FROM ${s}.process newprocess, ${o}.process oldprocess WHERE oldprocess.il_pos = 'A' AND newprocess.il_pos = 'A' AND oldprocess.process_key = newprocess.trf_processkey AND oldprocess.process_key = imp_prodled.process_id AND newprocess.stk_module = 'MFG-BOM' AND oldprocess.stk_module = 'MFG-BOM' LIMIT 1) END)`],
      ...same("imp_prodled", ["addon_fiel", "addon_id"]), ["year_id", `'${y}'`], ...same("imp_prodled", ["bundle", "pack_qty"]), ["trf_ilkey", "imp_prodled.il_key"]],
    `FROM ${o}.prod_ledger imp_prodled WHERE il_pos = 'A' AND trn_module = 'MFG-BOM' AND il_key NOT IN (SELECT imp_prodled1.il_key FROM ${o}.prod_ledger imp_prodled1 LEFT JOIN ${s}.prod_ledger newpbal ON newpbal.trf_ilkey = imp_prodled1.il_key`
    + ` WHERE imp_prodled1.il_pos = 'A' AND newpbal.il_pos = 'A' AND coalesce(newpbal.trf_ilkey, 0) > 0 AND newpbal.trn_module = 'MFG-BOM' AND imp_prodled1.trn_module = 'MFG-BOM')`, { alias: "imp_prodled", table: "prod_ledger" });
}
