import type { RepostContext } from "./context";
import { rows, run, typeColumn } from "./context";

/** SP_REPOST_DATA, @bit_outclear = 1: the bill-wise outstanding (OUTCLEAR) of the year, again from the entries. */
export async function repostOutstanding(ctx: RepostContext): Promise<void> {
  const { sch: s, yearId: y, from: f } = ctx;
  const q = (step: string, sql: string) => run(ctx, step, sql);
  ctx.log("Outstanding posting");

  await q("Outstanding of deleted entries", `DELETE FROM ${s}.outclear oc USING ${s}.ledger led WHERE oc.out_ledid = led.led_key AND led.doc_pos = 'D'`);
  await q("Outstanding of entries not found", `DELETE FROM ${s}.outclear oc WHERE NOT EXISTS (SELECT 1 FROM ${s}.ledger led WHERE led.led_key = oc.out_ledid) AND oc.out_fulldocno <> 'OPENING' AND oc.out_ledid > 0`);
  await q("Outstanding of another account", `DELETE FROM ${s}.outclear oc USING ${s}.ledger led WHERE oc.out_ledid = led.led_key AND led.code <> oc.code`);
  await q("Outstanding without an entry", `DELETE FROM ${s}.outclear WHERE coalesce(out_ledid, 0) = 0 AND out_fulldocno <> 'OPENING'`);

  const ledgerType = await typeColumn(ctx, "ledger");
  if (ctx.licence !== 3) {
    await q("Last year's clearing of the entries", `UPDATE ${s}.ledger SET ly_clearamt = 0 WHERE doc_date < '${f}' AND doc_pos = 'A' AND doc_posting = 'L' AND led_key IN (SELECT out_ledid FROM ${s}.outclear WHERE out_date < '${f}' AND out_entryamt = out_setoff AND out_ly_setoff > 0)`);
    await q("Last year's set off cleared", `UPDATE ${s}.outclear SET out_ly_setoff = 0 WHERE out_date < '${f}' AND out_entryamt = out_setoff AND out_ly_setoff > 0`);
    await q("Last year's clearing of part set off", `UPDATE ${s}.ledger led SET ly_clearamt = outclr.out_entryamt - outclr.out_setoff FROM ${s}.outclear outclr WHERE led.led_key = outclr.out_ledid AND led.doc_date < '${f}' AND outclr.out_date < '${f}' AND outclr.out_entryamt - outclr.out_ly_setoff < outclr.out_setoff AND outclr.out_ly_setoff > 0 AND outclr.out_setoff > 0`);
    await q("Last year's set off of part set off", `UPDATE ${s}.outclear SET out_ly_setoff = out_entryamt - out_setoff WHERE out_date < '${f}' AND out_entryamt - out_ly_setoff < out_setoff AND out_ly_setoff > 0 AND out_setoff > 0`);
    await q("Receipts of last year's customers", `DELETE FROM ${s}.outclear oc USING ${s}.account ac WHERE oc.code = ac.code AND oc.out_dbcode = 2 AND oc.out_date < '${f}' AND ac.book = 2`);
    await q("Receipt entries of last year", `DELETE FROM ${s}.ledger oc USING ${s}.account ac WHERE oc.code = ac.code AND oc.ac_dbcode = 2 AND oc.doc_date < '${f}' AND oc.doc_posting = 'L'${ledgerType ? ` AND oc.${ledgerType} <> 10` : ""} AND ac.book = 2`);
  }
  await q("Outstanding of entries without a book", `DELETE FROM ${s}.outclear oc USING ${s}.ledger led WHERE oc.out_ledid = led.led_key AND coalesce(led.book_code, 0) = 0 AND led.doc_date < '${f}'`);
  await q("Entries without a book", `DELETE FROM ${s}.ledger WHERE coalesce(book_code, 0) = 0 AND doc_date < '${f}'`);

  await q("Outstanding of the entries",
    `INSERT INTO ${s}.outclear (out_ledid, out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_entrybook, code, set_off, clear_pos, year_id)`
    + ` SELECT DISTINCT led.led_key, led.doc_date, led.full_docno, led.amount, 0, 0, 0, led.ac_dbcode, led.book, led.code, 0, 'P', led.year_id FROM ${s}.ledger led LEFT JOIN ${s}.account ac ON ac.code = led.code LEFT JOIN ${s}.outclear oc ON led.led_key = oc.out_ledid`
    + ` WHERE led.doc_pos <> 'D' AND ac.os_flag <> 'N' AND ac.a_pos <> 'D' AND led.amount <> 0 AND led.doc_posting <> 'R' AND oc.out_ledid IS NULL`);
  await q("Opening rows",
    `INSERT INTO ${s}.outclear (out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_entrybook, code, set_off, clear_pos, year_id)`
    + ` SELECT '${f}', 'OPENING', 0, 0, 0, 0, CASE WHEN ac.book = 2 THEN 1 ELSE 2 END, CASE WHEN ac.book = 2 THEN 8 WHEN ac.book = 3 THEN 13 ELSE 15 END, ac.code, 0, 'P', '${y}'`
    + ` FROM ${s}.account ac LEFT JOIN ${s}.outclear oc ON oc.code = ac.code AND oc.out_fulldocno = 'OPENING' WHERE ac.a_pos <> 'D' AND ac.book IN (1, 2, 3) AND ac.os_flag <> 'N' AND oc.code IS NULL`);

  // The opening of each account: its balance less the bills of the years before (kept in OUTCLEAR).
  await q("Drop DR_REC", "DROP TABLE IF EXISTS pg_temp.temp_table_dr_rec");
  await q("Opening balances to find",
    `CREATE TEMP TABLE temp_table_dr_rec AS SELECT CASE WHEN ac.book = 2 THEN acbal.opening ELSE acbal.opening * -1 END - coalesce(sum(outclr.out_entryamt - (CASE WHEN outclr.out_entryamt >= outclr.out_ly_setoff THEN outclr.out_ly_setoff ELSE 0 END)), 0) AS num_opening, ac.code`
    + ` FROM ${s}.account ac LEFT JOIN ${s}.ac_balance acbal ON acbal.code = ac.code LEFT JOIN ${s}.outclear outclr ON outclr.code = ac.code AND outclr.out_date < '${f}' AND outclr.out_fulldocno <> 'OPENING' AND outclr.out_entrybook >= 8`
    + ` WHERE ac.a_pos = 'A' AND outclr.out_dbcode = CASE WHEN ac.book = 2 THEN 1 ELSE 2 END GROUP BY ac.code, acbal.opening, ac.book`);
  await q("Opening rows amounts",
    `UPDATE ${s}.outclear outclr SET out_entryamt = tmptbl.num_opening, out_dbcode = CASE WHEN ac.book = 2 THEN 1 ELSE 2 END FROM temp_table_dr_rec tmptbl, ${s}.account ac WHERE outclr.code = tmptbl.code AND outclr.code = ac.code AND outclr.out_fulldocno = 'OPENING'`);
  if (ctx.licence === 3) {
    await q("Opening of sale, negative", `UPDATE ${s}.outclear SET out_entryamt = 0 WHERE out_fulldocno = 'OPENING' AND out_entryamt < 0 AND out_entrybook = 8`);
    await q("Opening of purchase, positive", `UPDATE ${s}.outclear SET out_entryamt = 0 WHERE out_fulldocno = 'OPENING' AND out_entryamt > 0 AND out_entrybook = 13`);
  }
  await q("Drop DR_REC again", "DROP TABLE IF EXISTS pg_temp.temp_table_dr_rec");

  await q("Against key zero", `UPDATE ${s}.outclear SET out_ag_outid = NULL WHERE out_ag_outid = 0`);
  // A receipt or a payment entry is a set off.
  await q("Receipt entries set off", `UPDATE ${s}.outclear oc SET set_off = 1 FROM ${s}.account ac WHERE oc.code = ac.code AND oc.set_off = 0 AND oc.out_dbcode = 2 AND oc.out_entryamt > 0 AND ac.book = 2 AND ac.a_pos <> 'D'`);
  await q("Payment entries set off", `UPDATE ${s}.outclear oc SET set_off = 1 FROM ${s}.account ac WHERE oc.code = ac.code AND oc.set_off = 0 AND oc.out_dbcode = 1 AND oc.out_entryamt > 0 AND ac.book IN (1, 3) AND ac.a_pos <> 'D'`);
  // Nothing set off where no bill is named.
  await q("Receipt without a bill", `UPDATE ${s}.outclear oc SET out_setoff = 0 FROM ${s}.account ac WHERE oc.code = ac.code AND oc.out_setoff > 0 AND oc.out_ag_outid IS NULL AND oc.out_dbcode = 1 AND ac.book = 2 AND ac.a_pos <> 'D'`);
  await q("Payment without a bill", `UPDATE ${s}.outclear oc SET out_setoff = 0 FROM ${s}.account ac WHERE oc.code = ac.code AND oc.out_setoff > 0 AND oc.out_ag_outid IS NULL AND oc.out_dbcode = 2 AND ac.book IN (1, 3) AND ac.a_pos <> 'D'`);
  await q("Set off blank", `UPDATE ${s}.outclear SET out_setoff = 0 WHERE out_setoff IS NULL`);
  await q("Sale side", `UPDATE ${s}.outclear SET out_dbcode = 1 WHERE out_entrybook = 8 AND out_dbcode = 2 AND out_fulldocno <> 'OPENING'`);
  await q("Purchase side", `UPDATE ${s}.outclear SET out_dbcode = 2 WHERE (out_entrybook = 13 OR out_entrybook = 15) AND out_dbcode = 1 AND out_fulldocno <> 'OPENING'`);

  // The bills' amounts from the ledger, less what is set off against them.
  const offsets = `coalesce((SELECT sum(coalesce(x.out_setoff, 0) + coalesce(x.out_ly_setoff, 0)) FROM ${s}.outclear x WHERE x.out_ag_outid IS NOT NULL AND x.out_ledid = oc.out_ledid), 0)`;
  await q("Sale bill amounts", `UPDATE ${s}.outclear oc SET out_entryamt = led.amount FROM ${s}.ledger led, ${s}.account ac WHERE oc.out_ledid = led.led_key AND led.code = ac.code AND oc.out_ledid IS NOT NULL AND oc.out_dbcode = 2 AND ac.book = 2 AND led.doc_pos <> 'D' AND ac.a_pos <> 'D'`);
  await q("Sale bill pending", `UPDATE ${s}.outclear oc SET out_entryamt = oc.out_entryamt - ${offsets} FROM ${s}.account ac WHERE ac.code = oc.code AND oc.out_ag_outid IS NULL AND oc.out_dbcode = 2 AND oc.out_ledid IS NOT NULL AND ac.book = 2 AND ac.a_pos <> 'D'`);
  await q("Purchase bill amounts", `UPDATE ${s}.outclear oc SET out_entryamt = led.amount FROM ${s}.ledger led, ${s}.account ac WHERE oc.out_ledid = led.led_key AND ac.code = oc.code AND oc.out_dbcode = 1 AND ac.book IN (1, 3) AND ac.a_pos <> 'D' AND led.doc_pos <> 'D' AND oc.out_ledid IS NOT NULL`);
  await q("Purchase bill pending", `UPDATE ${s}.outclear oc SET out_entryamt = oc.out_entryamt - ${offsets} FROM ${s}.account ac WHERE ac.code = oc.code AND oc.out_ag_outid IS NULL AND oc.out_dbcode = 1 AND oc.out_ledid IS NOT NULL AND ac.book IN (1, 3) AND ac.a_pos <> 'D'`);
  // What the receipts and payments set off, summed on each bill.
  const setoffOf = (side: number, books: string) => `UPDATE ${s}.outclear oc SET out_setoff = coalesce((SELECT sum(x.out_setoff) FROM ${s}.outclear x WHERE x.out_dbcode = ${side} AND x.out_ag_outid = oc.out_key AND x.code = oc.code), 0)`
    + ` WHERE oc.out_ag_outid IS NULL AND oc.out_dbcode = ${side === 2 ? 1 : 2} AND oc.code IN (SELECT code FROM ${s}.account WHERE book ${books} AND a_pos <> 'D')`;
  await q("Receipts set off on the sale bills", setoffOf(2, "= 2"));
  await q("Payments set off on the purchase bills", setoffOf(1, "IN (1, 3)"));
  await q("Entry amount of sale entries", `UPDATE ${s}.outclear oc SET out_entryamt = led.amount FROM ${s}.ledger led, ${s}.account acc WHERE led.led_key = oc.out_ledid AND acc.code = led.code AND acc.book = 2 AND acc.a_pos <> 'D' AND led.doc_pos <> 'D' AND oc.out_ledid IS NOT NULL AND oc.out_dbcode = 1 AND (oc.set_off = 0 OR (oc.set_off = 1 AND oc.out_setoff > 0))`);
  await q("Entry amount of purchase entries", `UPDATE ${s}.outclear oc SET out_entryamt = led.amount FROM ${s}.ledger led, ${s}.account acc WHERE led.led_key = oc.out_ledid AND acc.code = led.code AND acc.book IN (1, 3) AND acc.a_pos <> 'D' AND led.doc_pos <> 'D' AND oc.out_ledid IS NOT NULL AND oc.out_dbcode = 2 AND (oc.set_off = 0 OR (oc.set_off = 1 AND oc.out_setoff > 0))`);
  await q("Entry amount blank", `UPDATE ${s}.outclear SET out_entryamt = 0 WHERE out_entryamt IS NULL`);
  await q("Set off blank again", `UPDATE ${s}.outclear SET out_setoff = 0 WHERE out_setoff IS NULL`);
  await q("Clear position", `UPDATE ${s}.outclear SET clear_pos = (CASE WHEN out_setoff + out_ly_setoff > 0 THEN 'C' ELSE 'P' END)`);
  await q("Set off of nothing", `UPDATE ${s}.outclear oc SET out_entryamt = 0, out_setoff = 0, out_ag_outid = NULL, clear_pos = 'P' WHERE oc.out_ledid IS NOT NULL AND (oc.out_entryamt = 0 OR oc.out_entryamt IS NULL) AND oc.out_setoff > 0`);
  await q("Opening of an account without opening", `UPDATE ${s}.outclear oc SET out_entryamt = 0 FROM ${s}.ac_balance ab WHERE ab.code = oc.code AND oc.out_entryamt <> 0 AND oc.out_fulldocno = 'OPENING' AND ab.opening = 0`);
  await q("Rows of nothing", `DELETE FROM ${s}.outclear WHERE out_entryamt = 0 AND out_setoff = 0 AND out_ly_setoff = 0 AND out_fulldocno <> 'OPENING' AND out_ledid IS NOT NULL`);

  // The receipts, payments and journals not wholly set off: what is left of each is a bill of its own.
  for (const [accountBook, side] of [[2, 2], [3, 1]] as const) {
    await q("Drop REC", "DROP TABLE IF EXISTS pg_temp.temp_table_rec");
    const taken = `(SELECT sum(CASE WHEN oc.out_setoff = 0 THEN oc.out_entryamt ELSE oc.out_setoff END) FROM ${s}.outclear oc WHERE oc.out_ledid = led.led_key)`;
    await q(`Entries not wholly set off, book ${accountBook}`,
      `CREATE TEMP TABLE temp_table_rec AS SELECT led.code, led.led_key, led.amount - coalesce(${taken}, 0) AS setoff FROM ${s}.ledger led INNER JOIN ${s}.account ac ON ac.code = led.code`
      + ` WHERE led.book IN (4, 5, 6, 11, 16, 19) AND ac.book = ${accountBook} AND led.doc_pos = 'A' AND led.ac_dbcode = ${side} AND led.amount <> coalesce(${taken}, 0)`);
    await q("Nothing left", "DELETE FROM temp_table_rec WHERE setoff < 0 OR setoff = 0");
    await q(`Rows of what is left, book ${accountBook}`,
      `INSERT INTO ${s}.outclear (out_ledid, out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_entrybook, code, set_off, clear_pos, year_id)`
      + ` SELECT led.led_key, led.doc_date, led.full_docno, tled.setoff, 0, 0, 0, led.ac_dbcode, led.book, led.code, 0, 'P', led.year_id FROM temp_table_rec tled LEFT JOIN ${s}.ledger led ON led.led_key = tled.led_key`);
    await q("Drop REC again", "DROP TABLE IF EXISTS pg_temp.temp_table_rec");
  }

  // An account with an opening and no entries of the years before: the opening row carries it.
  const accounts = await rows<{ code: number; book: number; opening: string }>(ctx, "Accounts with an opening",
    `SELECT ac.code, ac.book, acbal.opening FROM ${s}.account ac LEFT JOIN ${s}.ac_balance acbal ON acbal.code = ac.code WHERE ac.a_pos <> 'D' AND ac.book IN (2, 3) AND ac.os_flag <> 'N' AND acbal.year_id = '${y}' AND acbal.opening <> 0 ORDER BY ac.code`);
  for (const account of accounts) {
    const before = Number((await rows<{ n: string }>(ctx, "Entries of the years before", `SELECT count(*) AS n FROM ${s}.ledger WHERE year_id = '${y}' AND doc_date < '${f}' AND doc_pos = 'A' AND doc_posting = 'L' AND code = ${Number(account.code)}`))[0]?.n) || 0;
    if (before !== 0) continue;
    const opening = Number(account.opening);
    const side = opening > 0 && account.book === 3 ? 1 : opening < 0 && account.book === 2 ? 2 : account.book === 3 ? 2 : 1;
    await q(`Opening of account ${account.code}`, `UPDATE ${s}.outclear SET out_entryamt = ${opening}, out_dbcode = ${side} WHERE out_fulldocno = 'OPENING' AND code = ${Number(account.code)}`);
  }
}
