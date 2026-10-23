import type { TransferContext } from "./context";
import { q } from "./context";

/** SP_TRANSFER_DATA, @bit_account = 1: this year's opening balances from last year's closing (balance sheet accounts, closing stock, and the P&L accounts' last-year figure). */
export async function transferAccounts(ctx: TransferContext): Promise<void> {
  const { sch: s, o, licence, opt } = ctx;
  ctx.log("Account opening");
  const tj = licence === 14 && !s.toUpperCase().includes("TJAC_");

  if (tj) await q(ctx, "Opening cleared (TJ)", `UPDATE ${s}.ac_balance SET opening = 0, last_year = 0 WHERE coalesce(code, 0) IN (SELECT coalesce(code, 0) FROM ${s}.account WHERE book <> 2)`);
  else if (!opt.ignoreAccountManual) await q(ctx, "Opening cleared", `UPDATE ${s}.ac_balance SET opening = 0, last_year = 0, trf_opening = 0 WHERE opening = coalesce(trf_opening, 0)`);
  else await q(ctx, "Opening cleared, manual too", `UPDATE ${s}.ac_balance SET opening = 0, last_year = 0, trf_opening = 0`);

  // The local code of the party addresses (the message of last year's account).
  const localCode = async (book: number, own: boolean) => {
    await q(ctx, `Local code cleared (book ${book})`, `UPDATE ${s}.address SET local_code = '' WHERE coalesce(code, 0) IN (SELECT coalesce(code, 0) FROM ${s}.account WHERE book = ${book} AND a_pos <> 'D')`);
    if (own) await q(ctx, `Local code of last year (book ${book})`, `UPDATE ${s}.address addr SET local_code = btrim(ac1.message) FROM ${s}.account ac, ${o}.account ac1 WHERE ac.code = addr.code AND ac1.name = ac.name AND ac.book = ${book} AND ac.a_pos <> 'D' AND ac1.book = ${book} AND ac1.a_pos <> 'D' AND ac1.message IS NOT NULL`);
    else await q(ctx, `Local code of last year (book ${book})`, `UPDATE ${s}.address addr SET local_code = btrim(ac.message) FROM ${o}.account ac WHERE ac.code = addr.code AND ac.book = ${book} AND ac.a_pos <> 'D' AND ac.message IS NOT NULL`);
  };
  if ([3, 5, 11, 29, 32, 49, 73].includes(licence)) await localCode(2, licence === 5 || licence === 49);
  if ([5, 29, 32, 49].includes(licence)) await localCode(3, licence === 5 || licence === 49);

  // Balance sheet items: last year's closing is the opening (asset and liability groups, 08 and above).
  const lastYear = `JOIN ${o}.account ac1 ON ac1.name = ac.name AND ac1.book = ac.book AND ac1.a_pos <> 'D' AND ac1.a_lastdate IS NULL LEFT JOIN ${o}.ac_balance acbal1 ON ac1.code = acbal1.code AND acbal1.a_recflag = 'AC'`;
  const manual = opt.ignoreAccountManual ? "" : " AND acbal.opening = coalesce(acbal.trf_opening, 0)";
  await q(ctx, "Opening of the balance sheet items",
    `UPDATE ${s}.ac_balance acbal SET opening = acbal1.closing, trf_opening = acbal1.closing FROM ${s}.account ac JOIN ${s}.balsheet bs ON bs.bs_key = ac.bs_id ${lastYear}`
    + ` WHERE ac.code = acbal.code AND acbal.a_recflag = 'AC' AND ac1.a_pos <> 'D' AND ac.a_pos <> 'D' AND left(bs.bs_code, 2) > '07'${tj ? " AND ac.book <> 2 AND ac1.book <> 2" : ""}${manual}`);

  // Closing stock.
  await q(ctx, "Opening of the closing stock",
    `UPDATE ${s}.ac_balance acbal SET opening = acbal1.os_billdiff, last_year = acbal1.os_billdiff, trf_opening = acbal1.os_billdiff FROM ${s}.account ac ${lastYear}`
    + ` WHERE ac.code = acbal.code AND acbal.a_recflag = 'AC' AND ac1.a_pos <> 'D' AND ac.a_pos <> 'D' AND ac.ac_opensty = 'CB' AND ac1.ac_opensty = 'CB'${manual}`);
  await q(ctx, "Closing from opening", `UPDATE ${s}.ac_balance SET closing = opening + debit - credit`);

  // The profit and loss accounts keep last year's closing as the last-year figure (groups below 06).
  await q(ctx, "Last year of the profit and loss accounts",
    `UPDATE ${s}.ac_balance acbal SET last_year = acbal1.closing FROM ${s}.account ac JOIN ${s}.balsheet bs ON bs.bs_key = ac.bs_id ${lastYear}`
    + ` WHERE ac.code = acbal.code AND acbal.a_recflag = 'AC' AND ac1.a_pos <> 'D' AND ac.a_pos <> 'D' AND left(bs.bs_code, 2) < '06'`);

  // The year-ending journal of last year is taken out of the last-year figure of the profit and loss accounts.
  await q(ctx, "Year ending journal of last year",
    `UPDATE ${s}.ac_balance acbal SET last_year = (lyled.amount * (CASE WHEN lyled.ac_dbcode = 1 THEN 1 ELSE -1 END)) * -1 FROM ${s}.account ac, ${o}.account lyac, ${o}.ledger lyled`
    + ` WHERE ac.code = acbal.code AND lyac.name = ac.name AND lyac.book = ac.book AND lyac.a_pos <> 'D' AND lyac.code = lyled.code`
    + ` AND lyled.doc_pos = 'A' AND left(ltrim(lyled.doc_no1), 4) = 'END-' AND lyled.book = 19 AND lyled.doc_date BETWEEN '${ctx.ly1}' AND '${ctx.ly2}'`
    + ` AND coalesce(lyled.code, 0) IN (SELECT coalesce(lac.code, 0) FROM ${o}.account lac LEFT JOIN ${o}.balsheet lbs ON lbs.bs_key = lac.bs_id WHERE left(lbs.bs_code, 2) < '06')`);

  await q(ctx, "Opening blank", `UPDATE ${s}.ac_balance SET opening = 0 WHERE opening IS NULL`);
  await q(ctx, "Last year blank", `UPDATE ${s}.ac_balance SET last_year = 0 WHERE last_year IS NULL`);
}
