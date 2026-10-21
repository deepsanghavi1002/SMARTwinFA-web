import { Loader } from "../master-program/load";
import { formatDesktopDate, toDecimal, toInt, toText } from "../master-program/legacy";
import { bookContext } from "./invoice";
import { BOOK, tdsAutoJournal, tdsBook } from "./values";
import type { EntryOption } from "./types";
import type { Statement } from "./save";

/**
 * The TDS auto journal of Comman_Entry (setup entry_para TDS_AUTOJV,): an expense, agency or purchase (account book) bill of a party that deducts
 * TDS (int_master.tds_req = Y) carries the TDS amount in the foot box (the desktop's Credit Days box, labelled "TDS Amount"); saving a new entry
 * then also posts a JV pair of that amount - the party is debited (and the bill set off by it), the TDS nature account is credited. An agency
 * entry has the two sides the other way round.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name)).trim();

/** The purchase turnover a purchase party must pass before TDS is deducted (section 194Q). */
export const TDS_PURCHASE_LIMIT = 5000000;

export type TdsInfo = Readonly<{
  /** The TDS nature account (account.a_short = tds_chart.section_no) the credit side goes to. */
  nature: number;
  /** TDS % of the party's nature of payment (the company rate for a company deductee when the chart gives one). */
  perc: number;
  /** A purchase book only: what the party has been billed this year (slab_master slab, before the entry). */
  purchaseYear: number;
  /** A purchase book only: the slab (key) the year's figure is taken from. */
  purchaseSlab: number;
}>;

export { tdsAutoJournal, tdsBook };

/**
 * What the party's TDS is: null when the party deducts none (or the book / company has no TDS auto journal). `error` is the desktop's refusal:
 * TDS Posting is Yes in the account but its TDS nature account is not open.
 */
export async function tdsInfo(loader: Loader, entryName: string, firstCombo: EntryOption, partyCode: number, forSave = false): Promise<{ info: TdsInfo | null; error?: string }> {
  if (!tdsAutoJournal(loader.session.setup) || partyCode <= 0) return { info: null };
  const book = await bookContext(loader, entryName, firstCombo);
  if (!tdsBook(book.values.bookKey, book.values.bookActual)) return { info: null };
  const required = (await loader.readTable(`SELECT tds_req FROM |sys.db|int_master WHERE code = $1`, [partyCode]))?.[0];
  if (text(required, "tds_req").toUpperCase() !== "Y") return { info: null };
  const natureRow = (await loader.readTable(
    `SELECT code FROM |sys.db|account WHERE a_pos = 'A' ${forSave ? "AND a_lastdate IS NULL" : ""} AND a_short IN (SELECT section_no FROM smart_setup.tds_chart WHERE tds_key IN (SELECT DISTINCT nature_pay FROM |sys.db|account ac LEFT JOIN |sys.db|int_master intmst ON intmst.code = ac.code WHERE ac.code = $1 AND intmst.tds_req = 'Y'))`, [partyCode]))?.[0];
  const nature = toInt(field(natureRow, "code"));
  if (nature <= 0) return { info: null, error: "Selected Master not allowed as TDS Posting Yes given in account but TDS Nature Account is not Open" };
  const kind = text((await loader.readTable(`SELECT opt_desc FROM |sys.db|idopt_master WHERE idopt_key IN (SELECT type_deduct FROM |sys.db|account WHERE code = $1)`, [partyCode]))?.[0], "opt_desc").toUpperCase().startsWith("C") ? "C" : "I";
  const chart = (await loader.readTable(`SELECT tds_rate_individual, tds_rate_company FROM smart_setup.tds_chart WHERE tds_key IN (SELECT nature_pay FROM |sys.db|account WHERE code = $1)`, [partyCode]))?.[0];
  const perc = chart ? (toDecimal(field(chart, "tds_rate_company")) > 0 && kind === "C" ? toDecimal(field(chart, "tds_rate_company")) : toDecimal(field(chart, "tds_rate_individual"))) : 0;
  let purchaseYear = 0;
  let purchaseSlab = 0;
  if (book.values.bookKey === BOOK.PURCH) {
    purchaseSlab = toInt(field((await loader.readTable(`SELECT slab_key FROM |sys.db|slab_master WHERE book = 13 AND slab_master = 'Y' AND slab_link = 0 LIMIT 1`))?.[0], "slab_key"));
    const { session } = loader;
    purchaseYear = toDecimal(field((await loader.readTable(
      `SELECT COALESCE(SUM(s_lastot::numeric - slab_amt::numeric), 0) AS amount FROM |sys.db|ledger led LEFT JOIN |sys.db|ledger_ext ledext ON ledext.led_id = led.led_key
        WHERE doc_pos = 'A' AND book IN (13) AND ledext.il_id IS NULL AND ledext.led_id IS NOT NULL AND ledext.slab_id = $1 AND doc_date BETWEEN $2 AND $3 AND code = $4`,
      [purchaseSlab, session.tarikh1, session.tarikh2, partyCode]))?.[0], "amount"));
  }
  return { info: { nature, perc, purchaseYear, purchaseSlab } };
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const amountText = (value: number) => String(Math.round(value * 100) / 100);

/**
 * Save_Entry's TDS block, after the entry is saved (@pkval_1 is its ledger row): the next JV number, then two ledger rows (the debit and the credit side),
 * each with its log row, balance, ledger_post and outstanding row; the debit side sets itself off against the entry's own outstanding row.
 */
export async function tdsJournal(loader: Loader, input: { bookKey: number; partyCode: number; nature: number; amount: number; date: Date; now: Date; fullDocNo: string }): Promise<Statement[]> {
  const { session } = loader;
  const schema = session.companySchema;
  const agency = input.bookKey === BOOK.AGENCY;
  const debitCode = agency ? input.nature : input.partyCode;
  const creditCode = agency ? input.partyCode : input.nature;
  const amount = amountText(input.amount);
  const year = quote(session.yearId);
  const date = quote(formatDesktopDate(input.date));
  const today = quote(formatDesktopDate(input.now));
  const clock = quote(`${String(input.now.getHours()).padStart(2, "0")}:${String(input.now.getMinutes()).padStart(2, "0")}:${String(input.now.getSeconds()).padStart(2, "0")}`);
  const top = (await loader.readTable(`SELECT MAX(NULLIF(REGEXP_REPLACE(doc_no, '[^0-9]', '', 'g'), '')::bigint) AS top FROM |sys.db|ledger WHERE book = 19 AND doc_series = 'JV' AND doc_pos <> 'D' AND doc_posting = 'P'`))?.[0];
  const counter = toInt(field(top, "top")) + 1;
  const number = String(counter);
  const full = `JV/${number}`;
  // The saved entry's own outstanding row: the bill the debit side sets itself off against.
  const bill = `COALESCE((SELECT out_key FROM ${schema}.outclear WHERE out_ledid = @pkval_1 ORDER BY out_key LIMIT 1), 0)`;
  // An agency entry sets off against the nature account's outstanding row of the same JV chain.
  const agencyBill = `COALESCE((SELECT out_key FROM ${schema}.outclear WHERE code = ${input.nature} AND out_ag_outid IS NULL AND out_fulldocno IN (SELECT out_fulldocno FROM ${schema}.outclear WHERE out_entrybook = 19 AND out_ag_outid = COALESCE((SELECT out_ag_outid FROM ${schema}.outclear WHERE out_ledid = @pkval_1 ORDER BY out_key LIMIT 1), 0)) LIMIT 1), 0)`;
  const target = agency ? agencyBill : bill;
  const narration = `COALESCE((SELECT 'Setoff for Bill : ' || out_fulldocno FROM ${schema}.outclear WHERE out_ledid = @pkval_1 ORDER BY out_key LIMIT 1), 'Setoff for Bill : ')`;
  const logOn = toText(session.setup.logfile).toUpperCase() !== "N";
  const columns = ["code", "doc_date", "doc_no", "doc_series", "full_docno", "doc_no1", "amount", "book", "book_code", "ac_dbcode", "narration", "setoff_amt", "ly_clearamt", "chln_date", "ag_book", "ag_bkcode", "type", "int_type", "entry_type", "post_amt", "doc_posting", "doc_mode", "doc_lock", "doc_pos", "prod_amt", "doc_remark", "entry_sty", "unique_key", "stkmdl", "year_id", "last_savedate", "last_savetime", "entry_no", "post_date", "imp_ledkey"];
  const ledger = (code: number, side: 1 | 2, narrationValue: string, capture: "jv_1" | "jv_2"): Statement => ({
    kind: "insert", table: "ledger", keyColumn: "led_key", capture, label: `TDS JV ${full}: ledger (${side === 1 ? "debit" : "credit"})`, columns,
    values: [String(code), date, quote(number.padStart(10, " ")), "'JV'", quote(full), quote("          "), amount, "19", "27", String(side), narrationValue, "0", "0", "null", "0", "null", "0", "0", "''", amount, "'P'", "0", "''", "'A'", "0", "''", "''", "0", "''", year, today, clock, quote("          "), date, "@pkval_1"],
  });
  const log = (code: number, key: "jv_1" | "jv_2"): Statement[] => (logOn ? [{
    kind: "insert", table: "log_ledger", keyColumn: "lled_key", label: `TDS JV ${full}: log_ledger`,
    columns: ["lled_logdate", "lled_logmode", "lled_loguser", "lled_id", "lled_code", "lled_docdate", "lled_fulldocno", "lled_docno1", "lled_amount", "lled_narration", "lled_logtime", "lled_docpos", "year_id", "lled_machine_name"],
    values: [today, "'A'", String(session.userNo), `@${key}`, String(code), date, quote(full), quote("          "), amount, "''", clock, "'A'", year, quote("WEB")],
  }] : []);
  const addon = (code: number, key: "jv_1" | "jv_2"): Statement[] => (session.licence === 21 ? [{
    kind: "insert", table: "addon_aentry", keyColumn: "aona_key", label: `TDS JV ${full}: addon`, columns: ["aona_accode", "aona_ledid", "aona_recid", "key_subled", "txt_subled"], values: [String(code), `@${key}`, "'L'", "515", "' None'"],
  }] : []);
  const post = (code: number, side: 1 | 2, key: "jv_1" | "jv_2"): Statement => ({
    kind: "insert", table: "ledger_post", keyColumn: "post_key", label: `TDS JV ${full}: ledger_post ${code}`, columns: ["led_id", "post_code", "post_date", "post_bookcd", "post_amt", "post_dbcode", "post_book", "year_id"],
    values: [`@${key}`, String(code), date, "27", amount, String(side), "19", year],
  });
  const balance = (code: number, side: 1 | 2): Statement => ({
    kind: "sql", label: `TDS JV ${full}: ac_balance ${code}`,
    sql: `UPDATE |sys.db|ac_balance SET closing = (closing::numeric + (${side === 1 ? amount : `-${amount}`}))::money, ${side === 1 ? "debit" : "credit"} = (${side === 1 ? "debit" : "credit"}::numeric + ${amount})::money WHERE code = ${code} AND a_recflag = 'AC' AND year_id = ${year}`,
  });
  const outstanding = (code: number, side: 1 | 2, key: "jv_1" | "jv_2"): Statement => ({
    kind: "insert", table: "outclear", keyColumn: "out_key", label: `TDS JV ${full}: outstanding (${side === 1 ? "debit" : "credit"})`,
    columns: ["out_ledid", "out_fulldocno", "out_date", "out_entryamt", "out_setoff", "out_ly_setoff", "out_on_acamt", "out_dbcode", "out_ag_outid", "out_entrybook", "code", "ref_no", "set_off", "clear_pos", "year_id"],
    values: [`@${key}`, quote(full), date, amount, side === 1 ? amount : "0", "0", "0", String(side), side === 1 ? target : "null", "19", String(code), "''", side === 1 ? "1" : "0", "'P'", year],
  });
  return [
    // The debit side.
    ledger(debitCode, 1, narration, "jv_1"),
    { kind: "sql", label: `TDS JV ${full}: unique_key`, sql: `UPDATE |sys.db|ledger SET unique_key = @jv_1 WHERE led_key = @jv_1` },
    ...log(debitCode, "jv_1"), ...addon(debitCode, "jv_1"), balance(debitCode, 1), post(debitCode, 1, "jv_1"), outstanding(debitCode, 1, "jv_1"),
    { kind: "sql", label: `TDS JV ${full}: bill set off`, sql: `UPDATE |sys.db|outclear SET out_setoff = (out_setoff::numeric + ${amount}), clear_pos = 'C' WHERE out_key = ${target}` },
    // The credit side: the pair shares the first row's unique_key.
    ledger(creditCode, 2, "''", "jv_2"),
    { kind: "sql", label: `TDS JV ${full}: unique_key (credit)`, sql: `UPDATE |sys.db|ledger SET unique_key = @jv_1 WHERE led_key = @jv_2` },
    ...log(creditCode, "jv_2"), ...addon(creditCode, "jv_2"), balance(creditCode, 2), post(creditCode, 2, "jv_2"), outstanding(creditCode, 2, "jv_2"),
  ];
}
