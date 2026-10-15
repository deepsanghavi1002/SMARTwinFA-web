import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toInt, toText } from "../master-program/legacy";
import { replaceEntryTokens } from "./values";
import type { EntryValues } from "./values";
import { controlEvents, entryProperties } from "./invoice";
import type { BookContext } from "./invoice";

/**
 * The validations Comman_Entry runs as the cursor leaves a header box: Dtp_Date_Leave (series
 * period, lock dates, GST start date), Tbx_Number_Leave / Tbx_ChlnNo_Leave / Tbx_EntryNo_Leave
 * (start number, duplicate number by bn_docdup / bn_doc1dup / bn_postdup, CHK_BETWEEN_NO) and
 * Tbx_PartyName_Leave (party lock / warning message, account start and last date, party amount
 * limit). Read-only: each check answers with the messages the desktop shows, in its order.
 *
 * Licence-specific party checks (7, 21, 24, 41, 45, 51 ...) are not here; see docs/PENDING-WORK.md.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name)).trim();

/** One message box of the desktop: "stop" returns the cursor to the box, "ask" is Yes / No, "warn" lets the entry go on. */
export type HeaderProblem = Readonly<{ text: string; title: string; kind: "stop" | "warn" | "ask"; setDate?: string }>;

export type HeaderField = "date" | "number" | "chlnno" | "entryno" | "party";

export type HeaderInput = Readonly<{
  field: HeaderField;
  series: string;
  /** dd/MMM/yyyy. */
  date: string;
  number: string;
  chlnNo: string;
  entryNo: string;
  /** The unique_key of the entry being edited, else 0 (an own number is not a duplicate). */
  editKey: number;
  /** Dt_Restore_Date: the date the opened entry was saved with. */
  editDate: string;
  /** The tax group of the opened entry (str_Entry_UpdTaxGroup), "" when adding. */
  taxGroup: string;
  /** The voucher style: this is account row `rows` (1 for the first), the side picked (1 account debit, 2 account credit) and the day book's name. */
  voucher?: Readonly<{ rows: number; sideDbcode: number; bookName: string }>;
  party?: Readonly<{ name: string; book: number; closing: string; limit: string; message: string; startDate: string; lastDate: string }>;
}>;

const dayOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const parseDay = (value: unknown): Date | null => {
  const parsed = parseDesktopDate(typeof value === "string" ? value : displayValue(value));
  return parsed ? dayOf(parsed) : null;
};
const number = (value: unknown): number => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The book_number row of the series (cmb_series' "sys.var.booknumber" event): bn_* and the book_setup lock dates. */
async function bookNumberRow(loader: Loader, entryId: number, values: EntryValues): Promise<Row | undefined> {
  const events = await controlEvents(loader, entryId);
  const event = events.find((candidate) => text(candidate, "control_name").toLowerCase() === "cmb_series" && text(candidate, "control_event").toUpperCase() === "LF" && text(candidate, "system_value").toLowerCase() === "sys.var.booknumber");
  if (!event) return undefined;
  return (await loader.readTable(replaceEntryTokens(`Select ${toText(field(event, "fill_control_query"))}`, values)))?.[0];
}

/** Whether a control_event row's book list (control_cond_oper / control_cond_book) takes this book. */
function takesBook(event: Row, bookKey: number): boolean {
  const listed = text(event, "control_cond_book").includes(` ${bookKey},`);
  return text(event, "control_cond_oper").toLowerCase() === "in" ? listed : !listed;
}

const SQL_TEXT = (value: string) => value.replace(/'/g, "''");

/**
 * Control_Event_Procedure for a "dupl" event: whether the number is already used. The query is
 * the setup's, with the daily / monthly series narrowing the date range, and the entry being
 * edited left out.
 */
async function numberUsed(loader: Loader, events: Row[], values: EntryValues, box: "tbx_number" | "tbx_chlnno" | "tbx_entryno", period: string, input: HeaderInput): Promise<boolean> {
  const rows = events.filter((event) => {
    if (text(event, "control_name").toLowerCase() !== box || text(event, "control_event").toUpperCase() !== "LF") return false;
    if (box !== "tbx_number") return true;
    return text(event, "control_type") === (values.bookActual ? "book" : "Xbook");
  });
  for (const event of rows) {
    if (box === "tbx_number" && !takesBook(event, values.bookKey)) continue;
    if (field(event, "query_condition") === true) continue;
    let sql = `Select ${toText(field(event, "fill_control_query"))}`;
    if (box === "tbx_chlnno") sql = sql.replace(/\|sys\.doc_no1\|/gi, SQL_TEXT(input.chlnNo));
    if (box === "tbx_entryno") sql = sql.replace(/\|sys\.entry_no\|/gi, SQL_TEXT(input.entryNo));
    if (box === "tbx_number" && (period === "D" || period === "M")) {
      const narrow = (column: string) => (period === "D" ? `${column}=|sys.doc_date|` : `EXTRACT(MONTH FROM ${column})=EXTRACT(MONTH FROM |sys.doc_date|::date)`);
      sql = sql.replace(/doc_date>=\|sys\.tarikh1\| and doc_date<=\|sys\.tarikh2\|/i, narrow("doc_date")).replace(/p_date>=\|sys\.tarikh1\| and p_date<=\|sys\.tarikh2\|/i, narrow("p_date"));
    }
    sql = replaceEntryTokens(sql, values);
    if (input.editKey > 0 && /ledger/i.test(sql)) sql += ` and unique_key <> ${input.editKey}`;
    if (input.editKey > 0 && !values.bookActual && /process/i.test(sql)) sql += ` and process_key <> ${input.editKey}`;
    if (await loader.readTable(sql)) return true;
  }
  return false;
}

/** The three number boxes: bn_start / bn_start1 / bn_postno limits, then the duplicate rule. */
async function numberProblems(loader: Loader, book: BookContext, entryId: number, bn: Row, input: HeaderInput, values: EntryValues): Promise<HeaderProblem[]> {
  const which = input.field as "number" | "chlnno" | "entryno";
  const typed = which === "number" ? input.number : which === "chlnno" ? input.chlnNo : input.entryNo;
  if (typed.trim() === "") return [];
  const digits = /^\d+$/.test(typed.trim());
  const limit = which === "number" ? { column: "bn_start", shown: "bn_start", message: "Number Start from", title: "Number Validation: Warning" }
    : which === "chlnno" ? { column: "bn_start1", shown: "bn_start1", message: "Challan Number Start from", title: "Challan No. Warning" }
      : { column: "bn_postno", shown: "bn_poststart", message: "Entry Number Start from", title: "Entry Number Warning" };
  if (digits && field(bn, limit.column) !== undefined && number(typed) < toInt(field(bn, limit.column))) {
    return [{ text: `${limit.message} ${text(bn, limit.shown)}`, title: limit.title, kind: "stop" }];
  }
  const dup = text(bn, which === "number" ? "bn_docdup" : which === "chlnno" ? "bn_doc1dup" : "bn_postdup");
  const events = await controlEvents(loader, entryId);
  const problems: HeaderProblem[] = [];
  if (dup !== "N" && dup !== "P" && dup !== "" && await numberUsed(loader, events, values, `tbx_${which}` as "tbx_number" | "tbx_chlnno" | "tbx_entryno", text(bn, "bn_period"), input)) {
    if (dup === "O") return [{ text: "Duplicate Allowed to Enter  ", title: which === "entryno" ? "Number Duplicate Warning" : "Number Duplicate", kind: "ask" }];
    return [{ text: which === "number" ? "Duplicate number... " : which === "chlnno" ? "Duplicate challan number... " : "Duplicate entry number... ", title: which === "number" ? "Dulpicate Number Warning" : which === "chlnno" ? "Duplicate Challan Number Warning" : "Duplicate Number Warning", kind: "stop" }];
  }
  if (which !== "number") return problems;
  // Tbx_Number_Leave's "Run Event": CHK_BETWEEN_NO, a number entered below or above its neighbours must fit their dates.
  const para = toText(loader.session.setup.entry_para).toUpperCase();
  if (para.includes("CHK_BETWEEN_NO,") && book.party && digits) {
    const event = events.find((candidate) => text(candidate, "control_name").toLowerCase() === "tbx_number" && text(candidate, "system_value").toLowerCase() === (values.bookActual ? "sys.between_no" : "sys.between_chln_no"));
    if (event && field(event, "query_condition") !== true && takesBook(event, values.bookKey) && text(event, "control_event").toUpperCase() === "SP") {
      const last = values.bookActual
        ? "select max(nullif(regexp_replace(doc_no, '\\D', '', 'g'), '')::numeric) as last_docno from |sys.db|ledger where doc_posting='P' and doc_series=|sys.doc_series| and (bk_dbcode=|sys.bk_dbcode| or (bk_dbcode is null)) and book_code=|sys.book_code| and doc_pos<>'D' and year_id=|sys.yearid|"
        : "select max(nullif(regexp_replace(doc_no2, '\\D', '', 'g'), '')::numeric) as last_docno from |sys.db|process where p_docseries=|sys.doc_series| and p_bkdbcode=|sys.bk_dbcode| and book=|sys.book| and il_pos<>'D' and year_id=|sys.yearid|";
      const lastRow = (await loader.readTable(replaceEntryTokens(last, values)))?.[0];
      const lastNumber = field(lastRow, "last_docno");
      if (lastNumber !== null && lastNumber !== undefined && toText(lastNumber) !== "") {
        const older = number(lastNumber) > number(typed);
        const fits = await loader.readTable(replaceEntryTokens(toText(field(event, "fill_control_query")), values));
        if (!fits && typed.trim() !== "1") {
          problems.push({
            text: older ? "For Entering Old Invoice Number entry Date must be below than its higer invoice number..." : "For Entering New Invoice Number entry Date must be greater than equal to its below invoice number...",
            title: "Entry Warning",
            kind: "stop",
          });
        }
      }
    }
  }
  return problems;
}

/** Dtp_Date_Leave. */
function dateProblems(loader: Loader, book: BookContext, bn: Row, input: HeaderInput): HeaderProblem[] {
  const { session } = loader;
  const date = parseDay(input.date);
  if (!date) return [];
  const problems: HeaderProblem[] = [];
  const from = parseDay(field(bn, "bn_from"));
  const upto = parseDay(field(bn, "bn_upto"));
  if (from && upto && (date < from || date > upto)) return [{ text: "Date out of Series Period...", title: "Date Warning", kind: "stop" }];

  if (session.userType !== "AD") {
    const beyond = new Date(session.tarikh2.getFullYear(), session.tarikh2.getMonth(), session.tarikh2.getDate() + 1);
    const lockFrom = parseDay(field(bn, "lock_from")) ?? beyond;
    const lockUpto = parseDay(field(bn, "lock_upto")) ?? beyond;
    let openFrom = beyond;
    let openUpto = beyond;
    const openUser = text(bn, "open_user");
    if (text(bn, "open_from") !== "" && openUser !== "" && openUser === String(session.userNo)) {
      openFrom = parseDay(field(bn, "open_from")) ?? beyond;
      openUpto = parseDay(field(bn, "open_upto")) ?? openUpto;
    }
    if (lockFrom <= session.tarikh2) {
      const checked = input.editKey > 0 ? (parseDay(input.editDate) ?? date) : date;
      let locked = true;
      if (openFrom <= session.tarikh2 && checked >= openFrom && checked <= openUpto) locked = false;
      if (locked && (checked < lockFrom || checked > lockUpto)) locked = false;
      if (locked) {
        return [{ text: `Period is lock from ${formatDesktopDate(lockFrom)} to... ${formatDesktopDate(lockUpto)} Entry Validation: Lock Date`, title: "Entry Date Lock Warning", kind: "stop" }];
      }
    }
  }

  // The GST start date: an opened VAT bill cannot move into GST, a GST bill cannot go back before it.
  if (session.coGstReq && book.slab && input.editKey > 0) {
    const start = dayOf(new Date(2017, 6, 1));
    if (input.taxGroup === "V") {
      if (date >= start) problems.push({ text: `VAT Bill Date can't be greater than or equal to ${formatDesktopDate(start)}`, title: "Invoice Validation: Date", kind: "stop", setDate: formatDesktopDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1)) });
    } else if (date < start) {
      problems.push({ text: `GST Bill Date can't be less than ${formatDesktopDate(start)}`, title: "Invoice Validation: Date", kind: "stop", setDate: formatDesktopDate(start) });
    }
  }
  return problems;
}

/**
 * Voucher_Validate_Account (Entry.cs): the account chosen for a voucher row. The messages are built in the desktop's order, a later one
 * replacing an earlier one; a day-lock message (DL) or a warning (DW) from the account master is shown for the voucher style.
 */
function voucherAccountProblems(loader: Loader, book: BookContext, input: HeaderInput, party: NonNullable<HeaderInput["party"]>, voucher: NonNullable<HeaderInput["voucher"]>): HeaderProblem[] {
  const partyLock = toText(loader.session.setup.party_lock).toUpperCase();
  const problems: HeaderProblem[] = [];
  let error = "";
  const message = party.message.trim();
  if (message !== "") {
    if (partyLock.includes("DL,")) error = `Party Lock Message : ${message}`;
    else if (partyLock.includes("DW,")) problems.push({ text: `Party Warning Message : ${message}`, title: "Party Warning", kind: "warn" });
  }
  if (voucher.bookName.trim().toUpperCase() === party.name.trim().toUpperCase()) error = "Book and Account can't be Same...";
  const date = parseDay(input.date);
  const start = parseDay(party.startDate);
  const last = parseDay(party.lastDate);
  if (start && date && date < start) error = "Selected Master not allowed as Entry Date is less than Account Start date";
  if (last && date && date > last) error = "Selected Master not allowed as Entry Date is greater than Account last date";
  const key = book.values.bookKey;
  const cashOrBank = (value: number) => value === 4 || value === 6;
  if (voucher.rows > 1 && cashOrBank(key) && cashOrBank(party.book)) error = "Contra entry can not have Multiple Rows";
  const allowed = (groups: readonly number[]) => groups.includes(party.book);
  if (key === 4 && !allowed([1, 2, 3, 4, 7])) error = "Account name not allowed in Cash entry";
  if (key === 4 && voucher.sideDbcode === 2 && party.book === 4) error = "Cash to Cash Contra entry allowed only from Payment Side";
  if (key === 5 && !allowed([1, 2, 3])) error = "Account name not allowed in Discount entry";
  if (key === 6 && !allowed([1, 2, 3, 4, 6, 7])) error = "Account name not allowed in Bank entry";
  if (key === 6 && voucher.sideDbcode === 2 && party.book === 6) error = "Bank to Bank Contra entry allowed only from Payment Side";
  if (key === 19 && [4, 6, 7].includes(party.book)) error = "Account name not allowed in JV entry";
  if (error !== "") return [...problems.filter((problem) => problem.kind === "warn"), { text: error, title: "Entry Warning", kind: "stop" }];
  return problems;
}

/** Tbx_PartyName_Leave: the messages in the order the desktop builds str_Error_Message (later ones replace earlier ones). */
function partyProblems(loader: Loader, book: BookContext, input: HeaderInput): HeaderProblem[] {
  const { session } = loader;
  const party = input.party;
  if (!party) return [];
  if (input.voucher) return voucherAccountProblems(loader, book, input, party, input.voucher);
  const partyPara = toText(session.setup.party_para).toUpperCase();
  const messPara = toText(session.setup.mess_para).toUpperCase();
  const adding = input.editKey === 0;
  const problems: HeaderProblem[] = [];
  let error = "";
  if (party.message.trim() !== "") {
    if (partyPara.includes("INV_LOCK,")) error = `Party Lock Message : ${party.message.trim()}`;
    else if (partyPara.includes("INV_WARN,")) problems.push({ text: `Party Warning Message : ${party.message.trim()}`, title: "Party Warning", kind: "warn" });
  }
  const date = parseDay(input.date);
  const start = parseDay(party.startDate);
  const last = parseDay(party.lastDate);
  if (start && date && date < start) error = "Selected Master not allowed as Entry Date is less than Account Start date";
  if (last && date && date > last) error = "Selected Master not allowed as Entry Date is greater than Account last date";
  if (party.book < 1 || party.book > 3) error = "Account name not allowed in Invoice entry";

  const limit = number(party.limit);
  const closing = number(party.closing);
  const salesBook = book.values.bookKey === 8;
  if (!partyPara.includes("REFALIMIT,")) {
    if (messPara.includes("WAMTLIMIT,") && adding && salesBook && closing > limit && limit > 0) {
      problems.push({ text: `Party's outstanding Amount Over than Limit...${party.limit}`, title: "Party Limit Warning", kind: "warn" });
    }
    if (partyPara.includes("AMTLIMIT,") && limit > 0 && error === "" && adding && salesBook) {
      if (closing > limit) error = `Party Warning Message : Party's outstanding Amount Over than Limit...${party.limit}`;
      if (session.userType === "AD" && session.licence === 51) error = "";
    }
  }
  if (error !== "") return [...problems.filter((problem) => problem.kind === "warn"), { text: error, title: "Entry Warning", kind: "stop" }];
  return problems;
}

export async function headerProblems(loader: Loader, entryName: string, book: BookContext, input: HeaderInput): Promise<HeaderProblem[]> {
  const entryId = toInt(field(await entryProperties(loader, entryName), "entry_key"));
  const values: EntryValues = { ...book.values, series: input.series, docDate: input.date, docNo: input.number, entryNat: input.editKey > 0 ? "E" : "A" };
  if (input.field === "party") return partyProblems(loader, book, input);
  const bn = await bookNumberRow(loader, entryId, values);
  if (!bn) return [];
  if (input.field === "date") return dateProblems(loader, book, bn, input);
  return numberProblems(loader, book, entryId, bn, input, values);
}
