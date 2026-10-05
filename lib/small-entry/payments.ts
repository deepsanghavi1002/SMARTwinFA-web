import { formatDesktopDate, formatDesktopTime, parseDesktopDate, toInt } from "../master-program/legacy";
import type { Loader } from "../master-program/load";
import type { SysContext } from "./load";
import { cellOf } from "./entrySave";
import type { EntryStatement } from "./entrySave";
import type { EditedRow } from "./types";

/**
 * Small_Entry.Save_Click for the two payment approvals, which write payment vouchers:
 *
 *  - Payment Approved (42): the bills ticked "Yes" are paid party by party (the grid comes
 *    sorted by name). Each bill gets an outclear set-off row and its own set-off goes up;
 *    when the party changes, and at the end, one voucher pays that party's total.
 *  - Payment Manual Approved (47): one voucher for each allotment ticked "Yes", on account
 *    (an outclear row of its own).
 *
 * A voucher is a ledger row on the bank (book 6, Payment, numbered after the book series'
 * highest), its two ledger_post rows, the addon_aentry row, the party debited and the bank
 * credited in ac_balance, a log_ledger row and the LOG_ENTRY record in the big log.
 *
 * As on the desktop, every bill or allotment the grid listed is then cleared, approved or
 * not: 42 sets ledger.form_amt to 0, 47 deletes the pay_allot row. So the save works on the
 * whole grid (saveEntry reloads it), not only the rows the operator touched.
 */

export const PAYMENT_ENTRIES: ReadonlySet<number> = new Set([42, 47]);

/** The column that names a grid row, to lay the operator's edits over the reloaded grid. */
export const PAYMENT_ROW_KEY: Readonly<Record<number, string>> = { 42: "out_key", 47: "pay_allot_key" };

export type PaymentResult = Readonly<{ statements: EntryStatement[]; savedRows: Set<number>; messages: string[] }>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const amountOf = (value: string | undefined) => Number((value ?? "").replace(/,/g, "").trim()) || 0;
/** A money column's value: PostgreSQL adds money only to money. */
const money = (value: number) => `${value.toFixed(4)}::numeric::money`;
const json = (pairs: readonly (readonly [string, string])[]) => `{${pairs.map(([name, value]) => `"${name}": "${value}"`).join(",")}}`;

/** The rows a save works on: the whole grid as it loads now, with the operator's edits laid over it. */
export function overlayEdits(gridRows: readonly Record<string, string>[], edited: readonly EditedRow[], keyColumn: string): EditedRow[] {
  const byKey = new Map(edited.map((row) => [String(toInt(cellOf(row.values, keyColumn))), row]));
  return gridRows.map((values) => {
    const mine = byKey.get(String(toInt(cellOf(values, keyColumn))));
    return mine ? { values: { ...values, ...mine.values }, deleted: mine.deleted } : { values, deleted: false };
  });
}

export async function paymentStatements(loader: Loader, entryId: number, rows: readonly EditedRow[], context: SysContext, now = new Date()): Promise<PaymentResult | null> {
  if (!PAYMENT_ENTRIES.has(entryId)) return null;
  const { session } = loader;
  const schema = session.companySchema;
  const bank = toInt(context.state.firstCombo?.value);
  const bankName = (context.state.firstCombo?.text ?? "").trim();
  const entryDate = quote(formatDesktopDate(parseDesktopDate(context.state.controls.dtp_date ?? "") ?? now));
  const entryDateText = formatDesktopDate(parseDesktopDate(context.state.controls.dtp_date ?? "") ?? now);
  const year = quote(session.yearId);
  const saveDate = quote(formatDesktopDate(now));
  const saveTime = quote(formatDesktopTime(now));
  const statements: EntryStatement[] = [];
  const savedRows = new Set<number>();
  const messages: string[] = [];

  // The bank book's payment series (book_number.bn_dbcode 2) and its next number.
  const series = String((await loader.readTable(`select bn_series from ${schema}.book_number where bn_dbcode=2 and bn_id in (select bs_rec from ${schema}.book_setup where book_code=$1)`, [bank]))?.[0]?.bn_series ?? "");
  const top = Number((await loader.readTable(`select max(nullif(regexp_replace(doc_no, '\\D', '', 'g'), '')::numeric) as top from ${schema}.ledger where book_code=$1 and doc_series=$2 and doc_pos<>'D' and doc_posting='P'`, [bank, series]))?.[0]?.top ?? 0);
  let next = top > 0 ? top + 1 : 1;
  const ticked = rows.some((row) => !row.deleted && (cellOf(row.values, "FORM_NUMBER") ?? "").trim() === "Yes");
  if (ticked && series.trim() === "") return { statements: [], savedRows, messages: [`${bankName} has no payment series (book_number) to number the vouchers`] };

  let serial = 0;
  /** One payment voucher: the bank pays `amount` to `code`; `outclear` links the set-off. */
  const voucher = (code: number, partyName: string, amount: number, narration: string, outclear: "pending" | "on-account", outstand: string) => {
    const number = next++;
    const fullDocNo = `${series.trim()}/${number}`;
    const led = `led${++serial}`;
    const blank10 = quote(" ".repeat(10));
    statements.push({ sql: "", insert: { table: "ledger", capture: led,
      fields: ["code", "doc_date", "doc_no", "doc_series", "full_docno", "doc_no1", "amount", "book_amt", "book", "book_code", "post_bkcode", "ac_dbcode", "bk_dbcode", "narration", "setoff_amt", "ly_clearamt", "chln_date", "ag_book", "ag_bkcode", "type", "int_type", "entry_type", "post_amt", "doc_posting", "doc_mode", "doc_lock", "doc_pos", "prod_amt", "doc_remark", "entry_sty", "unique_key", "stkmdl", "doc_type", "year_id", "last_savedate", "last_savetime", "entry_no", "reco_date", "post_date"],
      values: [String(code), entryDate, quote(String(number).padStart(10)), quote(series), quote(fullDocNo), blank10, money(amount), money(amount), "6", String(bank), String(bank), "1", "2", quote(narration), money(0), money(0), entryDate, "0", "null", "0", "0", "''", money(amount), "'P'", "0", "''", "'A'", money(0), "''", "''", "null", "''", "'R'", year, saveDate, saveTime, blank10, entryDate, entryDate] } });
    const ref = `{{${led}}}`;
    const post = (postCode: number, dbCode: number) => ({ sql: "", insert: { table: "ledger_post", fields: ["led_id", "post_code", "post_date", "post_bookcd", "post_amt", "post_dbcode", "post_book", "year_id"], values: [ref, String(postCode), entryDate, String(bank), money(amount), String(dbCode), "6", year] } });
    statements.push(post(code, 1), post(bank, 2));
    statements.push({ sql: "", insert: { table: "addon_aentry", fields: ["aona_accode", "aona_ledid", "aona_recid", "key_subled", "txt_subled"], values: [String(code), ref, "'L'", "515", "' None'"] } });
    if (outclear === "pending") {
      statements.push({ sql: `Update outclear set out_entryamt=${money(amount)},out_fulldocno=${quote(fullDocNo)},out_ledid=${ref} where out_fulldocno='-1'` });
    } else {
      statements.push({ sql: "", insert: { table: "outclear", fields: ["out_ledid", "out_fulldocno", "out_date", "out_entryamt", "out_setoff", "out_ly_setoff", "out_on_acamt", "out_dbcode", "out_ag_outid", "out_entrybook", "code", "ref_no", "set_off", "clear_pos", "year_id"], values: [ref, quote(fullDocNo), entryDate, money(0), money(amount), money(0), money(0), "1", "null", "6", String(code), "''", "'1'", "'P'", year] } });
    }
    statements.push({ sql: `Update ledger set unique_key=${ref} where led_key=${ref}` });
    statements.push({ sql: `Update ac_balance set debit=debit+${money(amount)},closing=closing+${money(amount)} where code=${code} and year_id=${year} and a_recflag='AC'` });
    statements.push({ sql: `Update ac_balance set credit=credit+${money(amount)},closing=closing-${money(amount)} where code=${bank} and year_id=${year} and a_recflag='AC'` });
    statements.push({ sql: "", insert: { table: "log_ledger", fields: ["lled_logdate", "lled_logtime", "lled_logmode", "lled_loguser", "lled_logsystem", "lled_id", "lled_code", "lled_docdate", "lled_fulldocno", "lled_docno1", "lled_amount", "lled_narration", "lled_docpos", "year_id", "lled_machine_name"], values: [saveDate, saveTime, "'A'", String(session.userNo), "null", ref, String(code), entryDate, quote(fullDocNo), "''", money(amount), quote(narration), "'A'", year, "'WEB'"] } });
    // LOG_ENTRY: the voucher as the entry screen would log it (top, item, outstanding, addon).
    const shown = amount.toFixed(2);
    const top = `[${json([["!*Led_key", ref], ["DAYBOOK", bankName], ["user", session.loginName], ["savedate", formatDesktopDate(now)], ["savetime", formatDesktopTime(now)], ["machine_name", "WEB"], ["* Series", series.trim()], ["* Ent. Dt.", entryDateText], ["* Ent. No.", String(number)], ["Narration", narration], ["* Doc. Type", "Regular"], ["* Book Side", "Payment"], ["Total Debit Amount", shown], ["Total Credit Amount", "0"]])}]`;
    const items = `[${json([["!*Led_key", ref], ["Row Sr.", "1"], ["* Account Head", partyName], ["Debit", shown], ["Credit", "0"], ["Chq. Number", "0"], ["Chq. Date", entryDateText], ["* Sub Ledger", " None"]])}]`;
    const addon = `[${["Bank Name ", "Bank Branch ", "Cheque Print Name ", "Cheque Date Req "].map((label, at) => json([[at === 0 ? "!*Addon_Label" : "!Addon_Label", label], [label, ""]])).join(",")}]`;
    statements.push({ sql: "", insert: { table: "log_entry", biglog: true, fields: ["lentry_top_bottom", "lentry_items", "lentry_slab", "lentry_outstand", "lentry_addon", "lentry_einvoice", "lentry_fields", "lentry_mode", "lentry_user", "lentry_ledid", "lentry_processid", "lentry_code", "lentry_book", "lentry_bookcode", "lentry_savedate", "lentry_savetime", "lentry_machine_name"], values: [quote(top), quote(items), "''", quote(outstand), quote(addon), "''", "''", "'A'", String(session.userNo), ref, "null", String(code), "6", String(bank), saveDate, saveTime, "'WEB'"] } });
  };

  if (entryId === 42) {
    let party: { name: string; code: number; amount: number; docs: string[]; outstand: string[] } | null = null;
    const pay = () => {
      if (!party) return;
      voucher(party.code, party.name, party.amount, `Setoff for Bill : ${party.docs.join(",")}`, "pending", `[${party.outstand.join(",")}]`);
      party = null;
    };
    for (const [index, { values, deleted }] of rows.entries()) {
      if (!deleted && (cellOf(values, "FORM_NUMBER") ?? "").trim() === "Yes") {
        const name = cellOf(values, "name") ?? "";
        if (party && party.name !== name) pay();
        party ??= { name, code: 0, amount: 0, docs: [], outstand: [] };
        const amount = amountOf(cellOf(values, "form_amt"));
        const outKey = toInt(cellOf(values, "out_key"));
        const code = toInt(cellOf(values, "code"));
        statements.push({ sql: "", insert: { table: "outclear", fields: ["out_ledid", "out_fulldocno", "out_date", "out_entryamt", "out_setoff", "out_ly_setoff", "out_on_acamt", "out_dbcode", "out_ag_outid", "out_entrybook", "code", "ref_no", "set_off", "clear_pos", "year_id"], values: ["null", "'-1'", entryDate, money(0), money(amount), money(0), money(0), "1", String(outKey), "6", String(code), "''", "'1'", "'P'", year] } });
        statements.push({ sql: `Update outclear set out_setoff=out_setoff+${money(amount)} where out_key=${outKey}` });
        party.amount += amount;
        party.code = code;
        party.docs.push(cellOf(values, "doc_no1") ?? "");
        party.outstand.push(json([["!*Out_key", String(outKey)], ["Sr.", String(party.outstand.length + 1)], ["Doc Number", cellOf(values, "doc_no1") ?? ""], ["Date", cellOf(values, "chln_date") ?? ""], ["Amount", String(amountOf(cellOf(values, "amount")))], ["Pending", String(amountOf(cellOf(values, "amount")))], ["Setoff Amt", String(amount)], ["Inputrow", "1"]]));
        savedRows.add(index);
      }
      // Every listed bill's allotment is cleared, paid or not.
      statements.push({ sql: `Update ledger set form_amt=${money(0)} where led_key=${toInt(cellOf(values, "led_key"))}` });
    }
    if (party && (party as { amount: number }).amount > 0) pay();
  } else {
    for (const [index, { values, deleted }] of rows.entries()) {
      if (!deleted && (cellOf(values, "FORM_NUMBER") ?? "").trim() === "Yes") {
        voucher(toInt(cellOf(values, "code")), cellOf(values, "name") ?? "", amountOf(cellOf(values, "allot_amount")), cellOf(values, "remark") ?? "", "on-account", "");
        savedRows.add(index);
      }
      // Every listed allotment goes, approved or not.
      statements.push({ sql: `Delete from pay_allot where pay_allot_key=${toInt(cellOf(values, "pay_allot_key"))}` });
    }
  }
  return { statements, savedRows, messages };
}
