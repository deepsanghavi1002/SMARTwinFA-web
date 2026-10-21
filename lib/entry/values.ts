import { formatDesktopDate, parseDesktopDate } from "../master-program/legacy";
import type { MasterSession } from "../master-program/session";
import { replaceSessionValues } from "../master-program/sql";
import { quotedAliases } from "../small-entry/text";
import { pgFragment } from "../report/sqlText";

/**
 * Comman_Entry.Func_ReplaceSysVal_CtrlValue, for the placeholders the invoice's setup uses
 * while the screen is set up (register, series, date, number, party). Placeholders that need
 * the product rows or a save are left in place, as the desktop leaves unknown ones.
 */

/** Book keys the desktop keeps in SmartVfaConstants. */
export const BOOK = { PETTYCASH: 7, SALE: 8, AGENCY: 10, PURCH: 13, EXPENSE: 15, CRNOTE: 16, JOURNAL: 19 } as const;

/** Books a TDS auto journal belongs to: expense, agency, and the purchase (account) book. */
export const tdsBook = (bookKey: number, bookActual: boolean) => bookKey === BOOK.EXPENSE || bookKey === BOOK.AGENCY || (bookKey === BOOK.PURCH && bookActual);
/** The company runs the TDS auto journal (setup entry_para TDS_AUTOJV,). */
export const tdsAutoJournal = (setup: Readonly<Record<string, unknown>>) => String(setup.entry_para ?? "").toUpperCase().includes("TDS_AUTOJV,");

export type EntryValues = Readonly<{
  session: MasterSession;
  /** The register chosen: account code and name. */
  firstCombo: Readonly<{ text: string; value: string }>;
  /** byte_book_key, int_type, int_book_code, byte_bk_dbcode, byte_ac_dbcode, byte_ag_book. */
  bookKey: number;
  type: number;
  bookCode: number;
  bkDbcode: number;
  acDbcode: number;
  agBook: number;
  /** int_ag_bookcode: the account a debit / credit note is against (0: none). */
  agCode: number;
  bookActual: boolean;
  /** dtbl_FirstCombo stkm_forbook (|sys.slab_book| of a stock module). */
  forBook: number;
  stkmShort: string;
  stkmFromShort: string;
  /** str_Ac_Help: " 2, 3," and the like. */
  acHelp: string;
  series: string;
  docNo: string;
  /** dd/MMM/yyyy. */
  docDate: string;
  acCode: number;
  entryNat: "A" | "E";
  /** The company schema's money columns, read as numeric wherever a query names them. */
  moneyColumns?: readonly string[];
}>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** |sys.slab_book|: a stock module's own book, an agency bill the expense book, else the book (or the book against). */
export function slabBook(values: Pick<EntryValues, "bookActual" | "bookKey" | "forBook" | "agBook">): number {
  if (!values.bookActual && values.bookKey > BOOK.CRNOTE) return values.forBook;
  if (values.bookKey === BOOK.AGENCY) return BOOK.EXPENSE;
  return values.agBook > 0 ? values.agBook : values.bookKey;
}

/** |sys.achelpbook|: the help's book list without its trailing comma; "(n)" means a balance-sheet head. */
export function acHelpBooks(acHelp: string): { books: string; bsHead: string | null } {
  let list = acHelp.trim().replace(/,$/, "").trim();
  if (list.includes("(")) return { books: "1", bsHead: list.replace(/[()]/g, "").trim() };
  if (list === "") list = "2, 3";
  return { books: list, bsHead: null };
}

/**
 * What SQL Server read in the setup's queries and PostgreSQL does not, beyond what pgFragment
 * does (money columns, ledger."TYPE", account."LIMIT"):
 * - smart_setup.GetNumbers(x), a SQL Server function with no PostgreSQL copy: the digits of x as a number;
 * - tax_master.tax_type is text but idopt_key a number (SQL Server converted the key);
 * - a TO_CHAR of a column with a 9-mask (credit days, budget %) wants a number.
 */
export function entryDialect(sql: string): string {
  return sql
    .replace(/smart_setup\.GetNumbers\s*\(\s*([A-Za-z_][\w.]*)\s*\)/gi, "nullif(regexp_replace($1, '\\D', '', 'g'), '')::numeric")
    .replace(/\btax_type\s*=\s*\(\s*select\s+idopt_key\b(?!\s*::)/gi, "tax_type = (select idopt_key::varchar")
    .replace(/\bTO_CHAR\s*\(\s*((?:[A-Za-z_]\w*\.)?(?:"[A-Za-z_]\w*"|[A-Za-z_]\w*))\s*,\s*'FM9/gi, "TO_CHAR($1::numeric, 'FM9");
}

export function replaceEntryTokens(source: string | null | undefined, values: EntryValues, now = new Date()): string {
  let sql = replaceSessionValues(source ?? "", values.session, now);
  const has = (token: string) => sql.toLowerCase().includes(token.toLowerCase());
  const swap = (token: string, value: string) => {
    if (!has(token)) return;
    sql = sql.replace(new RegExp(token.replace(/[|.()]/g, (c) => `\\${c}`), "gi"), () => value);
  };
  const docDate = parseDesktopDate(values.docDate);
  swap("|sys.complic|", String(values.session.licence));
  if (has("'|sys.left.firstcombotext|'")) swap("|sys.left.firstcombotext|", values.firstCombo.text.replace(/'/g, "''"));
  swap("|sys.left.firstcombotext|", quote(values.firstCombo.text));
  swap("|sys.firstcombovalue|", values.firstCombo.value || "0");
  swap("|sys.firstcomboid|", values.firstCombo.value || "0");
  if (has("|sys.achelpbook|")) {
    const help = acHelpBooks(values.acHelp);
    if (help.bsHead !== null) swap("|sys.achelpbook|)", `1) and ac.bs_id=${help.bsHead}`);
    swap("|sys.achelpbook|", help.books);
  }
  swap(",|sys.help_qtycol|", "");
  swap("|sys.firstcombobook|", String(values.bookKey));
  swap("|sys.book|", String(values.bookKey));
  swap("|sys.slab_book|", String(slabBook(values)));
  swap("|sys.ag_book|", String(values.agBook));
  swap("|sys.bk_dbcode|", String(values.bkDbcode));
  swap("|sys.ac_dbcode|", String(values.acDbcode === 0 ? 1 : values.acDbcode));
  swap("|sys.book_code|", values.bookCode === 0 ? "Null" : String(values.bookCode));
  swap("|sys.ag_bkcode|", values.agCode === 0 ? "Null" : String(values.agCode));
  // A quoted placeholder takes the bare text; an unquoted one gets the quotes.
  if (has("'|sys.doc_series|'")) swap("|sys.doc_series|", values.series.replace(/'/g, "''"));
  swap("|sys.doc_series|", quote(values.series));
  if (has("'|sys.doc_no|'")) swap("|sys.doc_no|", values.docNo.replace(/'/g, "''"));
  swap("|sys.doc_no|", quote(values.docNo));
  swap("|sys.doc_date|", quote(docDate ? formatDesktopDate(docDate) : formatDesktopDate(now)));
  swap("|sys.ac_code|", values.acCode === 0 ? "Null" : String(values.acCode));
  swap("|sys.type|", String(values.type));
  if (has("'|sys.entrynat|'")) swap("|sys.entrynat|", values.entryNat);
  swap("|sys.entrynat|", quote(values.entryNat));
  if (has("'|sys.stkm_short|'")) swap("|sys.stkm_short|", values.stkmShort);
  swap("|sys.stkm_short|", quote(values.stkmShort));
  if (has("'|sys.stkm_fromshort|'")) swap("|sys.stkm_fromshort|", values.stkmFromShort);
  swap("|sys.stkm_fromshort|", quote(values.stkmFromShort));
  swap("|sys.blank|", "''");
  swap("|sys.null|", "null");
  // Invoice_Tab_Find_Edit_Enter: "and |para.ag_bkcode|" names the book-against only when one is chosen.
  swap("and |para.ag_bkcode|", values.agCode > 0 ? `and led.ag_bkcode=${values.agCode}` : "");
  return entryDialect(pgFragment(quotedAliases(sql), { moneyColumns: values.moneyColumns ?? [] }, values.session.companySchema));
}
