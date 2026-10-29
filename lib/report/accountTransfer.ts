import type { Client } from "pg";
import type { Loader } from "../master-program/load";
import type { MasterSession } from "../master-program/session";
import { toText } from "../master-program/legacy";
import { ReportRefusal } from "./generate";
import type { ReportPlan } from "./generate";
import { runReportSql } from "./run";
import { repostData } from "../utility/repost";

/**
 * 59: ENTRY ACCOUNT TRANSFER (REPORT_ENTRY_ACCOUNT_TRANSFER, SP_REPORT_FORMATING branch 59; TRANSACTION > Auto Entry > Entry Account Transfer). Not a
 * report: it moves the entries of the first account (Account From, one only) to the second (Account Upto, one only) for the dates chosen, in every table
 * that holds an account's entries (ledger, product ledger, postings, outstanding, the logs, the processes, the addon entries, and the narration rows of
 * licence 46). When the dates are the whole year it also adds the first account's opening to the second's, marks the first as deleted (A_POS D, merged
 * into the second through COMB_CODE) and removes its balance, addon data, interest master and party rates; then (not licence 46) the account postings
 * are re-posted (SP_REPOST_DATA, Account block only). The desktop shows the procedure's message as a box titled SUCCESS and closes the screen.
 *
 * The screen's transaction cannot write, so planAccountTransfer only checks the selection and builds the statements; runAccountTransfer does them in a
 * transaction of their own. The web adds one check the procedure does not have: both accounts the same would mark the account deleted and double its
 * opening, so it is refused.
 */

export type TransferStatement = Readonly<{ step: string; sql: string; params: unknown[] }>;
export type AccountTransferPlan = Readonly<{ from: number; to: number; fromName: string; toName: string; wholeYear: boolean; licence: number; repost: "account" | "product" | "none"; message?: string; summary?: string; statements: readonly TransferStatement[] }>;

/** The report the route treats as this action. */
export const ACCOUNT_TRANSFER_REPORT = "REPORT_ENTRY_ACCOUNT_TRANSFER";

const failure = (message: string) => new ReportRefusal(message, "Entry Transfer");
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The single key of a ticked list "(123)"; the procedure's checks on @var_select_key5 / @var_select_bookkey. */
function singleKey(list: string, missing: string, what = "PARTY"): number {
  const cleaned = list.replace(/[()]/g, "").trim();
  if (cleaned === "") throw failure(missing);
  if (cleaned.includes(",")) throw failure(`ONLY SINGLE ${what} SELECTION ALLOWED`);
  const key = Number(cleaned);
  if (!Number.isInteger(key) || key <= 0) throw failure(missing);
  return key;
}

export async function planAccountTransfer(loader: Loader, plan: ReportPlan): Promise<AccountTransferPlan> {
  const { call } = plan;
  const db = call.database;
  const from = singleKey(call.selectKey[4], "FROM PARTY SELECTION NOT DONE");
  const to = singleKey(call.selectBookKey, "UPTO PARTY SELECTION NOT DONE");
  if (from === to) throw failure("FROM AND UPTO PARTY CAN NOT BE SAME");
  const accounts = (await runReportSql(loader, `SELECT code, name, a_pos, book FROM ${db}account WHERE code IN ($1, $2)`, [from, to])).rows;
  const fromRow = accounts.find((row) => Number(row.code) === from);
  const toRow = accounts.find((row) => Number(row.code) === to);
  if (!fromRow || !toRow) throw failure("SELECTED ACCOUNT IS NOT FOUND");
  if (toText(toRow.a_pos).toUpperCase() === "D") throw failure("UPTO PARTY IS A DELETED ACCOUNT");
  // Web rule: accounts of two different books (debtors into creditors, a bank into a party) are not merged.
  if (Number(fromRow.book) !== Number(toRow.book)) throw failure("FROM AND UPTO PARTY MUST BE OF THE SAME BOOK");

  const wholeYear = isoDay(call.from) === isoDay(call.tarikh1) && isoDay(call.upto) === isoDay(call.tarikh2);
  const dateFrom = isoDay(call.from);
  const dateUpto = isoDay(call.upto);
  // Whole year: everything up to the Upto date; else the days between From and Upto.
  const dated = (column: string, accountColumn: string) => wholeYear
    ? { where: `${accountColumn} = $1 AND ${column} <= $2::date`, params: [from, dateUpto] }
    : { where: `${accountColumn} = $1 AND ${column} BETWEEN $2::date AND $3::date`, params: [from, dateFrom, dateUpto] };
  const move = (step: string, table: string, setColumn: string, accountColumn: string, dateColumn: string): TransferStatement => {
    const { where, params } = dated(dateColumn, accountColumn);
    return { step, sql: `UPDATE ${db}${table} SET ${setColumn} = $${params.length + 1} WHERE ${where}`, params: [...params, to] };
  };
  const statements: TransferStatement[] = [
    move("Ledger", "ledger", "code", "code", "doc_date"),
    move("Product ledger", "prod_ledger", "code", "code", "il_date"),
    move("Ledger posting", "ledger_post", "post_code", "post_code", "post_date"),
    move("Outstanding", "outclear", "code", "code", "out_date"),
    move("Ledger log", "log_ledger", "lled_code", "lled_code", "lled_docdate"),
    move("Register log", "log_regtrn", "lreg_code", "lreg_code", "lreg_date"),
    move("Process", "process", "code", "code", "p_date"),
  ];
  // The addon entries of the moved ledger lines and of the moved processes.
  for (const [step, column, table, key, dateColumn] of [["Addon entries of the ledger", "aona_ledid", "ledger", "led_key", "doc_date"], ["Addon entries of the processes", "aona_processid", "process", "process_key", "p_date"]] as const) {
    const { where, params } = dated(dateColumn, "code");
    statements.push({ step, sql: `UPDATE ${db}addon_aentry SET aona_accode = $${params.length + 1} WHERE aona_accode = $1 AND ${column} IN (SELECT ${key} FROM ${db}${table} WHERE ${where})`, params: [...params, to] });
  }
  if (call.licence === 46) statements.push(move("Narration", "narration", "narr_accode", "narr_accode", "narr_fromdt"));
  if (wholeYear) {
    statements.push(
      { step: "Opening balance", sql: `UPDATE ${db}ac_balance b SET opening = (b.opening::numeric + coalesce((SELECT a.opening::numeric FROM ${db}ac_balance a WHERE a.code = $1 LIMIT 1), 0))::money WHERE b.code = $2`, params: [from, to] },
      { step: "Account marked deleted", sql: `UPDATE ${db}account SET a_pos = 'D', comb_code = $2 WHERE code = $1`, params: [from, to] },
      { step: "Balance of the account", sql: `DELETE FROM ${db}ac_balance WHERE code = $1`, params: [from] },
      { step: "Addon data of the account", sql: `DELETE FROM ${db}addon_data WHERE code = $1`, params: [from] },
      { step: "Interest master of the account", sql: `DELETE FROM ${db}int_master WHERE code = $1`, params: [from] },
      { step: "Party rates of the account", sql: `DELETE FROM ${db}party_rate WHERE pr_accode = $1`, params: [from] },
    );
  }
  return { from, to, fromName: toText(fromRow.name).trim(), toName: toText(toRow.name).trim(), wholeYear, licence: call.licence, repost: "account", statements };
}

export const PRODUCT_TRANSFER_REPORT = "REPORT_ENTRY_PRODUCT_TRANSFER";

/**
 * 60: ENTRY PRODUCT TRANSFER (REPORT_ENTRY_PRODUCT_TRANSFER, SP_FRT_RPT_ENTRY_PTOD_TRF; TRANSACTION > Auto Entry > Entry Product Transfer). The same
 * action for products: the product lines (and the billed description with them), the addon entries and the register log of Product From move to Product
 * Upto for the dates; the whole year also adds the opening quantities (prod_balance RP rows, and GW rows per godown) to Product Upto, marks Product From
 * deleted (PROD_POS D, P_CODE) and deletes its balances, addon data, price list and party rates. Then SP_REPOST_DATA runs its Product block. The web
 * refuses the same product twice, as for accounts.
 */
export async function planProductTransfer(loader: Loader, plan: ReportPlan): Promise<AccountTransferPlan> {
  const { call } = plan;
  const db = call.database;
  const from = singleKey(call.selectKey[4], "FROM PRODUCT SELECTION NOT DONE", "PRODUCT");
  const to = singleKey(call.selectBookKey, "UPTO PRODUCT SELECTION NOT DONE", "PRODUCT");
  if (from === to) throw failure("FROM AND UPTO PRODUCT CAN NOT BE SAME");
  const products = (await runReportSql(loader, `SELECT prod_key, prod_desc, prod_pos FROM ${db}product_master WHERE prod_key IN ($1, $2)`, [from, to])).rows;
  const fromRow = products.find((row) => Number(row.prod_key) === from);
  const toRow = products.find((row) => Number(row.prod_key) === to);
  if (!fromRow || !toRow) throw failure("SELECTED PRODUCT IS NOT FOUND");
  if (toText(toRow.prod_pos).toUpperCase() === "D") throw failure("UPTO PRODUCT IS A DELETED PRODUCT");
  const wholeYear = isoDay(call.from) === isoDay(call.tarikh1) && isoDay(call.upto) === isoDay(call.tarikh2);
  const dateFrom = isoDay(call.from);
  const dateUpto = isoDay(call.upto);
  const where = (column: string, dateColumn: string) => wholeYear
    ? { sql: `${column} = $1 AND ${dateColumn} <= $2::date`, params: [from, dateUpto] }
    : { sql: `${column} = $1 AND ${dateColumn} BETWEEN $2::date AND $3::date`, params: [from, dateFrom, dateUpto] };
  const statements: TransferStatement[] = [];
  const prodLedger = where("prod_id", "il_date");
  statements.push({ step: "Product ledger", sql: `UPDATE ${db}prod_ledger SET prod_id = $${prodLedger.params.length + 1}, il_billdesc = $${prodLedger.params.length + 2} WHERE ${prodLedger.sql}`, params: [...prodLedger.params, to, toText(toRow.prod_desc)] });
  const addon = where("aoni_prodid", "aoni_date");
  statements.push({ step: "Addon entries", sql: `UPDATE ${db}addon_ientry SET aoni_prodid = $${addon.params.length + 1} WHERE ${addon.sql}`, params: [...addon.params, to] });
  const log = where("lreg_prodid", "lreg_date");
  statements.push({ step: "Register log", sql: `UPDATE ${db}log_regtrn SET lreg_prodid = $${log.params.length + 1} WHERE ${log.sql}`, params: [...log.params, to] });
  if (wholeYear) {
    const columns = ["open_pcs", "open_pack", "open_weight", "open_qty1", "open_qty2", "open_qty3", "open_stk"];
    for (const flag of ["RP", "GW"]) {
      // GW rows are per godown (I_PARACD); the RP row has one per product.
      const sameGodown = flag === "GW" ? " AND a.i_paracd = b.i_paracd" : "";
      const sets = columns.map((column) => `${column} = b.${column} + coalesce((SELECT a.${column} FROM ${db}prod_balance a WHERE a.prec_flag = $3 AND a.prod_id = $1${sameGodown} LIMIT 1), 0)`).join(", ");
      statements.push({ step: `Opening quantities (${flag})`, sql: `UPDATE ${db}prod_balance b SET ${sets} WHERE b.prec_flag = $3 AND b.prod_id = $2`, params: [from, to, flag] });
    }
    statements.push(
      { step: "Product marked deleted", sql: `UPDATE ${db}product_master SET prod_pos = 'D', p_code = $2 WHERE prod_key = $1`, params: [from, to] },
      { step: "Balances of the product", sql: `DELETE FROM ${db}prod_balance WHERE prod_id = $1`, params: [from] },
      { step: "Addon data of the product", sql: `DELETE FROM ${db}addon_data WHERE prod_id = $1`, params: [from] },
      { step: "Price list of the product", sql: `DELETE FROM ${db}pricelist WHERE prod_id = $1`, params: [from] },
      { step: "Party rates of the product", sql: `DELETE FROM ${db}party_rate WHERE pr_prodid = $1`, params: [from] },
    );
  }
  return { from, to, fromName: toText(fromRow.prod_desc).trim(), toName: toText(toRow.prod_desc).trim(), wholeYear, licence: call.licence, repost: "product", statements };
}

/** Does the transfer in a transaction of its own, then the account re-post (SP_REPOST_DATA, Account block); a failed statement takes it all back. */
export async function runAccountTransfer(client: Client, session: MasterSession, transfer: AccountTransferPlan): Promise<{ message: string; moved: string[] }> {
  const moved: string[] = [];
  for (const statement of transfer.statements) {
    try {
      const result = await client.query(statement.sql, statement.params);
      if ((result.rowCount ?? 0) > 0 && !statement.sql.startsWith("DELETE")) moved.push(`${statement.step}: ${result.rowCount}`);
    } catch (error) {
      throw new Error(`Entry Account Transfer stopped at "${statement.step}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (transfer.repost === "none") return { message: transfer.message ?? "DONE", moved };
  if (transfer.repost === "product") await repostData(client, session, { account: false, outstanding: false, productRecalc: false, product: true, verify: false });
  else if (transfer.licence !== 46) await repostData(client, session, { account: true, outstanding: false, productRecalc: false, product: false, verify: false });
  return { message: transfer.repost === "product" ? "SELECTED PRODUCT ENTRY TRANSFER DONE" : "SELECTED ACCOUNT ENTRY TRANSFER DONE", moved };
}

export const VOUCHER_RENUMBER_REPORT = "UTILITY_VOUCHER_RENUMBER";

/**
 * 61: VOUCHER RENUMBER (UTILITY_VOUCHER_RENUMBER, SP_FRT_RPT_VOUCHER_RENUMBER; UTILITY > Voucher Renumber). Numbers the vouchers of one book (the first combo
 * is the book's account) and series from the first date to the last, in date order, one after the other: from 1 when the dates start with the year, else
 * after the highest number before the first date. A book that is not a book of accounts (BOOK_ACTUAL N) renumbers its stock processes instead. Posted
 * vouchers only (DOC_POS A, DOC_POSTING P, not Auto/999999). Lines of one voucher (UNIQUE_KEY) share a number. The numbers are worked out here, then
 * written in one statement a table.
 * Web differences from the procedure: the highest number before the first date is the numeric maximum (the procedure takes a text maximum); an expense
 * book of licence 21 writes DOC_NO, so it reads DOC_NO for that maximum (the procedure reads DOC_NO1 and so restarts from a stale number); the
 * series must be one series, not All (the procedure would renumber series blank); ties on the date are taken in entry order (LED_KEY).
 */
export async function planVoucherRenumber(loader: Loader, plan: ReportPlan): Promise<AccountTransferPlan> {
  const { call } = plan;
  const db = call.database;
  const series = call.seriesText.trim();
  if (series === "" || series.toLowerCase() === "all") throw failure("SELECT A SINGLE SERIES TO RENUMBER");
  const book = (await runReportSql(loader, `SELECT book_actual, coalesce(stkm_forbook, 0) AS stkm FROM ${db}book_properties WHERE btrim(book_desc) = btrim($1) LIMIT 1`, [call.fcText])).rows[0];
  const bookActual = toText(book?.book_actual).trim();
  const stockBook = Number(book?.stkm ?? 0);
  const ledgerBook = bookActual.toUpperCase() === "Y" || bookActual === "";
  const expense = call.fcText.includes("EXPENSE");
  const midYear = isoDay(call.tarikh1) !== isoDay(call.from);
  const dateFrom = isoDay(call.from);
  const dateUpto = isoDay(call.upto);
  const numberOf = (column: string) => `max(nullif(regexp_replace(btrim(${column}), '[^0-9]', '', 'g'), '')::bigint)`;

  let last = 0;
  if (midYear) {
    const before = ledgerBook
      ? await runReportSql(loader, `SELECT ${numberOf(expense && call.licence !== 21 ? "doc_no1" : "doc_no")} AS n FROM ${db}ledger WHERE rtrim(doc_series) = $1 AND full_docno <> 'Auto/999999' AND doc_pos = 'A' AND doc_posting = 'P' AND doc_date < $2::date`, [series, dateFrom])
      : await runReportSql(loader, `SELECT ${numberOf("doc_no2")} AS n FROM ${db}process WHERE rtrim(p_docseries) = $1 AND il_pos = 'A' AND p_date < $2::date AND book = $3`, [series, dateFrom, stockBook]);
    last = Number(before.rows[0]?.n ?? 0) || 0;
  }
  const first = last + 1;
  const statements: TransferStatement[] = [];
  let count = 0;
  const pad = "lpad(v.n::text, 10)";
  const unnest = "FROM (SELECT unnest($2::int[]) AS k, unnest($3::int[]) AS n, $1::text AS s) v";
  const full = "v.s || '/' || v.n::text";
  if (ledgerBook) {
    const rows = (await runReportSql(loader, `SELECT led_key, unique_key FROM ${db}ledger WHERE book_code = $1 AND doc_pos = 'A' AND rtrim(doc_series) = $2 AND full_docno <> 'Auto/999999' AND doc_posting = 'P' AND doc_date BETWEEN $3::date AND $4::date ORDER BY doc_date, led_key`, [call.fcValue, series, dateFrom, dateUpto])).rows;
    if (rows.length === 0) throw failure("NO VOUCHERS FOUND TO RENUMBER");
    const ledKeys: number[] = [];
    const ledNumbers: number[] = [];
    const uniqueNumber = new Map<number, number>();
    let previous = 0;
    let number = last;
    for (const row of rows) {
      const unique = Number(row.unique_key ?? 0);
      if (expense || previous !== unique) number += 1;
      previous = unique;
      ledKeys.push(Number(row.led_key));
      ledNumbers.push(number);
      uniqueNumber.set(unique, number);
    }
    count = expense ? rows.length : uniqueNumber.size;
    last = number;
    const byLed = [ledKeys, ledNumbers];
    if (expense) {
      const column = call.licence === 21 ? "doc_no" : "doc_no1";
      statements.push({ step: "Vouchers", sql: `UPDATE ${db}ledger t SET ${column} = ${pad} ${unnest} WHERE t.led_key = v.k`, params: [series, ...byLed] });
      if (call.licence === 21) {
        statements.push({ step: "Product lines", sql: `UPDATE ${db}prod_ledger t SET full_docno = ${full} ${unnest} WHERE t.led_id = v.k`, params: [series, ...byLed] });
        statements.push({ step: "Outstanding", sql: `UPDATE ${db}outclear t SET out_fulldocno = ${full} ${unnest} WHERE t.out_ledid = v.k`, params: [series, ...byLed] });
      }
    } else {
      statements.push({ step: "Vouchers", sql: `UPDATE ${db}ledger t SET doc_no = ${pad}, full_docno = ${full} ${unnest} WHERE t.unique_key = v.k`, params: [series, [...uniqueNumber.keys()], [...uniqueNumber.values()]] });
      statements.push({ step: "Outstanding", sql: `UPDATE ${db}outclear t SET out_fulldocno = ${full} ${unnest} WHERE t.out_ledid = v.k`, params: [series, ...byLed] });
      statements.push({ step: "Product lines", sql: `UPDATE ${db}prod_ledger t SET full_docno = ${full} ${unnest} WHERE t.led_id = v.k`, params: [series, ...byLed] });
      statements.push({ step: "Ledger log", sql: `UPDATE ${db}log_ledger t SET lled_fulldocno = ${full} ${unnest} WHERE t.lled_id = v.k`, params: [series, ...byLed] });
    }
  } else {
    const rows = (await runReportSql(loader, `SELECT process_key FROM ${db}process WHERE book = $1 AND il_pos = 'A' AND rtrim(p_docseries) = $2 AND p_date BETWEEN $3::date AND $4::date ORDER BY p_date, process_key`, [stockBook, series, dateFrom, dateUpto])).rows;
    if (rows.length === 0) throw failure("NO VOUCHERS FOUND TO RENUMBER");
    const keys = rows.map((row) => Number(row.process_key));
    const numbers = rows.map((_row, index) => last + index + 1);
    count = rows.length;
    last += rows.length;
    statements.push({ step: "Processes", sql: `UPDATE ${db}process t SET doc_no2 = ${pad}, full_docno = ${full} ${unnest} WHERE t.process_key = v.k`, params: [series, keys, numbers] });
    statements.push({ step: "Product lines", sql: `UPDATE ${db}prod_ledger t SET doc_no1 = ${pad}, full_docno = ${full} ${unnest} WHERE t.process_id = v.k`, params: [series, keys, numbers] });
  }
  const book_ = call.fcText.trim();
  return { from: first, to: last, fromName: `${book_}  ${series}`, toName: `${count} vouchers numbered ${first} to ${last}`, wholeYear: !midYear, licence: call.licence, repost: "none", message: "VOUCHER RENUMBER DONE", summary: `${book_}  ${series}: ${count} vouchers numbered ${first} to ${last}`, statements };
}
