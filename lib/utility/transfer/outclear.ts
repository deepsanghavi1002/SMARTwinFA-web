import { rows } from "../repost/context";
import type { TransferContext } from "./context";
import { insertRows, money, NOW_DATE, NOW_TIME, q, same } from "./context";

/** The line of last year's ledger carried over as an open item: the columns of a LEDGER row, written the way the procedure's temp tables hold them. */
async function openItems(ctx: TransferContext, step: string, where: string): Promise<void> {
  const { sch: s, o } = ctx;
  const codeOf = (alias: string, key: string) => `(CASE WHEN ${key} IS NULL THEN NULL ELSE (SELECT code FROM ${s}.account WHERE name = ${alias}.name AND book = ${alias}.book AND a_pos <> 'D' LIMIT 1) END)`;
  const bookCode = codeOf("obkac", "oled.book_code");
  await insertRows(ctx, step, "ledger",
    [["unique_key", "1"], ["code", codeOf("oac", "oled.code")],
      ...same("oled", ["doc_date", "doc_no", "doc_series", "full_docno", "doc_no1", "amount", "book_amt", "bk_dbcode", "book"]),
      ["book_code", bookCode], ["ac_dbcode", "oled.ac_dbcode"], ["narration", "''"], ["setoff_amt", "0"], ["ly_clearamt", "oout.out_setoff + oout.out_ly_setoff"],
      ["post_bkcode", codeOf("opostac", "oled.post_bkcode")], ["ag_bkcode", codeOf("oagac", "oled.ag_bkcode")],
      ...same("oled", ["ag_book", "type", "int_type", "chln_date", "reco_date", "entry_type"]), ["trf_ledkey", "oled.led_key"], ["post_date", "NULL"], ["post_amt", "0"],
      ["doc_posting", "'X'"], ["doc_mode", "0"], ["doc_lock", "''"], ["doc_pos", "'A'"], ["prod_amt", "oled.prod_amt"], ["stkmdl", "oled.stkmdl"], ["doc_remark", "oled.doc_remark"], ["entry_sty", "oled.entry_sty"],
      ["year_id", `'${ctx.yearId}'`], ["credit_days", "oled.credit_days"], ["entry_perc", "oled.entry_perc"], ["currency_1", "oled.currency_1"], ["entry_no", "oled.entry_no"], ["form_recd", "oled.form_recd"],
      ["form_number", "oled.form_number"], ["form_recddate", "oled.form_recddate"], ["last_savedate", `'${ctx.t1m1}'`], ["last_savetime", "'00:00:01 PM'"]],
    `FROM ${o}.ledger oled LEFT JOIN ${o}.outclear oout ON oout.out_ledid = oled.led_key LEFT JOIN ${o}.account oac ON oac.code = oled.code LEFT JOIN ${o}.account obkac ON obkac.code = oled.book_code`
    + ` LEFT JOIN ${o}.account opostac ON opostac.code = oled.post_bkcode AND oled.post_bkcode IS NOT NULL LEFT JOIN ${o}.account oagac ON oagac.code = oled.ag_bkcode`
    + ` WHERE ${where} AND ${bookCode} IS NOT NULL AND oled.led_key NOT IN (SELECT coalesce(trf_ledkey, 0) FROM ${s}.ledger WHERE doc_pos <> 'D' AND coalesce(trf_ledkey, 0) > 0)`, { alias: "oled", table: "ledger" });
}

/** This year's ledger line brought up to date from last year's (the same bill, as last year left it). */
async function refreshFromLastYear(ctx: TransferContext, step: string, where: string, posting: string, lyClear: string): Promise<void> {
  const { sch: s, o } = ctx;
  await q(ctx, step,
    `UPDATE ${s}.ledger SET code = (CASE WHEN oled.code IS NULL THEN NULL ELSE (SELECT code FROM ${s}.account WHERE name = oac.name AND book = oac.book AND a_pos <> 'D' LIMIT 1) END),`
    + ` doc_date = oled.doc_date, doc_no = oled.doc_no, doc_series = oled.doc_series, full_docno = oled.full_docno, doc_no1 = oled.doc_no1, amount = oled.amount,`
    + ` book_amt = oled.book_amt, ly_clearamt = ${lyClear}, chln_date = oled.chln_date, doc_posting = '${posting}', prod_amt = oled.prod_amt, doc_remark = oled.doc_remark,`
    + ` credit_days = oled.credit_days, entry_perc = oled.entry_perc`
    + ` FROM ${o}.ledger oled JOIN ${o}.outclear oout ON oout.out_ledid = oled.led_key JOIN ${o}.account oac ON oac.code = oled.code`
    + ` WHERE oled.led_key = ledger.trf_ledkey AND ${where} AND coalesce(oled.led_key, 0) IN (SELECT coalesce(trf_ledkey, 0) FROM ${s}.ledger WHERE doc_pos <> 'D' AND doc_posting = 'z' AND coalesce(trf_ledkey, 0) > 0 AND doc_posting <> 'R')`);
}

/**
 * A bill whose party changed: the set off against it is taken off the bill (now), and the receipt/payment that was set off becomes an on-account
 * entry again (the returned step, which the procedure runs after all three bills' set off is taken off).
 */
async function partyChanged(ctx: TransferContext, label: string, billDb: number, setoffDb: number, books: string, extra: string): Promise<() => Promise<unknown>> {
  const { sch: s, t1 } = ctx;
  const pairs = `SELECT obill.out_key FROM ${s}.outclear obill LEFT JOIN ${s}.outclear osetoff ON osetoff.out_ag_outid = obill.out_key WHERE obill.out_date < '${t1}' AND osetoff.out_date >= '${t1}'`
    + ` AND osetoff.out_ag_outid IS NOT NULL AND obill.out_ag_outid IS NULL AND obill.out_dbcode = ${billDb} AND osetoff.out_dbcode = ${setoffDb} AND coalesce(obill.code, 0) IN (SELECT coalesce(code, 0) FROM ${s}.account WHERE book ${books})${extra} AND obill.code <> osetoff.code`;
  await q(ctx, `Set off taken off the ${label} bills`,
    `UPDATE ${s}.outclear oc SET out_setoff = oc.out_setoff - (SELECT sum(x.out_setoff) FROM ${s}.outclear x WHERE x.out_ag_outid = oc.out_key) WHERE coalesce(oc.out_key, 0) IN (${pairs})`);
  return () => q(ctx, `On-account entries of the ${label} bills`, `UPDATE ${s}.outclear SET out_setoff = 0, clear_pos = 'P', out_ag_outid = NULL WHERE coalesce(out_ag_outid, 0) IN (${pairs})`);
}

/** SP_TRANSFER_DATA, @bit_outclear = 1: the pending bills of last year carried into this year's ledger and outstanding. */
export async function transferOutstanding(ctx: TransferContext): Promise<void> {
  const { sch: s, o, t1, licence, opt } = ctx;
  const y = ctx.yearId;
  ctx.log("Outstanding");
  const trfEntries = `doc_date < '${t1}' AND doc_posting = 'L' AND coalesce(trf_ledkey, 0) > 0`;

  await q(ctx, "Entries cleared in last year", `UPDATE ${s}.ledger SET doc_pos = 'D' WHERE ${trfEntries} AND led_key IN (SELECT out_ledid FROM ${s}.outclear WHERE out_ledid IS NOT NULL)`);
  await q(ctx, "Entries still set off", `UPDATE ${s}.ledger SET doc_pos = 'A' WHERE ${trfEntries} AND led_key IN (SELECT out_ledid FROM ${s}.outclear WHERE coalesce(out_key, 0) IN (SELECT coalesce(out_ag_outid, 0) FROM ${s}.outclear WHERE out_ag_outid IS NOT NULL) AND out_date < '${t1}')`);
  await q(ctx, "Outstanding of the cleared entries", `DELETE FROM ${s}.outclear WHERE coalesce(out_ledid, 0) IN (SELECT coalesce(led_key, 0) FROM ${s}.ledger WHERE doc_pos = 'D' AND doc_date < '${t1}' AND coalesce(trf_ledkey, 0) > 0)`);
  await q(ctx, "Entries to bring up to date", `UPDATE ${s}.ledger SET doc_posting = 'z' WHERE doc_pos <> 'D' AND doc_date < '${t1}' AND doc_posting <> 'R' AND doc_posting <> 'P' AND coalesce(trf_ledkey, 0) > 0`);
  await q(ctx, "Receipts on account of the customers", `DELETE FROM ${s}.outclear WHERE out_dbcode = 2 AND coalesce(out_ledid, 0) IN (SELECT coalesce(led.led_key, 0) FROM ${s}.ledger led LEFT JOIN ${s}.account ac ON ac.code = led.code WHERE ac.book = 2 AND led.doc_posting = 'R' AND led.doc_date < '${t1}')`);

  // This year's entries brought up to date from last year's pending bills.
  const pending = (db: number, book: string, extra = "") => `oout.out_dbcode = ${db} AND oout.out_ag_outid IS NULL AND oout.out_entryamt - oout.out_ly_setoff > oout.out_setoff AND oout.out_entryamt > 0 AND oac.book ${book} AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D'${extra}`;
  const lyClear = "oout.out_setoff + oout.out_ly_setoff";
  await refreshFromLastYear(ctx, "Sale bills of last year", pending(1, "= 2"), "Y", lyClear);
  if (licence === 3) await refreshFromLastYear(ctx, "Receipts of last year (sale)", "oout.out_dbcode = 2 AND oout.out_ag_outid IS NULL AND oout.out_setoff = 0 AND oout.out_entryamt > 0 AND oac.book = 2 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D' AND oout.out_fulldocno <> 'OPENING'", "Y", lyClear);
  await refreshFromLastYear(ctx, "Purchase bills of last year", pending(2, "= 3"), "Y", lyClear);
  await refreshFromLastYear(ctx, "Expense bills of last year", pending(2, "= 1", " AND oled.book = 15"), "Y", lyClear);

  await q(ctx, "Outstanding from the brought up entries", `UPDATE ${s}.outclear oc SET out_date = led.doc_date, out_fulldocno = led.full_docno, out_entryamt = led.amount, out_ly_setoff = led.ly_clearamt, code = led.code FROM ${s}.ledger led WHERE oc.out_ledid = led.led_key AND led.doc_posting = 'Y'`);

  // A bill whose account changed no longer carries the receipts set off against it.
  const onAccount = [
    await partyChanged(ctx, "sale", 1, 2, "= 2", ""),
    await partyChanged(ctx, "purchase", 2, 1, "= 3", ""),
    await partyChanged(ctx, "expense", 2, 1, "= 1", " AND obill.out_entrybook = 15"),
  ];
  for (const step of onAccount) await step();

  // The pending bills that last year's entries do not yet have a line for in this year.
  await openItems(ctx, "Pending sale bills", `oout.out_dbcode = 1 AND oout.out_ag_outid IS NULL AND oout.out_entryamt - oout.out_ly_setoff > oout.out_setoff${licence !== 3 && licence !== 11 ? " AND oled.book >= 8" : ""} AND oout.out_entryamt > 0 AND oac.book = 2 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D'`);
  if (licence === 3) await openItems(ctx, "Pending receipts (sale)", "oout.out_dbcode = 2 AND oout.out_ag_outid IS NULL AND oout.out_setoff = 0 AND oout.out_entryamt > 0 AND oac.book = 2 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D' AND oout.out_fulldocno <> 'OPENING'");
  await openItems(ctx, "Pending purchase bills", `oout.out_dbcode = 2 AND oout.out_ag_outid IS NULL AND oout.out_entryamt - oout.out_ly_setoff > oout.out_setoff AND oout.out_entryamt > 0 AND oac.book = 3 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D'${licence !== 3 && licence !== 11 ? " AND oled.book >= 8" : ""}`);

  // Last year's receipt on account that changed there changes here.
  const lastReceipt = (extra: string) => `oout.out_dbcode = 2 AND oac.book = 2 AND oout.out_fulldocno <> 'OPENING' AND oout.out_entryamt > 0 AND oout.out_ag_outid IS NULL AND oled.doc_pos <> 'D' AND coalesce(oled.led_key, 0) IN (SELECT coalesce(trf_ledkey, 0) FROM ${s}.ledger WHERE doc_pos <> 'D' AND coalesce(trf_ledkey, 0) > 0 AND doc_posting <> 'R' AND doc_posting <> 'P')${extra}`;
  const links = `${o}.ledger oled, ${o}.outclear oout, ${o}.account oac`;
  const joins = `oled.led_key = cyled.trf_ledkey AND oout.out_ledid = oled.led_key AND oac.code = oled.code`;
  await q(ctx, "Receipt amount in the outstanding", `UPDATE ${s}.outclear cyout SET out_entryamt = oout.out_entryamt, out_setoff = 0 FROM ${s}.ledger cyled, ${links} WHERE cyout.out_ledid = cyled.led_key AND ${joins} AND cyout.out_ag_outid IS NULL AND oout.out_setoff = 0 AND ${lastReceipt("")}`);
  await q(ctx, "Receipt amount in the ledger", `UPDATE ${s}.ledger cyled SET amount = oout.out_entryamt, book_amt = oout.out_entryamt FROM ${s}.outclear cyout, ${links} WHERE cyout.out_ledid = cyled.led_key AND ${joins} AND cyout.out_ag_outid IS NULL AND oout.out_setoff = 0 AND ${lastReceipt("")}`);
  await q(ctx, "Receipts cleared in last year", `UPDATE ${s}.ledger cyled SET doc_pos = 'D' FROM ${s}.outclear cyout WHERE cyout.out_ledid = cyled.led_key AND cyout.out_ag_outid IS NULL AND coalesce(cyled.trf_ledkey, 0) IN (`
    + `SELECT coalesce(oled.led_key, 0) FROM ${o}.ledger oled LEFT JOIN ${o}.outclear oout ON oout.out_ledid = oled.led_key LEFT JOIN ${o}.account oac ON oac.code = oled.code WHERE oout.out_dbcode = 2 AND oac.book = 2 AND oout.out_fulldocno <> 'OPENING' AND oout.out_entryamt > 0 AND oout.out_setoff = oout.out_entryamt`
    + ` AND (oout.out_ag_outid IS NOT NULL OR oled.doc_pos = 'D') AND coalesce(oled.led_key, 0) IN (SELECT coalesce(trf_ledkey, 0) FROM ${s}.ledger WHERE doc_pos <> 'D' AND coalesce(trf_ledkey, 0) > 0 AND doc_posting <> 'R' AND doc_posting <> 'P'))`);
  if (licence === 3) await q(ctx, "Receipts of deleted entries", `DELETE FROM ${s}.outclear WHERE out_dbcode = 2 AND coalesce(out_ledid, 0) IN (SELECT coalesce(led.led_key, 0) FROM ${s}.ledger led LEFT JOIN ${s}.account ac ON ac.code = led.code WHERE ac.book = 2 AND led.doc_pos = 'D' AND led.doc_date < '${t1}')`);

  await openItems(ctx, "Pending expense bills", "oout.out_dbcode = 2 AND oout.out_ag_outid IS NULL AND oout.out_entryamt - oout.out_ly_setoff > oout.out_setoff AND oout.out_entryamt > 0 AND oac.book = 1 AND oled.book = 15 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D'");

  const outRow = `INSERT INTO ${s}.outclear (out_ledid, out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_ag_outid, out_entrybook, code, ref_no, set_off, clear_pos, year_id)`;
  await q(ctx, "Outstanding of the new entries", `${outRow} SELECT led_key, doc_date, full_docno, amount, 0, ly_clearamt, 0, ac_dbcode, NULL, book, code, '', 0, 'P', '${y}' FROM ${s}.ledger WHERE doc_posting = 'X' AND doc_pos <> 'D'`);
  await q(ctx, "Set off of deleted entries made on account", `UPDATE ${s}.outclear SET clear_pos = 'P', out_entryamt = out_setoff, out_setoff = 0, out_ag_outid = NULL WHERE coalesce(out_ag_outid, 0) IN (SELECT coalesce(out_key, 0) FROM ${s}.outclear WHERE coalesce(out_ledid, 0) IN (SELECT coalesce(led_key, 0) FROM ${s}.ledger WHERE doc_pos <> 'D' AND doc_posting = 'z'))`);

  // Expense purchases: first transferred as a purchase, then as outstanding.
  await q(ctx, "Outstanding of expense purchases", `${outRow} SELECT led_key, doc_date, full_docno, amount, 0, ly_clearamt, 0, ac_dbcode, NULL, book, code, '', 0, 'P', '${y}' FROM ${s}.ledger WHERE book = 13 AND doc_posting = 'Y' AND doc_pos <> 'D' AND coalesce(led_key, 0) NOT IN (SELECT DISTINCT coalesce(out_ledid, 0) FROM ${s}.outclear)`);
  await q(ctx, "Purchases of last year", `UPDATE ${s}.ledger SET code = (CASE WHEN oled.code IS NULL THEN NULL ELSE (SELECT code FROM ${s}.account WHERE name = oac.name AND book = oac.book AND a_pos <> 'D' LIMIT 1) END), doc_date = oled.doc_date, doc_no = oled.doc_no, doc_series = oled.doc_series,`
    + ` full_docno = oled.full_docno, doc_no1 = oled.doc_no1, amount = oled.amount, book_amt = oled.book_amt, doc_posting = 'L', ly_clearamt = 0, chln_date = oled.chln_date, prod_amt = oled.prod_amt, doc_remark = oled.doc_remark, credit_days = oled.credit_days, entry_perc = oled.entry_perc`
    + ` FROM ${o}.ledger oled JOIN ${o}.account oac ON oac.code = oled.code WHERE oled.led_key = ledger.trf_ledkey AND oled.ac_dbcode = 2 AND oled.book = 15 AND oac.a_pos <> 'D' AND oled.doc_pos <> 'D'`
    + ` AND coalesce(oled.led_key, 0) IN (SELECT coalesce(trf_ledkey, 0) FROM ${s}.ledger WHERE doc_posting = 'z' AND coalesce(trf_ledkey, 0) > 0 AND doc_posting <> 'R' AND doc_posting <> 'P' AND doc_pos <> 'D')`);
  await q(ctx, "Back to ledger entries", `UPDATE ${s}.ledger SET unique_key = led_key, doc_posting = 'L', entry_type = 'OS' WHERE doc_posting IN ('X', 'Y') AND doc_pos = 'A'`);

  await q(ctx, "Opening rows",
    `INSERT INTO ${s}.outclear (out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_entrybook, code, set_off, clear_pos, year_id)`
    + ` SELECT '${t1}', 'OPENING', 0, 0, 0, 0, CASE WHEN ac.book = 2 THEN 1 ELSE 2 END, CASE WHEN ac.book = 2 THEN 8 WHEN ac.book = 3 THEN 13 ELSE 15 END, ac.code, 0, 'P', '${y}'`
    + ` FROM ${s}.account ac LEFT JOIN ${s}.outclear oc ON oc.code = ac.code AND oc.out_fulldocno = 'OPENING' WHERE ac.a_pos <> 'D' AND ac.book IN (1, 2, 3) AND ac.os_flag <> 'N' AND oc.code IS NULL`);

  // The opening of each account: its balance less the bills of the years before.
  await q(ctx, "Drop DR_REC", "DROP TABLE IF EXISTS pg_temp.temp_table_dr_rec");
  await q(ctx, "Opening balances to find",
    `CREATE TEMP TABLE temp_table_dr_rec AS SELECT CASE WHEN ac.book = 2 THEN acbal.opening ELSE acbal.opening * -1 END - coalesce(sum(outclr.out_entryamt - (CASE WHEN outclr.out_entryamt >= outclr.out_ly_setoff THEN outclr.out_ly_setoff ELSE 0 END)), 0) AS num_opening, ac.code`
    + ` FROM ${s}.account ac LEFT JOIN ${s}.ac_balance acbal ON acbal.code = ac.code LEFT JOIN ${s}.outclear outclr ON outclr.code = ac.code AND outclr.out_date < '${t1}' AND outclr.out_fulldocno <> 'OPENING' AND outclr.out_entrybook >= 8`
    + ` WHERE ac.a_pos = 'A' AND outclr.out_dbcode = CASE WHEN ac.book = 2 THEN 1 ELSE 2 END GROUP BY ac.code, acbal.opening, ac.book`);
  await q(ctx, "Opening rows amounts", `UPDATE ${s}.outclear outclr SET out_entryamt = tmptbl.num_opening, out_dbcode = CASE WHEN ac.book = 2 THEN 1 ELSE 2 END FROM temp_table_dr_rec tmptbl, ${s}.account ac WHERE outclr.code = tmptbl.code AND outclr.code = ac.code AND outclr.out_fulldocno = 'OPENING'`);
  await q(ctx, "Drop DR_REC again", "DROP TABLE IF EXISTS pg_temp.temp_table_dr_rec");

  await setOffOverBill(ctx);
  await mergeOnAccountRows(ctx);

  await q(ctx, "Outstanding of the brought up entries", `DELETE FROM ${s}.outclear WHERE coalesce(out_ledid, 0) IN (SELECT coalesce(led_key, 0) FROM ${s}.ledger WHERE doc_pos <> 'D' AND doc_posting = 'z' AND coalesce(trf_ledkey, 0) > 0)`);
  await q(ctx, "Entries to bring up deleted", `UPDATE ${s}.ledger SET doc_pos = 'D' WHERE doc_posting = 'z' AND doc_posting <> 'R' AND coalesce(trf_ledkey, 0) > 0`);

  if (opt.osOnAccountClear && opt.account) await clearOnAccount(ctx);
  if (licence === 14 && !s.toUpperCase().includes("TJAC_")) await tjLastYearBills(ctx);
  await q(ctx, "Deleted entries", `DELETE FROM ${s}.ledger WHERE doc_pos = 'D' AND doc_posting <> 'P'`);
}

/** Where a bill's set off is more than the bill (and its last-year part), the extra set off is made on account again, receipt by receipt. */
async function setOffOverBill(ctx: TransferContext): Promise<void> {
  const { sch: s, yearId: y } = ctx;
  const bills = await rows<{ out_key: number; out_entryamt: string; out_setoff: string; out_ly_setoff: string }>(ctx, "Bills set off for more",
    `SELECT out_key, out_entryamt, out_setoff, out_ly_setoff FROM ${s}.outclear WHERE out_entryamt + out_ly_setoff < out_setoff AND out_ag_outid IS NULL ORDER BY out_key`);
  for (const bill of bills) {
    let diff = Math.round((Number(bill.out_setoff) - (Number(bill.out_entryamt) + Number(bill.out_ly_setoff))) * 100) / 100;
    const receipts = await rows<{ out_key: number; out_ledid: number; out_setoff: string }>(ctx, "Receipts against the bill", `SELECT out_key, out_ledid, out_setoff FROM ${s}.outclear WHERE out_ag_outid = ${Number(bill.out_key)} ORDER BY out_key`);
    for (const receipt of receipts) {
      const setoff = Number(receipt.out_setoff);
      if (diff > 0) {
        if (diff > setoff) {
          await q(ctx, "Receipt made on account", `UPDATE ${s}.outclear SET out_entryamt = ${money(setoff)}, out_setoff = 0, clear_pos = 'P' WHERE out_key = ${Number(receipt.out_key)}`);
          diff = Math.round((diff - setoff) * 100) / 100;
        } else {
          await q(ctx, "Receipt part made on account", `UPDATE ${s}.outclear SET out_setoff = ${money(setoff - diff)} WHERE out_key = ${Number(receipt.out_key)}`);
          await q(ctx, "Extra set off on account", `INSERT INTO ${s}.outclear (out_ledid, out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_ag_outid, out_entrybook, code, ref_no, set_off, clear_pos, year_id)`
            + ` SELECT led_key, doc_date, full_docno, ${money(diff)}, 0, 0, 0, ac_dbcode, NULL, book, code, '', 0, 'P', '${y}' FROM ${s}.ledger WHERE led_key = ${Number(receipt.out_ledid)}`);
          diff = 0;
        }
      }
      await q(ctx, "Bill set off to its amount", `UPDATE ${s}.outclear SET out_setoff = out_entryamt WHERE out_key = ${Number(bill.out_key)}`);
      if (diff === 0) break;
    }
  }
}

/** More than one pending on-account row of an entry are merged into one (the last), with their amounts added. */
async function mergeOnAccountRows(ctx: TransferContext): Promise<void> {
  const { sch: s } = ctx;
  const found = await rows<{ out_key: number; out_ledid: number; out_entryamt: string }>(ctx, "Pending rows of an entry twice",
    `SELECT o1.out_key, o1.out_ledid, o1.out_entryamt FROM ${s}.outclear o1 WHERE (SELECT count(*) FROM ${s}.outclear o2 WHERE o2.out_ledid = o1.out_ledid AND o2.out_ag_outid IS NULL AND o2.clear_pos = 'P') > 1 AND o1.out_ag_outid IS NULL AND o1.clear_pos = 'P' ORDER BY o1.out_ledid, o1.out_key`);
  let ledId = 0;
  let amount = 0;
  let lastKey = 0;
  for (const row of found) {
    const rowLed = Number(row.out_ledid);
    if (ledId !== rowLed && ledId > 0) {
      await q(ctx, "Merged pending row", `UPDATE ${s}.outclear SET out_entryamt = ${money(amount)} WHERE out_key = ${lastKey}`);
      amount = 0;
    } else if (ledId === rowLed) {
      await q(ctx, "Pending row merged away", `DELETE FROM ${s}.outclear WHERE out_key = ${lastKey}`);
    }
    ledId = rowLed;
    amount += Number(row.out_entryamt);
    lastKey = Number(row.out_key);
  }
  if (lastKey > 0 && amount > 0) await q(ctx, "Merged pending row", `UPDATE ${s}.outclear SET out_entryamt = ${money(amount)} WHERE out_key = ${lastKey}`);
}

/** @bit_osonaccountclear with @bit_account: bills older than what the account's opening balance still owes are dropped (oldest are cleared first). */
async function clearOnAccount(ctx: TransferContext): Promise<void> {
  const { sch: s, t1 } = ctx;
  ctx.log("Outstanding on account clear");
  await q(ctx, "Outstanding of deleted entries", `DELETE FROM ${s}.outclear WHERE coalesce(out_ledid, 0) IN (SELECT coalesce(led_key, 0) FROM ${s}.ledger WHERE doc_pos = 'D')`);
  const accounts = await rows<{ code: number; opening: string; book: number }>(ctx, "Accounts with an opening",
    `SELECT a.code, b.opening, a.book FROM ${s}.account a LEFT JOIN ${s}.ac_balance b ON a.code = b.code WHERE a.book IN (1, 2, 3) AND a.a_pos = 'A' AND a.os_flag <> 'N' AND b.opening <> 0`);
  for (const account of accounts) {
    const code = Number(account.code);
    const book = Number(account.book);
    const opening = Number(account.opening);
    let balance = book === 2 && opening > 0 ? opening : (book === 1 || book === 3) && opening < 0 ? Math.abs(opening) : 0;
    const bills = await rows<{ out_key: number; out_ledid: number; outdate: string; entry_amt: string }>(ctx, "Bills of the account",
      `SELECT outclr.out_key, outclr.out_ledid, to_char(outclr.out_date, 'YYYY-MM-DD') AS outdate, (outclr.out_entryamt - coalesce(outclr.out_ly_setoff, 0)) AS entry_amt FROM ${s}.outclear outclr LEFT JOIN ${s}.ledger led ON led.led_key = outclr.out_ledid`
      + ` WHERE outclr.code = ${code} AND outclr.out_entryamt > 0 AND led.doc_pos = 'A' AND outclr.out_ledid IS NOT NULL AND outclr.out_date < '${t1}' ORDER BY outclr.out_date DESC`);
    let outKey = bills.length > 0 ? Number(bills[0].out_key) : 0;
    let outLedId = bills.length > 0 ? Number(bills[0].out_ledid) : 0;
    const side = book === 2 ? 1 : 2;
    for (const bill of bills) {
      if (balance <= 0) {
        await q(ctx, "Set off of older bills released", `UPDATE ${s}.outclear SET out_ag_outid = NULL, clear_pos = 'P', out_setoff = 0 WHERE out_ag_outid IN (SELECT out_key FROM ${s}.outclear WHERE out_dbcode = ${side} AND out_date <= '${bill.outdate}' AND code = ${code}) AND code = ${code}`);
        await q(ctx, "Older bills removed", `DELETE FROM ${s}.outclear WHERE out_dbcode = ${side} AND out_date <= '${bill.outdate}' AND code = ${code} AND out_key <> ${outKey}`);
        await q(ctx, "Older entries removed", `DELETE FROM ${s}.ledger WHERE doc_posting = 'L' AND trf_ledkey > 0 AND ac_dbcode = ${side} AND doc_date <= '${bill.outdate}' AND code = ${code} AND led_key <> ${outLedId}`);
        break;
      }
      const left = balance - Number(bill.entry_amt);
      balance = balance >= left ? left : 0;
      outKey = Number(bill.out_key);
      outLedId = Number(bill.out_ledid);
    }
  }
}

/** Licence 14 (TJ): last year's pending sale bills of the customers come in as one 'LY-TRF' sale line each (their opening balance), with their addon entry. */
async function tjLastYearBills(ctx: TransferContext): Promise<void> {
  const { sch: s, o, ly2, yearId: y } = ctx;
  ctx.log("Last year transfer entries");
  await q(ctx, "Addon entries of last year's transfer", `DELETE FROM ${s}.addon_aentry WHERE imp_aonakey = 100000`);
  await q(ctx, "Last year's transfer entries", `UPDATE ${s}.ledger SET doc_pos = 'D' WHERE narration = 'LY-TRF'`);
  await q(ctx, "Outstanding of last year's transfer", `DELETE FROM ${s}.outclear WHERE coalesce(out_ledid, 0) IN (SELECT coalesce(led_key, 0) FROM ${s}.ledger WHERE doc_pos = 'D' AND narration = 'LY-TRF')`);
  await q(ctx, "Addon entries of the removed transfer", `DELETE FROM ${s}.addon_aentry WHERE coalesce(aona_ledid, 0) IN (SELECT coalesce(led_key, 0) FROM ${s}.ledger WHERE doc_pos = 'D' AND narration = 'LY-TRF')`);
  await q(ctx, "Removed transfer entries", `DELETE FROM ${s}.ledger WHERE doc_pos = 'D' AND narration = 'LY-TRF'`);

  const entry = ["key_sales_man", "txt_sales_man", "key_sub_ledger", "txt_sub_ledger", "key_memo_party", "txt_memo_party", "key_vehicle_no", "txt_vehicle_no", "key_godown", "txt_godown", "key_cost_centr", "txt_cost_centr", "key_pay_terms", "txt_pay_terms", "key_bankname", "txt_bankname", "input_branch", "key_deliveryad", "txt_deliveryad", "input_deltime", "input_address1", "input_address2", "input_address3", "input_partyname", "key_collection", "txt_collection", "key_route", "txt_route", "key_reference", "txt_reference", "key_s_manager", "txt_s_manager", "key_coll_exe", "txt_coll_exe", "key_coll_per", "txt_coll_per", "key_ord_desk", "txt_ord_desk", "key_co_sman", "txt_co_sman", "key_dairy", "txt_dairy", "key_segment", "txt_segment", "key_del_time", "txt_del_time", "key_cn_reason", "txt_cn_reason"];
  await insertRows(ctx, "Addon entries of last year's pending bills", "addon_aentry",
    [["aona_accode", "aent.aona_accode"], ["aona_ledid", "led.led_key"], ["aona_processid", "aent.aona_processid"], ["aona_recid", "aent.aona_recid"], ["trf_aonakey", "aent.trf_aonakey"], ...same("aent", entry), ["imp_aonakey", "100000"]],
    `FROM ${o}.addon_aentry aent LEFT JOIN ${s}.ledger led ON aent.aona_ledid = coalesce(led.trf_ledkey, 0) WHERE led.doc_pos = 'A' AND led.doc_posting = 'L' AND led.book = 8 AND coalesce(led.led_key, 0) NOT IN (SELECT coalesce(aona_ledid, 0) FROM ${s}.addon_aentry)`, { alias: "aent", table: "addon_aentry" });

  await insertRows(ctx, "Sale lines of the opening of the customers", "ledger",
    [["unique_key", "1"], ["code", "334"], ["doc_date", `'${ly2}'`], ["doc_no", "'         1'"], ["doc_series", "'Sale'"], ["full_docno", "'Sale/1'"], ["doc_no1", "''"], ["amount", "acbal.opening"], ["book_amt", "acbal.opening"],
      ["bk_dbcode", "2"], ["book", "8"], ["book_code", "16"], ["ac_dbcode", "1"], ["narration", "'LY-TRF'"], ["setoff_amt", "0"], ["ly_clearamt", "0"], ["post_bkcode", "16"], ["ag_bkcode", "NULL"], ["ag_book", "0"], ["type", "0"], ["int_type", "0"],
      ["chln_date", `'${ly2}'`], ["reco_date", "NULL"], ["entry_type", "''"], ["trf_ledkey", "0"], ["post_date", `'${ly2}'`], ["post_amt", "acbal.opening"], ["doc_posting", "'T'"], ["doc_mode", "'0'"], ["doc_lock", "''"], ["doc_pos", "'A'"],
      ["prod_amt", "0"], ["stkmdl", "''"], ["doc_remark", "''"], ["entry_sty", "''"], ["year_id", `'${y}'`], ["last_savedate", NOW_DATE], ["last_savetime", NOW_TIME], ["currency_1", "ac.code"]],
    `FROM ${s}.account ac LEFT JOIN ${s}.ac_balance acbal ON acbal.code = ac.code WHERE ac.book = 2 AND ac.a_pos = 'A' AND ac.name NOT IN (SELECT coalesce(txt_reference, '') FROM ${s}.addon_aentry) AND acbal.opening <> 0`);
  await q(ctx, "Outstanding of the opening sale lines", `INSERT INTO ${s}.outclear (out_ledid, out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_ag_outid, out_entrybook, code, ref_no, set_off, clear_pos, year_id)`
    + ` SELECT led_key, doc_date, 'Sale/1', amount, 0, 0, 0, 1, NULL, 8, 334, '', 0, 'P', '${y}' FROM ${s}.ledger WHERE doc_posting = 'T'`);

  const entryValues: [string, string][] = entry.map((name): [string, string] => {
    if (name === "key_reference") return [name, `(SELECT sub_code FROM ${s}.addon_sub asub, ${s}.account ac WHERE ac.name = asub.sub_name AND led.currency_1 = ac.code LIMIT 1)`];
    if (name === "txt_reference") return [name, `(SELECT sub_name FROM ${s}.addon_sub asub, ${s}.account ac WHERE ac.name = asub.sub_name AND led.currency_1 = ac.code LIMIT 1)`];
    return [name, name.startsWith("key_") ? "0" : "''"];
  });
  await insertRows(ctx, "Addon entries of the opening sale lines", "addon_aentry",
    [["aona_accode", "334"], ["aona_ledid", "led.led_key"], ["aona_processid", "NULL"], ["aona_recid", "'L'"], ["imp_aonakey", "0"], ["trf_aonakey", "0"], ...entryValues],
    `FROM ${s}.ledger led WHERE led.doc_posting = 'T'`);
  await q(ctx, "Unique key of the opening sale lines", `UPDATE ${s}.ledger SET unique_key = led_key WHERE unique_key = 1 AND doc_posting = 'T'`);
  await q(ctx, "Opening sale lines to ledger", `UPDATE ${s}.ledger SET doc_posting = 'L' WHERE doc_posting = 'T'`);
}
