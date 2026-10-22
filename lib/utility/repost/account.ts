import type { RepostContext } from "./context";
import { numOrNull, reseed, rows, run, scalar, typeColumn } from "./context";

/** SP_REPOST_DATA, @bit_account = 1: the accounts' balances and the ledger posting (LEDGER_POST) of the year, again from the entries. */
export async function repostAccount(ctx: RepostContext): Promise<void> {
  const { sch: s, yearId: y, from: f, to: t } = ctx;
  const q = (step: string, sql: string) => run(ctx, step, sql);
  /** The procedure's date window and posting conditions of a ledger row (alias given). */
  const win = (a: string) => `${a}.doc_date >= '${f}' AND ${a}.doc_date <= '${t}' AND ${a}.doc_pos <> 'D' AND ${a}.doc_posting = 'P'`;
  /** The same conditions on the ledger's own columns, written for the alias `led`. */
  const entry = (a: string) => `${win(a)} AND ${a}.full_docno <> 'Auto/999999'`;
  const own = `${s}.ac_balance.a_recflag = 'AC' AND ${s}.ac_balance.year_id = '${y}'`;
  ctx.log("Account posting");

  // The running number of the cash, bank and journal parts of a voucher (LED_DIV).
  const divide = (step: string, where: string, order: string) => q(step,
    `UPDATE ${s}.ledger SET led_div = n.rnk FROM (SELECT led_key, row_number() OVER (PARTITION BY book_code, full_docno ORDER BY ${order}) AS rnk FROM ${s}.ledger WHERE doc_pos = 'A' AND doc_posting = 'P' AND ${where} AND coalesce(led_div, 0) = 0) n WHERE ${s}.ledger.led_key = n.led_key`);
  const ledgerType = await typeColumn(ctx, "ledger");
  const notNine = ledgerType ? ` AND ${ledgerType} <> 9` : "";
  await divide("LED_DIV debit side", `ac_dbcode = 1${notNine} AND book IN (4, 5, 6)`, "full_docno");
  await divide("LED_DIV credit side", `ac_dbcode = 2${notNine} AND book IN (4, 5, 6)`, "full_docno");
  await divide("LED_DIV book 19", "book = 19", "full_docno, ac_dbcode");

  if (ctx.einvoiceReq) {
    await q("QR code of deleted entries", `DELETE FROM ${s}.entry_qrcode WHERE entry_mode = 'L' AND entry_id IN (SELECT led_key FROM ${s}.ledger WHERE doc_pos = 'D')`);
    await q("QR code of deleted processes", `DELETE FROM ${s}.entry_qrcode WHERE entry_mode = 'P' AND entry_id IN (SELECT process_key FROM ${s}.process WHERE il_pos = 'D')`);
    await q("QR code blank", `DELETE FROM ${s}.entry_qrcode WHERE einv_str_qrcode IS NULL AND einv_qrcode IS NULL`);
  }

  const control = numOrNull(await scalar(ctx, "GST control account", `SELECT code FROM ${s}.account WHERE a_short = 'GST_CTRL' AND book = 1 AND a_pos = 'A' LIMIT 1`)) ?? 0;

  // The master, address and balance rows an account must have.
  const schedules = (await rows<{ bs_key: unknown }>(ctx, "Liability schedules", `SELECT bs_key FROM ${s}.balsheet WHERE ent_frame LIKE '%L%' ORDER BY bs_code`)).map((row) => String(row.bs_key));
  const inSchedules = schedules.length > 0 ? `(bs_id IN (${schedules.join(",")}) OR book IN (2, 3, 19))` : "(book IN (2, 3, 19))";
  await q("Address rows",
    `INSERT INTO ${s}.address (code, address_1, address_2, address_3, city, pin_code, tel_no, std_code, lst_no, cst_no, autho_no, address_id, pan_no, e_mail, website, mobile_no, pager_no, contact, designation, local_code, add_remark, fax, p_reg, telex, a_pos)`
    + ` SELECT code, '', '', '', '', '', '', '', '', '', '', 1, '', '', '', '', '', '', 4, '', '', '', 5, '', 'A' FROM ${s}.account WHERE a_pos <> 'D' AND ${inSchedules} AND code NOT IN (SELECT code FROM ${s}.address WHERE address_id = 1)`);
  await q("Interest master rows",
    `INSERT INTO ${s}.int_master (code, last_date, int_rperc, int_pperc, int_rround, int_pround, ly_loan, ly_int, ly_intdate, tds_req, tds_rate, tds_round, tds_circle, tds_cert, days_base, tds_limit, year_id, int_recflag)`
    + ` SELECT code, NULL, 0, 0, 2, 2, 0, 0, NULL, 'Y', 0, 2, '', 'Y', 365, 0, '${y}', 'AC' FROM ${s}.account WHERE a_pos <> 'D' AND ${inSchedules} AND code NOT IN (SELECT code FROM ${s}.int_master)`);
  await q("Balance rows",
    `INSERT INTO ${s}.ac_balance (code, year_id, a_recflag, opening, debit, credit, closing, last_year, os_billdiff, bs_tempfig)`
    + ` SELECT code, '${y}', 'AC', 0, 0, 0, 0, 0, 0, 0 FROM ${s}.account WHERE a_pos <> 'D' AND (a_posting <> 'N' OR book = 19) AND ${inSchedules} AND code NOT IN (SELECT code FROM ${s}.ac_balance)`);

  const yearCount = Number(await scalar(ctx, "Years in the ledger", `SELECT count(*) FROM (SELECT year_id FROM ${s}.ledger GROUP BY year_id) x`)) || 0;

  await q("Duplicate balance sheet records",
    `UPDATE ${s}.balsheet SET rev_bsrec = 0 WHERE bs_pos = 'A' AND rev_bsrec > 0 AND bs_desc IN (SELECT bs_desc FROM ${s}.balsheet WHERE bs_pos = 'A' AND rev_bsrec > 0 GROUP BY bs_desc HAVING count(*) > 1)`);
  await q("Negative sale", `UPDATE ${s}.ledger SET ac_dbcode = 2, bk_dbcode = 1 WHERE amount < 0 AND book = 8`);
  await q("Negative purchase", `UPDATE ${s}.ledger SET ac_dbcode = 1, bk_dbcode = 2 WHERE amount < 0 AND book = 13`);
  await q("PROD_AMT",
    `UPDATE ${s}.ledger led SET prod_amt = ledext.slab_amt::numeric FROM ${s}.ledger_ext ledext, ${s}.slab_master slabmast WHERE ledext.led_id = led.led_key AND slabmast.slab_key = ledext.slab_id`
    + ` AND led.prod_amt = 0 AND led.book > 7 AND led.book < 17 AND led.doc_posting = 'P' AND led.doc_pos <> 'D' AND led.amount > 0 AND slabmast.slab_active = 'S'`);
  if (ctx.licence === 5) await q("Absolute amounts", `UPDATE ${s}.ledger SET amount = abs(amount), book_amt = abs(book_amt), post_amt = abs(post_amt), prod_amt = abs(prod_amt) WHERE book_amt < 0`);

  // The posting table of the year starts again.
  await q("Clear LEDGER_POST", `DELETE FROM ${s}.ledger_post WHERE year_id = '${y}'`);
  if (yearCount === 1) await reseed(ctx, "ledger_post");
  await q("Rebuild LEDGER_POST indexes", `REINDEX TABLE ${s}.ledger_post`);
  await q("Statistics LEDGER_POST", `ANALYZE ${s}.ledger_post`);
  await q("Entries of deleted vouchers", `DELETE FROM ${s}.ledger_ext WHERE led_id IN (SELECT led_key FROM ${s}.ledger WHERE doc_pos = 'D')`);

  // The balances back to the opening.
  await q("Sub balances", `UPDATE ${s}.sub_balance SET sub_debit = 0, sub_credit = 0, sub_closing = sub_opening WHERE sub_relate = 'A' AND sub_yearid = '${y}'`);
  await q("Account balances", `UPDATE ${s}.ac_balance SET debit = 0, credit = 0, closing = opening WHERE a_recflag = 'AC' AND year_id = '${y}'`);
  for (const column of ["opening", "closing", "last_year", "os_billdiff"]) await q(`Blank ${column}`, `UPDATE ${s}.ac_balance SET ${column} = 0 WHERE ${column} IS NULL AND year_id = '${y}'`);
  for (const [book, code] of [[2, 1], [3, 2]] as const) {
    await q(`Control opening ${code}`,
      `UPDATE ${s}.ac_balance SET opening = coalesce((SELECT sum(a.opening) FROM ${s}.ac_balance a, ${s}.account b WHERE a.code = b.code AND b.book = ${book} AND b.a_pos <> 'D' AND a.opening <> 0 AND a.year_id = '${y}'), 0) WHERE opening <> 0 AND code = ${code} AND year_id = '${y}'`);
  }

  // The sundry debtors' and creditors' accounts take the total of their parties' opening.
  for (const [book, style] of [[2, "SD"], [3, "SC"]] as const) {
    const opening = numOrNull(await scalar(ctx, `Opening of book ${book}`, `SELECT sum(opening) FROM ${s}.ac_balance WHERE a_recflag = 'AC' AND year_id = '${y}' AND code IN (SELECT code FROM ${s}.account WHERE book = ${book} AND a_pos <> 'D')`));
    if (opening !== null) await q(`Opening of ${style}`, `UPDATE ${s}.ac_balance SET opening = ${opening}, closing = ${opening} WHERE code = (SELECT code FROM ${s}.account WHERE ac_opensty = '${style}' LIMIT 1)`);
  }

  await q("Addon rows of deleted accounts", `DELETE FROM ${s}.addon_data WHERE code IN (SELECT code FROM ${s}.account WHERE a_pos = 'D')`);

  // The tax of each voucher (CURRENCY_1), from the tax lines, the product accounts and the slabs.
  await q("CURRENCY_1 cleared", `UPDATE ${s}.ledger SET currency_1 = 0 WHERE currency_1 IS DISTINCT FROM 0`);
  const voucher = `${entry("led")} AND led.book <> 19 AND led.year_id = '${y}' AND coalesce(led.code, 0) <> 0`;
  const taxLines = (link: string) => `coalesce((SELECT sum(ledext.slab_amt::numeric) FROM ${s}.ledger_ext ledext LEFT JOIN ${s}.tax_master taxmst ON taxmst.tax_rec = ledext.tax_id LEFT JOIN ${s}.slab_master slabmst ON slabmst.slab_key = ledext.slab_id`
    + ` WHERE ledext.led_id = led.led_key AND ${link} AND coalesce(ledext.tax_id, 0) > 0 AND taxmst.tax_accode IS NOT NULL AND taxmst.tax_accode > 0 AND taxmst.tax_pos <> 'D'), 0)`;
  await q("Tax, VAT and CGST + IGST", `UPDATE ${s}.ledger led SET currency_1 = ${taxLines("coalesce(slabmst.slab_link, 0) = 0")} WHERE ${voucher} AND (led.rev_charge = 'N' OR coalesce(led.rev_charge, '') = '')`);
  await q("Tax, SGST", `UPDATE ${s}.ledger led SET currency_1 = coalesce(led.currency_1, 0) + ${taxLines("coalesce(slabmst.slab_link, 0) > 0")} WHERE ${voucher} AND (led.rev_charge = 'N' OR coalesce(led.rev_charge, '') = '')`);
  // Reverse charge: added on an expense (15), taken off on a debit note (10); the tax line and the SGST line each.
  for (const [link, sign, book] of [["= 0", "+", 15], ["= 0", "-", 10], ["> 0", "+", 15], ["> 0", "-", 10]] as const) {
    await q(`Reverse charge ${sign} book ${book} (slab link ${link})`,
      `UPDATE ${s}.ledger led SET currency_1 = coalesce(led.currency_1, 0) ${sign} ledext.slab_amt::numeric FROM ${s}.ledger_ext ledext, ${s}.tax_master taxmst, ${s}.slab_master slabmst`
      + ` WHERE ledext.led_id = led.led_key AND taxmst.tax_rec = ledext.tax_id AND slabmst.slab_key = ledext.slab_id AND ${win("led")} AND led.book <> 19 AND coalesce(slabmst.slab_link, 0) ${link}`
      + ` AND led.full_docno <> 'Auto/999999' AND led.year_id = '${y}' AND coalesce(led.code, 0) <> 0 AND led.rev_charge = 'Y' AND led.book = ${book}`
      + ` AND coalesce(ledext.tax_id, 0) > 0 AND taxmst.tax_accode IS NOT NULL AND taxmst.tax_accode > 0 AND taxmst.tax_pos <> 'D'`);
  }
  if (ctx.prodAcPost) {
    await q("Product account amounts",
      `UPDATE ${s}.ledger led SET currency_1 = coalesce(led.currency_1, 0) + coalesce((SELECT sum(prodled.il_value) FROM ${s}.prod_ledger prodled LEFT JOIN ${s}.product_master prodmst ON prodmst.prod_key = prodled.prod_id`
      + ` WHERE led.led_key = prodled.led_id AND prodled.process_id IS NULL AND prodmst.s_code IS NOT NULL AND prodmst.s_code > 0 AND prodmst.prod_pos <> 'D' AND prodled.il_value > 0), 0)`
      + ` WHERE ${win("led")} AND coalesce(led.code, 0) <> 0 AND led.book <> 19 AND led.full_docno <> 'Auto/999999' AND led.year_id = '${y}'`
      + ` AND led.led_key IN (SELECT prodled.led_id FROM ${s}.prod_ledger prodled LEFT JOIN ${s}.product_master prodmst ON prodmst.prod_key = prodled.prod_id WHERE prodled.process_id IS NULL AND prodmst.s_code IS NOT NULL AND prodmst.s_code > 0 AND prodmst.prod_pos <> 'D' AND prodled.il_value > 0)`);
  }
  await q("Slab amounts",
    `UPDATE ${s}.ledger led SET currency_1 = coalesce(led.currency_1, 0) + coalesce((SELECT sum(CASE WHEN slabmst.slab_mathop = 'L' THEN ledext.slab_amt::numeric * -1 ELSE ledext.slab_amt::numeric END) FROM ${s}.ledger_ext ledext`
    + ` LEFT JOIN ${s}.slab_master slabmst ON slabmst.slab_key = ledext.slab_id WHERE ledext.il_id IS NULL AND slabmst.slab_accode IS NOT NULL AND slabmst.slab_accode > 0 AND slabmst.slab_active = 'Y' AND led.led_key = ledext.led_id GROUP BY ledext.led_id), 0)`
    + ` WHERE ${voucher}`);
  await q("CURRENCY_1 blank", `UPDATE ${s}.ledger SET currency_1 = 0 WHERE currency_1 IS NULL`);

  // The accounts' debit and credit.
  const fromLedger = (sum: string, extra: string, by: string) => `(SELECT ${sum} FROM ${s}.ledger b WHERE ${by} AND ${entry("b")} AND b.year_id = '${y}' ${extra})`;
  await q("Debit from the accounts", `UPDATE ${s}.ac_balance SET debit = ${fromLedger("CASE WHEN coalesce(sum(b.amount), 0) = 0 THEN 0 ELSE sum(b.amount) END", "AND b.ac_dbcode = 1 AND b.amount <> 0 AND coalesce(b.code, 0) <> 0", `b.code = ${s}.ac_balance.code`)} WHERE ${own}`);
  await q("Credit from the accounts", `UPDATE ${s}.ac_balance SET credit = ${fromLedger("CASE WHEN coalesce(sum(b.amount), 0) = 0 THEN 0 ELSE sum(CASE WHEN b.amount > 0 THEN b.amount ELSE b.amount * -1 END) END", "AND b.ac_dbcode = 2 AND b.amount <> 0 AND coalesce(b.code, 0) <> 0", `b.code = ${s}.ac_balance.code`)} WHERE ${own}`);
  const bookSum = "CASE WHEN coalesce(sum(b.amount), 0) = 0 THEN 0 ELSE sum(b.amount - (CASE WHEN b.rev_charge = 'Y' THEN 0 ELSE b.currency_1 END)) END";
  for (const [column, side] of [["debit", 1], ["credit", 2]] as const) {
    await q(`Books ${column}`, `UPDATE ${s}.ac_balance SET ${column} = ${column} + ${fromLedger(bookSum, `AND b.book <> 19 AND coalesce(b.post_bkcode, 0) > 0 AND b.bk_dbcode = ${side} AND b.amount <> 0 AND coalesce(b.code, 0) <> 0`, `b.post_bkcode = ${s}.ac_balance.code`)} WHERE ${own}`);
  }
  if (control > 0) {
    await q("GST control debit",
      `UPDATE ${s}.ac_balance SET debit = debit + (SELECT CASE WHEN coalesce(sum(b.currency_1), 0) = 0 THEN 0 ELSE sum(b.currency_1) END FROM ${s}.ledger b WHERE ${entry("b")} AND b.book = 15`
      + ` AND b.year_id = '${y}' AND coalesce(b.post_bkcode, 0) > 0 AND b.rev_charge = 'Y' AND b.bk_dbcode = 1 AND b.currency_1 <> 0 AND coalesce(b.code, 0) <> 0)`
      + ` WHERE ${own} AND ${s}.ac_balance.code = ${control}`);
    await q("GST control closing", `UPDATE ${s}.ac_balance SET closing = opening + debit - credit WHERE code = ${control}`);
  }

  // The sundry debtors' and creditors' accounts take the total of their parties' debit and credit.
  for (const [book, style] of [[2, "SD"], [3, "SC"]] as const) {
    const total = (await rows<{ o: unknown; d: unknown; c: unknown }>(ctx, `Totals of book ${book}`,
      `SELECT sum(opening) AS o, sum(debit) AS d, sum(credit) AS c FROM ${s}.ac_balance WHERE a_recflag = 'AC' AND year_id = '${y}' AND code IN (SELECT code FROM ${s}.account WHERE book = ${book} AND a_pos <> 'D')`))[0];
    const o = numOrNull(total?.o); const d = numOrNull(total?.d); const c = numOrNull(total?.c);
    if (o !== null && d !== null && c !== null) await q(`Totals of ${style}`, `UPDATE ${s}.ac_balance SET opening = ${o}, debit = ${d}, credit = ${c} WHERE code IN (SELECT code FROM ${s}.account WHERE ac_opensty = '${style}')`);
  }
  await q("Closing of the year", `UPDATE ${s}.ac_balance SET closing = opening + debit - credit WHERE year_id = '${y}'`);

  // LEDGER_POST: the accounts, the tax accounts, the product accounts, the slab accounts and the books.
  const post = (step: string, select: string) => q(step, `INSERT INTO ${s}.ledger_post (led_id, post_code, post_date, post_bookcd, post_amt, post_dbcode, post_book, year_id) ${select}`);
  await post("Posting of the accounts", `SELECT led_key, code, doc_date, book_code, amount, ac_dbcode, book, year_id FROM ${s}.ledger l WHERE ${entry("l")} AND year_id = '${y}' AND coalesce(code, 0) <> 0`);
  const taxJoin = `FROM ${s}.ledger led LEFT JOIN ${s}.ledger_ext ledext ON ledext.led_id = led.led_key LEFT JOIN ${s}.tax_master taxmst ON taxmst.tax_rec = ledext.tax_id LEFT JOIN ${s}.slab_master slabmst ON slabmst.slab_key = ledext.slab_id`;
  const taxWhere = `${entry("led")} AND led.year_id = '${y}' AND coalesce(ledext.tax_id, 0) > 0 AND taxmst.tax_accode IS NOT NULL AND taxmst.tax_accode > 0 AND taxmst.tax_pos <> 'D' AND coalesce(led.code, 0) <> 0`;
  await post("Posting of the tax accounts", `SELECT led.led_key, taxmst.tax_accode, led.doc_date, led.book_code, ledext.slab_amt::numeric, (CASE WHEN slabmst.slab_mathop = 'L' OR ledext.slab_amt::numeric < 0 THEN led.ac_dbcode ELSE led.bk_dbcode END), led.book, led.year_id ${taxJoin} WHERE ${taxWhere} AND (led.rev_charge = 'N' OR coalesce(led.rev_charge, '') = '')`);
  for (const book of [15, 10]) await post(`Posting of the tax accounts, reverse charge, book ${book}`, `SELECT led.led_key, taxmst.tax_accode, led.doc_date, led.book_code, ledext.slab_amt::numeric, led.ac_dbcode, led.book, led.year_id ${taxJoin} WHERE ${taxWhere} AND led.rev_charge = 'Y' AND led.book = ${book}`);
  if (control > 0) {
    for (const book of [15, 10]) {
      await post(`Posting of the GST control account, book ${book}`,
        `SELECT led.led_key, ${control}, led.doc_date, led.book_code, (CASE WHEN idopt.opt_desc = 'IGST' THEN ledext.slab_amt::numeric ELSE ledext.slab_amt::numeric * 2 END), led.bk_dbcode, led.book, led.year_id ${taxJoin}`
        + ` LEFT JOIN ${s}.idopt_master idopt ON taxmst.tax_type = idopt.idopt_key::text WHERE ${taxWhere} AND slabmst.slab_link = 0 AND led.rev_charge = 'Y' AND led.book = ${book}`);
    }
  }
  // The tax accounts' debit and credit from the tax lines.
  const taxTotal = (direct: number, reverse: number) => `coalesce((SELECT sum(ledext.slab_amt::numeric) FROM ${s}.ledger_ext ledext LEFT JOIN ${s}.tax_master taxmst ON taxmst.tax_rec = ledext.tax_id LEFT JOIN ${s}.ledger led ON led.led_key = ledext.led_id`
    + ` WHERE coalesce(ledext.tax_id, 0) > 0 AND taxmst.tax_accode IS NOT NULL AND taxmst.tax_accode > 0 AND taxmst.tax_pos <> 'D' AND led.doc_pos <> 'D' AND led.bk_dbcode = (CASE WHEN led.rev_charge = 'Y' THEN ${reverse} ELSE ${direct} END) AND taxmst.tax_accode = ${s}.ac_balance.code), 0)`;
  const taxAccounts = `${s}.ac_balance.code IN (SELECT tax_accode FROM ${s}.tax_master WHERE tax_pos <> 'D' AND tax_accode IS NOT NULL AND tax_accode > 0)`;
  await q("Tax accounts debit", `UPDATE ${s}.ac_balance SET debit = debit + ${taxTotal(1, 2)} WHERE ${own} AND ${taxAccounts}`);
  await q("Tax accounts credit", `UPDATE ${s}.ac_balance SET credit = credit + ${taxTotal(2, 1)} WHERE ${own} AND ${taxAccounts}`);
  await q("Tax accounts closing", `UPDATE ${s}.ac_balance SET closing = opening + debit - credit WHERE year_id = '${y}' AND code IN (SELECT tax_accode FROM ${s}.tax_master WHERE tax_pos <> 'D' AND tax_accode > 0 AND tax_accode IS NOT NULL)`);

  if (ctx.prodAcPost) {
    await post("Posting of the product accounts", `SELECT prodled.led_id, prodmst.s_code, led.doc_date, led.book_code, prodled.il_value, led.bk_dbcode, led.book, led.year_id FROM ${s}.prod_ledger prodled LEFT JOIN ${s}.ledger led ON led.led_key = prodled.led_id LEFT JOIN ${s}.product_master prodmst ON prodmst.prod_key = prodled.prod_id`
      + ` WHERE prodled.process_id IS NULL AND prodmst.s_code IS NOT NULL AND prodmst.s_code > 0 AND prodmst.prod_pos <> 'D' AND prodled.il_value > 0 AND led.doc_date >= '${f}' AND led.doc_date <= '${t}' AND led.doc_pos <> 'D' AND led.doc_posting = 'P' AND led.book <> 19 AND led.full_docno <> 'Auto/999999' AND led.year_id = '${y}' AND coalesce(led.code, 0) <> 0`);
  }
  await post("Posting of the slab accounts",
    `SELECT led.led_key, slabmst.slab_accode, led.doc_date, led.book_code, ledext.slab_amt::numeric, (CASE WHEN slabmst.slab_mathop = 'L' OR ledext.slab_amt::numeric < 0 THEN led.ac_dbcode ELSE led.bk_dbcode END), led.book, led.year_id`
    + ` FROM ${s}.ledger led LEFT JOIN ${s}.ledger_ext ledext ON ledext.led_id = led.led_key LEFT JOIN ${s}.slab_master slabmst ON slabmst.slab_key = ledext.slab_id`
    + ` WHERE ${entry("led")} AND led.year_id = '${y}' AND ledext.il_id IS NULL AND slabmst.slab_accode IS NOT NULL AND slabmst.slab_accode > 0 AND slabmst.slab_active = 'Y' AND coalesce(led.code, 0) <> 0`);

  if (ctx.prodAcPost) {
    for (const [column, nature] of [["debit", "A"], ["credit", "L"]] as const) {
      await q(`Product accounts ${column}`,
        `UPDATE ${s}.ac_balance acbal SET ${column} = acbal.${column} + coalesce((SELECT sum(prodled.il_value) FROM ${s}.prod_ledger prodled LEFT JOIN ${s}.product_master prodmst ON prodmst.prod_key = prodled.prod_id`
        + ` WHERE prodled.process_id IS NULL AND prodmst.s_code IS NOT NULL AND prodmst.s_code = acbal.code AND prodmst.prod_pos <> 'D' AND prodled.il_value > 0 AND prodled.il_pos <> 'D' AND prodled.stock_nat = '${nature}' AND prodled.il_date >= '${f}' AND prodled.il_date <= '${t}'), 0)`
        + ` WHERE acbal.a_recflag = 'AC' AND acbal.year_id = '${y}' AND acbal.code IN (SELECT s_code FROM ${s}.product_master WHERE prod_pos <> 'D' AND s_code IS NOT NULL AND s_code > 0)`);
    }
  }
  // The slab accounts' debit and credit: the posted ones (slab_mathop other than U) by the side they were posted on, the U ones by the voucher's book side.
  const slabTotal = (condition: string, posted: boolean) => `coalesce((SELECT sum(ledext.slab_amt::numeric) FROM ${s}.ledger_ext ledext LEFT JOIN ${s}.slab_master slabmst ON slabmst.slab_key = ledext.slab_id LEFT JOIN ${s}.ledger led ON led.led_key = ledext.led_id`
    + `${posted ? ` LEFT JOIN ${s}.ledger_post ledpost ON led.led_key = ledpost.led_id` : ""}`
    + ` WHERE ledext.il_id IS NULL AND slabmst.slab_accode IS NOT NULL AND slabmst.slab_accode > 0 AND slabmst.slab_active = 'Y' AND led.doc_pos <> 'D' AND ${condition} AND slabmst.slab_accode = ${s}.ac_balance.code), 0)`;
  const slabAccounts = (mathop: string) => `${s}.ac_balance.code IN (SELECT slab_accode FROM ${s}.slab_master WHERE slab_active = 'Y' AND slab_mathop ${mathop} 'U')`;
  await q("Slab accounts debit", `UPDATE ${s}.ac_balance SET debit = debit + ${slabTotal("slabmst.slab_mathop <> 'U' AND ledpost.post_dbcode = 1 AND slabmst.slab_accode = ledpost.post_code", true)} WHERE ${own} AND ${slabAccounts("<>")}`);
  await q("Slab accounts credit", `UPDATE ${s}.ac_balance SET credit = credit + ${slabTotal("slabmst.slab_mathop <> 'U' AND ledpost.post_dbcode = 2 AND slabmst.slab_accode = ledpost.post_code", true)} WHERE ${own} AND ${slabAccounts("<>")}`);
  await q("Slab accounts credit (U)", `UPDATE ${s}.ac_balance SET credit = credit + ${slabTotal("slabmst.slab_mathop = 'U' AND led.bk_dbcode = 2 AND (ledext.slab_amt::numeric < 0 OR ledext.slab_amt::numeric > 0)", false)} WHERE ${own} AND ${slabAccounts("=")}`);
  await q("Slab accounts debit (U)", `UPDATE ${s}.ac_balance SET debit = debit + ${slabTotal("slabmst.slab_mathop = 'U' AND led.bk_dbcode = 1 AND (ledext.slab_amt::numeric > 0 OR ledext.slab_amt::numeric < 0)", false)} WHERE ${own} AND ${slabAccounts("=")}`);
  await q("Product accounts closing", `UPDATE ${s}.ac_balance SET closing = opening + debit - credit WHERE year_id = '${y}' AND code IN (SELECT s_code FROM ${s}.product_master WHERE prod_pos <> 'D' AND s_code > 0 AND s_code IS NOT NULL)`);
  await q("Slab accounts closing", `UPDATE ${s}.ac_balance SET closing = opening + debit - credit WHERE year_id = '${y}' AND code IN (SELECT slab_accode FROM ${s}.slab_master WHERE slab_active = 'Y' AND slab_accode > 0 AND slab_accode IS NOT NULL)`);

  // The books: an expense posting book (POST_BKCODE) where there is one, the voucher's own book otherwise.
  await post("Posting of the books, reverse charge expense",
    `SELECT led_key, (CASE WHEN coalesce(post_bkcode, 0) = 0 THEN book_code ELSE post_bkcode END), doc_date, book_code, amount - (CASE WHEN coalesce(post_bkcode, 0) = 0 THEN currency_1 ELSE 0 END), bk_dbcode, book, year_id FROM ${s}.ledger l`
    + ` WHERE ${entry("l")} AND book <> 19 AND year_id = '${y}' AND book IN (10, 15) AND rev_charge = 'Y' AND coalesce(code, 0) <> 0`);
  await post("Posting of the books",
    `SELECT led_key, (CASE WHEN coalesce(post_bkcode, 0) = 0 THEN book_code ELSE post_bkcode END), doc_date, book_code, amount - currency_1, bk_dbcode, book, year_id FROM ${s}.ledger l`
    + ` WHERE ${entry("l")} AND book <> 19 AND year_id = '${y}' AND (rev_charge = 'N' OR coalesce(rev_charge, '') = '') AND coalesce(code, 0) <> 0`);
  await q("Posting amounts positive", `UPDATE ${s}.ledger_post SET post_amt = abs(post_amt) WHERE post_amt < 0`);
  await q("Tax percent of the lines", `UPDATE ${s}.ledger_ext ledext SET slab_perc = taxmast.tax_perc FROM ${s}.tax_master taxmast WHERE ledext.tax_id = taxmast.tax_rec AND ledext.slab_perc::numeric IS DISTINCT FROM taxmast.tax_perc::numeric`);

  // One addon row, one interest row for each account: the others go (the first of each stays).
  await q("Duplicate addon rows", `DELETE FROM ${s}.addon_data WHERE aon_key IN (SELECT aon_key FROM (SELECT aon_key, row_number() OVER (PARTITION BY code ORDER BY aon_key) AS n FROM ${s}.addon_data WHERE code > 0) x WHERE n > 1)`);
  await q("Duplicate interest rows", `DELETE FROM ${s}.int_master WHERE interest_key IN (SELECT interest_key FROM (SELECT interest_key, row_number() OVER (PARTITION BY code ORDER BY interest_key) AS n FROM ${s}.int_master WHERE code > 0) x WHERE n > 1)`);
}
