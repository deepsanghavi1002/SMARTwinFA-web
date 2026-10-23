import type { TransferContext } from "./context";
import { insertRows, q } from "./context";
import { prodBalancePairs } from "./masters";

/** SP_TRANSFER_DATA, @bit_product = 1: the products' opening quantities (and rate) from last year's closing. */
export async function transferProducts(ctx: TransferContext): Promise<void> {
  const { sch: s, o, opt } = ctx;
  const y = ctx.yearId;
  ctx.log("Product opening");

  if (!opt.lyProduct) {
    // A balance row last year has and this year has not yet (RP: a product, GW: a product in a godown).
    await insertRows(ctx, "Product balances (RP)", "prod_balance",
      prodBalancePairs(ctx, `(SELECT newprod.prod_key FROM ${s}.product_master newprod JOIN ${o}.product_master oldprod ON newprod.prod_short = oldprod.prod_short WHERE oldprod.prod_key = trf_prodbal.prod_id AND trf_prodbal.prec_flag = 'RP' AND newprod.prod_pos <> 'D' AND oldprod.prod_pos <> 'D' LIMIT 1)`, false),
      `FROM ${o}.prod_balance trf_prodbal WHERE trf_prodbal.prec_flag = 'RP' AND trf_prodbal.p_short IN (SELECT trf_prodmst.prod_short FROM ${s}.product_master cy_prodmst LEFT JOIN ${o}.product_master trf_prodmst ON trf_prodmst.prod_short = cy_prodmst.prod_short`
      + ` WHERE cy_prodmst.prod_pos <> 'D' AND trf_prodmst.prod_pos <> 'D' AND cy_prodmst.prod_key NOT IN (SELECT DISTINCT prod_id FROM ${s}.prod_balance WHERE coalesce(prod_id, 0) > 0 AND prec_flag = 'RP'))`, { alias: "trf_prodbal", table: "prod_balance" });
    await insertRows(ctx, "Product balances (GW)", "prod_balance",
      prodBalancePairs(ctx, `(SELECT newprod.prod_key FROM ${s}.product_master newprod JOIN ${o}.product_master oldprod ON newprod.prod_short = oldprod.prod_short WHERE oldprod.prod_key = trf_prodbal.prod_id AND trf_prodbal.prec_flag = 'GW' AND newprod.prod_pos <> 'D' AND oldprod.prod_pos <> 'D' LIMIT 1)`, false),
      `FROM ${o}.prod_balance trf_prodbal LEFT JOIN ${s}.prod_balance cy_prodbal ON trf_prodbal.p_short || trf_prodbal.i_paracd::text = cy_prodbal.p_short || cy_prodbal.i_paracd::text WHERE trf_prodbal.prec_flag = 'GW' AND cy_prodbal.p_short IS NULL AND cy_prodbal.i_paracd IS NULL`, { alias: "trf_prodbal", table: "prod_balance" });
  }

  const zeroOpening = "open_pcs = 0, open_pack = 0, open_weight = 0, open_qty1 = 0, open_qty2 = 0, open_qty3 = 0, trf_open_pcs = 0";
  if (!opt.ignoreProductManual) await q(ctx, "Product opening cleared", `UPDATE ${s}.prod_balance SET ${zeroOpening} WHERE prec_flag <> 'PK' AND open_pcs = coalesce(trf_open_pcs, 0)`);
  else await q(ctx, "Product opening cleared, manual too", `UPDATE ${s}.prod_balance SET ${zeroOpening} WHERE prec_flag <> 'PK'`);

  // Last year's closing is the opening of the balance row of the same product (RP) or product in the same godown (GW).
  for (const flag of ["RP", "GW"] as const) {
    const lastYear = flag === "RP"
      ? "prodmas1.prod_key = p1.prod_id AND p1.prec_flag = 'RP'"
      : "prodmas1.prod_key = p1.prod_id AND tb.i_paracd = p1.i_paracd AND p1.prec_flag = 'GW'";
    const manual = opt.ignoreProductManual ? "" : " AND tb.open_pcs = coalesce(tb.trf_open_pcs, 0)";
    await q(ctx, `Product opening (${flag})`,
      `WITH src AS (SELECT tb.prodbal_key AS pk, p1.clsg_pcs, p1.clsg_pack, p1.clsg_weight, p1.clsg_qty1, p1.clsg_qty2, p1.clsg_qty3, coalesce(p1.p_rate, 0) AS p_rate,`
      + ` (CASE WHEN coalesce(p1.p_rate, 0) > 0 THEN coalesce(p1.p_rate, 0) WHEN p1.rep_rate > 0 THEN p1.rep_rate ELSE p1.open_rate END) AS open_rate`
      + ` FROM ${s}.prod_balance tb JOIN ${s}.product_master prodmas ON prodmas.prod_key = tb.prod_id AND tb.prec_flag = '${flag}' JOIN ${o}.product_master prodmas1 ON prodmas1.prod_short = prodmas.prod_short AND prodmas1.last_date IS NULL`
      + ` LEFT JOIN ${o}.prod_balance p1 ON ${lastYear} WHERE tb.prec_flag = '${flag}' AND prodmas.prod_pos <> 'D' AND prodmas1.prod_pos <> 'D' AND tb.year_id = '${y}'${manual})`
      + ` UPDATE ${s}.prod_balance prodbal SET trf_open_pcs = src.clsg_pcs, open_pcs = src.clsg_pcs, open_pack = src.clsg_pack, open_weight = src.clsg_weight, open_qty1 = src.clsg_qty1, open_qty2 = src.clsg_qty2, open_qty3 = src.clsg_qty3, open_stk = src.clsg_pcs,`
      + ` p_rate = src.p_rate, open_rate = src.open_rate FROM src WHERE prodbal.prodbal_key = src.pk`);
  }

  for (const column of ["open_pcs", "open_pack", "open_weight", "open_qty1", "open_qty2", "open_qty3"]) {
    await q(ctx, `${column} blank`, `UPDATE ${s}.prod_balance SET ${column} = 0 WHERE ${column} IS NULL AND prec_flag <> 'PK'`);
  }
  await q(ctx, "Product closing", `UPDATE ${s}.prod_balance SET clsg_pcs = open_pcs + add_pcs - less_pcs, clsg_pack = open_pack + add_pack - less_pack, clsg_weight = open_weight + add_weight - less_weight,`
    + ` clsg_qty1 = open_qty1 + add_qty1 - less_qty1, clsg_qty2 = open_qty2 + add_qty2 - less_qty2, clsg_qty3 = open_qty3 + add_qty3 - less_qty3 WHERE (prec_flag = 'RP' OR prec_flag = 'GW' OR prec_flag = 'BT') AND year_id = '${y}'`);
}

/** SP_TRANSFER_DATA, @bit_pendreco = 1: the bank entries (book 6) not yet reconciled last year are carried over, reconciled ones released. */
export async function transferPendingReco(ctx: TransferContext): Promise<void> {
  const { sch: s, o, ly2, t1m1 } = ctx;
  const y = ctx.yearId;
  ctx.log("Pending reconciliation");
  const recoLast = `SELECT coalesce(led_key, 0) FROM ${o}.ledger WHERE book = 6 AND reco_date IS NOT NULL`;
  await q(ctx, "Reconciled entries released", `DELETE FROM ${s}.ledger WHERE book = 6 AND doc_posting = 'R' AND trf_ledkey IN (${recoLast})`);
  await q(ctx, "Reconciliation date of last year", `UPDATE ${s}.ledger SET reco_date = '${ly2}' WHERE book = 6 AND doc_posting = 'L' AND trf_ledkey IN (${recoLast})`);
  await q(ctx, "Deleted entries released", `DELETE FROM ${s}.ledger WHERE book = 6 AND doc_posting = 'R' AND trf_ledkey IN (SELECT coalesce(led_key, 0) FROM ${o}.ledger WHERE book = 6 AND doc_pos = 'D')`);

  const accountOf = (alias: string) => `(SELECT code FROM ${s}.account WHERE name = ${alias}.name AND book = ${alias}.book AND a_pos <> 'D' LIMIT 1)`;
  await insertRows(ctx, "Pending bank entries", "ledger",
    [["code", accountOf("oac")], ["doc_date", "oled.doc_date"], ["doc_no", "oled.doc_no"], ["doc_series", "oled.doc_series"], ["full_docno", "oled.full_docno"], ["doc_no1", "oled.doc_no1"], ["amount", "oled.amount"], ["book_amt", "oled.book_amt"],
      ["bk_dbcode", "oled.bk_dbcode"], ["book", "oled.book"], ["book_code", accountOf("obkac")], ["ac_dbcode", "oled.ac_dbcode"], ["narration", "oled.narration"], ["setoff_amt", "0"], ["chln_date", "NULL"], ["ag_book", "oled.ag_book"],
      ["type", "oled.type"], ["int_type", "oled.int_type"], ["entry_type", "'BR'"], ["post_date", "NULL"], ["post_amt", "0"], ["doc_posting", "'R'"], ["doc_mode", "oled.doc_mode"], ["doc_lock", "oled.doc_lock"], ["doc_pos", "oled.doc_pos"],
      ["prod_amt", "oled.prod_amt"], ["ly_clearamt", "oled.ly_clearamt"], ["doc_remark", "oled.doc_remark"], ["unique_key", "1"], ["stkmdl", "oled.stkmdl"], ["year_id", `'${y}'`], ["entry_sty", "oled.entry_sty"],
      ["last_savedate", `'${t1m1}'`], ["last_savetime", "'00:00:01 PM'"], ["trf_ledkey", "oled.led_key"]],
    `FROM ${o}.ledger oled LEFT JOIN ${o}.account oac ON oac.code = oled.code LEFT JOIN ${o}.account obkac ON obkac.code = oled.book_code WHERE oled.book = 6 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D' AND oled.reco_date IS NULL`
    + ` AND oled.led_key NOT IN (SELECT coalesce(trf_ledkey, 0) FROM ${s}.ledger WHERE doc_pos <> 'D' AND coalesce(trf_ledkey, 0) > 0)`, { alias: "oled", table: "ledger" });

  await q(ctx, "Pending bank entries refreshed",
    `UPDATE ${s}.ledger cy_led SET code = (SELECT code FROM ${s}.account WHERE book::text || ' ' || name = oac.book::text || ' ' || oac.name AND a_pos <> 'D' LIMIT 1), doc_date = oled.doc_date, doc_no = oled.doc_no, full_docno = oled.full_docno, doc_no1 = oled.doc_no1, amount = oled.amount, book_amt = oled.book_amt,`
    + ` book_code = (SELECT code FROM ${s}.account WHERE book::text || ' ' || name = obkac.book::text || ' ' || obkac.name AND a_pos <> 'D' LIMIT 1), narration = oled.narration, doc_posting = 'R'`
    + ` FROM ${o}.ledger oled JOIN ${o}.account oac ON oac.code = oled.code LEFT JOIN ${o}.account obkac ON obkac.code = oled.book_code`
    + ` WHERE cy_led.trf_ledkey = oled.led_key AND oled.book = 6 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D' AND oled.reco_date IS NULL`
    + ` AND oled.led_key IN (SELECT coalesce(trf_ledkey, 0) FROM ${s}.ledger WHERE book = 6 AND doc_pos <> 'D' AND coalesce(trf_ledkey, 0) > 0)`);
}
