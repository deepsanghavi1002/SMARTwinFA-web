import type { Client } from "pg";
import { Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toInt, toText } from "../master-program/legacy";
import { SETUP_SCHEMA } from "../master-program/session";
import { round, stockUnits, toNumber } from "./calc";
import { bookContext, entryProperties, loadBook, partyDetails, seriesDefaults } from "./invoice";
import type { BookContext } from "./invoice";
import { productChoice } from "./products";
import { TDS_PURCHASE_LIMIT, tdsBook, tdsInfo, tdsJournal } from "./tds";
import { BOOK } from "./values";
import { replaceEntryTokens } from "./values";
import type { EntryValues } from "./values";
import type { BookScreen, EntryOption, SlabRow } from "./types";
import { recalcLine, slabFromLines } from "../../features/entry/lines";
import type { Line } from "../../features/entry/lines";

/**
 * Save_Entry (Entry.cs) for a new invoice (EntryNat "A") of an account book, as far as the
 * setup's entry_save_properties drive it: the rows are read from smart_setup, each rule gives a
 * column and where its value comes from (a fixed value, a header box, a grid column, a system
 * value), and the account / product postings (Save_CodePost, Save_ProductPost) follow.
 *
 * The plan is built here and run by runSave: always inside a transaction, and only committed
 * when the caller asks (see app/api/entry/route.ts). Edit and Delete, the stock registers
 * (PROCESS), multi-addon item grids, the outstanding set-off rows and the licence-specific
 * branches are not ported: docs/PENDING-WORK.md lists them.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name)).trim();

export type SaveInput = Readonly<{
  /** Header and foot box values by lowercase control name (cmb_series, dtp_date, tbx_number ...). */
  values: Readonly<Record<string, string>>;
  party: Readonly<{ code: number; addressId?: number }>;
  /** The filled product rows: cells by product grid column. The product is looked up from prodKey. */
  lines: readonly Readonly<{ prodKey: number; cells: Readonly<Record<string, string>> }>[];
  /** The slab grid, one entry per slab row in grid order: the % (or tax text) and amount as typed. */
  slab: readonly Readonly<{ perc: string; amount: string; manual?: boolean }>[];
  /** Entry addon values by addon key (the addon grid under the slab). */
  addon: Readonly<Record<number, string>>;
  taxGroup: "G" | "I" | "V";
  /** The unique_key of the opened invoice when this save changes it (Edit); absent for a new invoice. */
  editKey?: number;
  /** The Outstanding tab's set-offs (c1dg_OutClear): the pending bill (its outclear key) and the amount set off against it. */
  setoffs?: readonly Readonly<{ outKey: number; amount: string }>[];
  /** The final amount the screen shows: the server works the figure out again and must agree. */
  finalAmount: string;
}>;

/** One statement of the plan. An insert names its key column so a dry run can number it without touching the sequence. */
export type Statement =
  | Readonly<{ kind: "insert"; table: string; /** Another schema than the company's (the _biglog one). */ schema?: string; keyColumn?: string; columns: string[]; values: string[]; capture?: "pkval_1" | "pkval_2" | "pkval_3" | "jv_1" | "jv_2"; /** The product row this insert makes: its key can be named as @il_N later. */ ilLine?: number; label: string }>
  | Readonly<{ kind: "sql"; sql: string; label: string }>
  | Readonly<{ kind: "set"; key: "pkval_1" | "pkval_2" | "pkval_3"; value: number; ilLine?: number; label: string }>;

export type SavePlan = Readonly<{ statements: Statement[]; presetKeys: Record<string, number>; summary: Readonly<{ fullDocNo: string; finalAmount: number; bookAmount: number; party: number; renumberedFrom?: string }>; warnings: string[] }>;

const KEY_COLUMN: Record<string, string> = {
  ledger: "led_key", ledger_ext: "ledext_key", ledger_post: "post_key", prod_ledger: "il_key", outclear: "out_key",
  addon_aentry: "aona_key", log_ledger: "lled_key", log_regtrn: "lreg_key", process: "process_key", expense_link: "elink_key",
};

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const numeric = (value: string | number): string => {
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) throw new Error(`"${value}" is not a number`);
  return String(parsed);
};
const dateLiteral = (date: Date) => quote(formatDesktopDate(date));
const timeText = (now: Date) => `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
/** ledger and prod_ledger have a column "TYPE" in capitals (a PostgreSQL name that needs its quotes). */
const columnName = (name: string) => (name.toLowerCase() === "type" ? '"TYPE"' : name);
const padLeft = (value: string, size: number) => value.padStart(size, " ");

type SlabGridRow = {
  key: number;
  mathOp: string;
  master: boolean;
  itemWise: boolean;
  amount: number;
  runTotal: number;
  percText: string;
  perc: number;
  taxRec: number;
  accode: number;
  postDb: number;
  /** slab_pos "P" rows the product rows feed. */
  desc: string;
};

type Ctx = {
  loader: Loader;
  book: BookContext;
  screen: BookScreen;
  input: SaveInput;
  now: Date;
  values: EntryValues;
  series: string;
  number: string;
  docDate: Date;
  chlnDate: Date;
  fullDocNo: string;
  finalAmount: number;
  prodAmount: number;
  bkDbcode: number;
  acDbcode: number;
  stockNat: string;
  slab: SlabGridRow[];
  lines: { cells: Record<string, string>; product: NonNullable<Line["product"]>; il: Record<string, number | string> }[];
  bookNumber: Row | undefined;
  /** "A" a new invoice, "E" a changed one (the update rules, EntryNat E). */
  mode: "A" | "E";
  /** The opened invoice's ADDON_AENTRY key, 0 when it has none. */
  aonaKey: number;
  /** account.book of the party (2 debtors, 3 creditors): which control account follows the party's postings. */
  partyBook: number;
  bookAmount: number;
  addonRows: { save: string; type: string; value: string; key: number }[];
  uomKey: (short: string) => number;
  uomRound: (key: number) => number;
  /** A stock register's entry (process), not an account book's (ledger). */
  stock: boolean;
  /** Job Stock Out / In: which one decides, for each row, whether it moves stock (inventory Y / N). */
  jobMode: "OUT" | "IN" | "";
  /** An expense / agency book: the expense account chosen in Exp. Name (|sys.exp_code|), 0 when none. */
  expCode: number;
};

type Rule = Row;

async function loadRules(loader: Loader, entryId: number, mode: "A" | "E"): Promise<Rule[]> {
  const flag = mode === "A" ? "add_save" : "update_save";
  return (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_save_properties WHERE entrykey_id = $1 AND record_active AND ${flag} ORDER BY save_order, table_order, field_order, entrysave_key`, [entryId])) ?? [];
}

/** The book-key list a rule is saved for (save_only_forbook: " 8, 9, 10,"). */
/** The book a save rule is chosen by: a stock register (Job Stock In / Out ...) by its own book (int_type), an account book by its book key. */
const ruleBook = (values: Pick<EntryValues, "bookActual" | "type" | "bookKey">) => (!values.bookActual && values.type > 0 ? values.type : values.bookKey);
const savedForBook = (rule: Rule, bookKey: number) => {
  const list = text(rule, "save_only_forbook");
  return list === "" || list.includes(` ${bookKey},`) || list.startsWith(`${bookKey},`) || list.replace(/ /g, "").split(",").includes(String(bookKey));
};

/** Lib_GlobalFunctions.FormulaValidation for the operators the setup uses. */
function formula(operator: string, left: string, right: string): boolean {
  const a = left.trim().replace(/^'|'$/g, "");
  const b = right.trim().replace(/^'|'$/g, "");
  const da = parseDesktopDate(a);
  const db = parseDesktopDate(b);
  const numbers = a !== "" && b !== "" && Number.isFinite(Number(a)) && Number.isFinite(Number(b));
  const x: number | string = numbers ? Number(a) : da && db && /[A-Za-z/-]/.test(a) ? da.getTime() : a;
  const y: number | string = numbers ? Number(b) : da && db && /[A-Za-z/-]/.test(b) ? db.getTime() : b;
  switch (operator.trim()) {
    case ">": return x > y;
    case "<": return x < y;
    case ">=": return x >= y;
    case "<=": return x <= y;
    case "<>": case "!=": return x !== y;
    case "=": case "==": return x === y;
    default: return true;
  }
}

/** Func_ReplaceSysVal_CtrlValue for the system values the save rules use, as an SQL literal. */
function sysLiteral(ctx: Ctx, name: string, grid?: { il?: Record<string, number | string> }): string {
  const { book, values } = ctx;
  const lower = name.toLowerCase().replace(/^\|?sys\./, "").replace(/\|$/, "");
  const bookActual = values.bookActual;
  switch (lower) {
    case "bk_dbcode": return String(ctx.bkDbcode);
    case "ac_dbcode": return String(ctx.acDbcode);
    case "book": return String(values.bookKey);
    case "book_code": return values.bookCode === 0 ? "null" : String(values.bookCode);
    case "ag_book": return String(values.agBook);
    case "ag_bkcode": return values.agCode === 0 ? "null" : String(values.agCode);
    case "entry_book_code": return String((values.bookKey === BOOK.AGENCY || values.bookKey === BOOK.EXPENSE) && ctx.expCode > 0 ? ctx.expCode : values.bookCode);
    case "type": return String(values.type);
    case "blank": return "''";
    case "null": return "null";
    case "doc_lock": return "''";
    case "prod_amt": return String(ctx.prodAmount);
    case "year_id": return quote(ctx.loader.session.yearId);
    case "inv_@pkval_1": return bookActual ? "@pkval_1" : "null";
    case "inv_@pkval_3": return bookActual ? "null" : "@pkval_3";
    case "led_key": return "@pkval_1";
    case "process_key": return bookActual ? "0" : "@pkval_3";
    case "doc_no1": return quote(padLeft(ctx.input.values.tbx_chlnno ?? "", 10));
    case "doc_date": return dateLiteral(ctx.docDate);
    case "doc_chlndate": return dateLiteral(ctx.chlnDate);
    case "chln_date": return dateLiteral(ctx.chlnDate);
    case "stock_nat": return quote(typeof grid?.il?._nat === "string" ? grid.il._nat : ctx.stockNat);
    case "stock_nat1": return quote((typeof grid?.il?._nat === "string" ? grid.il._nat : ctx.stockNat) === "A" ? "L" : "A");
    case "ac_code": return ctx.input.party.code === 0 ? "null" : String(ctx.input.party.code);
    case "ac_book": return String(ctx.partyBook);
    case "full_docno": return quote(ctx.fullDocNo);
    case "inventory": return quote(typeof grid?.il?._inv === "string" ? grid.il._inv : book.inventory ? "Y" : "N");
    case "entry_short": return quote(!bookActual && book.stkmToShort !== "" ? book.stkmToShort : values.stkmShort);
    case "stkm_short": return quote(values.stkmShort);
    case "stkm_id": return quote(book.stkmId);
    case "stkm_fromshort": return quote(values.stkmFromShort);
    case "inv_amt": return String(ctx.finalAmount);
    case "inv_book_amt": return String(ctx.bookAmount);
    case "file_inv_amt": case "file_inv_book_amt": return "0";
    case "today": case "last_savedate": return dateLiteral(ctx.now);
    case "entrynat": return `'${ctx.mode}'`;
    case "user_id": return String(ctx.loader.session.userNo);
    case "narration": return quote((ctx.input.values.tbx_narration ?? "").trim());
    case "time": case "last_savetime": return quote(timeText(ctx.now));
    case "doc_no": return quote(ctx.number);
    case "exp_code": return ctx.expCode > 0 ? String(ctx.expCode) : "null";
    case "il_div": return grid?.il?.il_div !== undefined && Number(grid.il.il_div) > 0 ? String(grid.il.il_div) : "null";
    case "address_id": return String(ctx.input.party.addressId && ctx.input.party.addressId > 0 ? Math.trunc(ctx.input.party.addressId) : 1);
    case "machine_name": return quote("WEB");
    case "bn_docno": return quote(text(ctx.bookNumber, "bn_docno"));
    case "bn_docno1": return quote(text(ctx.bookNumber, "bn_docno1"));
    case "bn_lastdate": { const d = parseDesktopDate(field(ctx.bookNumber, "bn_lastdate")); return quote(d ? formatDesktopDate(d) : ""); }
    case "bn_lastchlndate": { const d = parseDesktopDate(field(ctx.bookNumber, "bn_lastchlndate")); return quote(d ? formatDesktopDate(d) : ""); }
    default: return UNKNOWN;
  }
}
const UNKNOWN = "\u0000unknown";
/** A system value a rule needs; one this port does not know stops the save. */
function sysRequired(ctx: Ctx, name: string, grid?: { il?: Record<string, number | string> }): string {
  const value = sysLiteral(ctx, name, grid);
  if (value === UNKNOWN) throw new Error(`The save rule uses the system value ${name}, which is not ported`);
  return value;
}

/** The text of a fixed value: {column} takes the grid row's cell, |sys.x| a system value. */
function fixedText(ctx: Ctx, raw: string, cell: (name: string) => string, il?: Record<string, number | string>): string {
  let out = raw;
  while (out.includes("{")) {
    const name = out.slice(out.indexOf("{") + 1, out.indexOf("}"));
    out = out.replace(`{${name}}`, cell(name));
  }
  out = out.replace(/\|sys\.[A-Za-z_@0-9.]+\|/g, (token) => { const value = sysLiteral(ctx, token, { il }); return value === UNKNOWN ? token : value; });
  return out;
}

const HEADER_CONTROL: Record<string, string> = {
  dtp_date: "dtp_date", tbx_number: "tbx_number", cmb_series: "cmb_series", tbx_chlnno: "tbx_chlnno", tbx_narration: "tbx_narration",
  tbx_credit_days: "tbx_credit_days", dtp_chlndate: "dtp_chlndate", dtp_entrydate: "dtp_entrydate", tbx_entryno: "tbx_entryno",
  tbx_distancekm: "tbx_distancekm", tbx_ewaybillno: "tbx_ewaybillno", tbx_ewayvalid: "tbx_ewayvalid", dtp_ewaydate: "dtp_ewaydate",
};

/** A header / foot box as its rule saves it (the Control name branch of Save_Entry). */
function headerValue(ctx: Ctx, rule: Rule): string {
  const control = text(rule, "control_name").toLowerCase();
  const saveValue = text(rule, "save_value").toUpperCase();
  const typed = (name: string) => (ctx.input.values[name] ?? "").toString();
  switch (control) {
    case "tbx_partyname": return saveValue === "V" ? (ctx.input.party.code === 0 ? "null" : String(ctx.input.party.code)) : quote(typed("tbx_partyname"));
    case "dtp_date": return dateLiteral(ctx.docDate);
    case "tbx_number": return quote(text(rule, "column_justify").toUpperCase() === "R" ? padLeft(ctx.number, toInt(field(rule, "column_size"))) : ctx.number);
    case "cmb_series": return quote(ctx.series);
    case "full_docno": return quote(ctx.fullDocNo);
    case "tbx_chlnno": return quote(padLeft(typed("tbx_chlnno"), toInt(field(rule, "column_size"))));
    case "tbx_final_amt": return String(ctx.finalAmount);
    case "tbx_narration": return quote(typed("tbx_narration").trim());
    case "tbx_credit_days": return typed("tbx_credit_days") === "" ? "" : numeric(typed("tbx_credit_days"));
    case "cmb_rev_entry": return "'N'";
    case "dtp_chlndate": return dateLiteral(ctx.chlnDate);
    case "dtp_entrydate": return typed("dtp_entrydate") === "" ? "null" : dateLiteral(parseDesktopDate(typed("dtp_entrydate")) ?? ctx.docDate);
    case "tbx_entryno": return quote(padLeft(typed("tbx_entryno"), toInt(field(rule, "column_size"))));
    case "cmb_supplytype": case "cmb_subsupplytype": case "cmb_documenttype": case "cmb_vehicletype": case "cmb_transportmode": {
      if (saveValue !== "V") return "0";
      const options = ctx.screen.controls.find((item) => item.name === control)?.options ?? [];
      const at = options.findIndex((option) => option.text === typed(control));
      return String(Math.max(at, 0));
    }
    case "tbx_distancekm": return quote(typed("tbx_distancekm"));
    case "tbx_ewaybillno": return quote(typed("tbx_ewaybillno"));
    case "tbx_ewayvalid": return quote(typed("tbx_ewayvalid"));
    case "dtp_ewaydate": return dateLiteral(parseDesktopDate(typed("dtp_ewaydate")) ?? ctx.docDate);
    default: return "";
  }
}

const DEFAULT_BY_TYPE: Record<string, string> = { N: "0", C: "0", I: "0", T: "''" };

/** A header rule's value: a fixed value, else the box, else the system value. "" means the rule gives nothing. */
function ruleValue(ctx: Ctx, rule: Rule): string {
  const type = text(rule, "save_data_type").toUpperCase();
  const fix = toText(field(rule, ctx.mode === "E" ? "update_fixvalue" : "add_fixvalue"));
  let value = "";
  if (fix.length > 0) {
    switch (type) {
      case "T": value = fix.includes("sys.") || fix.startsWith("(case when") ? fixedText(ctx, fix, () => "", undefined) : quote(fix); break;
      case "D": value = dateLiteral(parseDesktopDate(fix) ?? ctx.now); break;
      default: value = fixedText(ctx, fix, () => "0");
    }
    if (type === "T" && value.startsWith("(case when") === false && !value.startsWith("'")) value = quote(value);
  } else if (text(rule, "control_name") !== "") {
    value = headerValue(ctx, rule);
  } else if (text(rule, "system_value") !== "") {
    value = sysRequired(ctx, `|${text(rule, "system_value")}|`);
  }
  value = value.replace(/OUT_SETOFF\+OUT_LY_SETOFF/gi, "(out_setoff::numeric+out_ly_setoff::numeric)");
  if (value === "") value = type === "T" ? "''" : DEFAULT_BY_TYPE[type] ?? "";
  if (type === "T" && toInt(field(rule, "save_leftchrno")) > 0 && value.startsWith("'")) {
    const bare = value.slice(1, -1);
    value = `'${bare.slice(0, toInt(field(rule, "save_leftchrno")))}'`;
  }
  return value;
}

/** A grid rule's value for one row (Save_MultipleLoop_forGrid): fixed, else the grid's column, else the system value. */
function gridValue(ctx: Ctx, rule: Rule, cells: Record<string, string>, il?: Record<string, number | string>): string {
  const type = text(rule, "save_data_type").toUpperCase();
  const cell = (name: string) => (cells[name] ?? "").toString();
  const fix = toText(field(rule, ctx.mode === "E" ? "update_fixvalue" : "add_fixvalue"));
  const column = text(rule, "column_name");
  const saveValue = text(rule, "save_value").toUpperCase();
  // A rule that names a key placeholder (@pkval) takes it, whatever the row also holds under that column name.
  const has = column !== "" && Object.prototype.hasOwnProperty.call(cells, column) && !text(rule, "system_value").includes("pkval");
  // The slab's tax_id rule reads the % column as a key (V): the tax's key for a tax row, else nothing.
  if (column === "slab_perc" && saveValue === "V" && type === "I") return cells.tax_id && cells.tax_id !== "" ? numeric(cells.tax_id) : "null";
  let value = "";
  if (fix.length > 0) {
    if (type === "T") value = fix.includes("{") || fix.includes("sys.") ? fixedText(ctx, fix, cell, il) : fix;
    else if (type === "D") value = dateLiteral(parseDesktopDate(fix) ?? ctx.now);
    else value = fixedText(ctx, fix, cell, il);
    if (type === "T" && !value.startsWith("(case when")) value = quote(value.startsWith("'") && value.endsWith("'") && fix.includes("sys.") ? value.slice(1, -1) : value);
  } else if (has) {
    const raw = cell(column);
    switch (type) {
      case "T": value = quote(raw); break;
      case "I": value = raw.trim() === "" ? "null" : numeric(raw); break;
      case "C": value = raw.trim() === "" ? "0" : numeric(raw); break;
      case "N": value = raw.trim() === "" ? "0" : /^-?[\d.,]+$/.test(raw.trim()) ? numeric(raw) : "0"; break;
      case "D": value = dateLiteral(parseDesktopDate(raw) ?? ctx.docDate); break;
    }
  } else if (text(rule, "system_value") !== "" && text(rule, "system_value").toLowerCase() !== "sys.{colvalue}") {
    value = sysRequired(ctx, `|${text(rule, "system_value")}|`, { il });
  } else if (saveValue === "V" && column !== "") {
    value = cell(column) === "" ? "null" : numeric(cell(column));
  }
  if (value === "") value = type === "T" ? "''" : type === "I" ? "null" : type === "D" ? "null" : "0";
  // out_setoff is a money column here: arithmetic on it is done as numeric.
  value = value.replace(/\bout_setoff(?=\s*[+-])/gi, "out_setoff::numeric");
  return value;
}

/** The plan's rows: the rule groups of a save_order, as the desktop walks them (table by table, one statement per table group). */
function groups(rows: Rule[]): Rule[][] {
  const out: Rule[][] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && text(last[0], "table_name").toUpperCase() === text(row, "table_name").toUpperCase() && toInt(field(last[0], "table_order")) === toInt(field(row, "table_order"))) last.push(row);
    else out.push([row]);
  }
  return out;
}

function pushPostAccount(ctx: Ctx, statements: Statement[], code: number, dbcode: number, amount: number, bookOfAccount: number, bookCode: string, label: string) {
  let side = dbcode;
  if (amount < 0) side = side === 1 ? 2 : 1;
  const signed = amount; // "+": the posting adds
  const absolute = Math.abs(signed);
  const column = side === 1 ? "debit" : "credit";
  const closing = side === 1 ? absolute : -absolute;
  const year = quote(ctx.loader.session.yearId);
  statements.push({ kind: "sql", label: `${label}: ac_balance ${code}`, sql: `UPDATE |sys.db|ac_balance SET closing = (closing::numeric + (${closing}))::money, ${column} = (${column}::numeric + (${absolute}))::money WHERE code = ${code} AND a_recflag = 'AC' AND year_id = ${year}` });
  if (bookOfAccount === 2 || bookOfAccount === 3) {
    statements.push({ kind: "sql", label: `${label}: control account ${bookOfAccount - 1}`, sql: `UPDATE |sys.db|ac_balance SET closing = (closing::numeric + (${closing}))::money, ${column} = (${column}::numeric + (${absolute}))::money WHERE code = ${bookOfAccount - 1} AND a_recflag = 'AC' AND year_id = ${year}` });
  }
  statements.push({
    kind: "insert", table: "ledger_post", keyColumn: KEY_COLUMN.ledger_post, label: `${label}: ledger_post ${code}`,
    columns: ["led_id", "post_code", "post_date", "post_bookcd", "post_amt", "post_dbcode", "post_book", "year_id"],
    values: ["@pkval_1", String(code), dateLiteral(ctx.docDate), bookCode, String(absolute), String(side), String(ctx.values.bookKey), year],
  });
}

function pushPostProduct(ctx: Ctx, statements: Statement[], prodId: number, trn: Record<string, number>, stockNat: string, label: string) {
  const year = quote(ctx.loader.session.yearId);
  const a = stockNat === "A";
  const move = a ? "add" : "less";
  const sign = a ? "+" : "-";
  const set = ["qty1", "qty2", "qty3", "pcs", "pack", "weight"].map((unit) => {
    const value = trn[unit === "pcs" ? "trn_pcs" : unit === "pack" ? "trn_pack" : unit === "weight" ? "trn_weight" : `trn_${unit}`] ?? 0;
    return [`${move}_${unit} = ${move}_${unit} + (${value})`, `clsg_${unit} = clsg_${unit} ${sign} (${value})`];
  }).flat();
  statements.push({ kind: "sql", label, sql: `UPDATE |sys.db|prod_balance SET ${set.join(", ")} WHERE prec_flag = 'RP' AND year_id = ${year} AND prod_id = ${prodId}` });
}

export async function buildSave(loader: Loader, entryName: string, firstCombo: EntryOption, input: SaveInput, now = new Date()): Promise<SavePlan> {
  const { session } = loader;
  const warnings: string[] = [];
  const book = await bookContext(loader, entryName, firstCombo);
  // A stock register's entry (Job Stock In / Out ...) is saved to process (its unique key is process_key) with its product rows; no ledger, no postings.
  const stock = !book.values.bookActual;
  const screen = await loadBook(loader, entryName, firstCombo, input.taxGroup);
  const entryId = toInt(field(await entryProperties(loader, entryName), "entry_key"));

  const series = (input.values.cmb_series ?? "").trim();
  let number = (input.values.tbx_number ?? "").trim();
  const docDate = parseDesktopDate(input.values.dtp_date);
  if (series === "" || number === "" || !docDate) throw new Error("Series, date and number are needed to save");
  if (input.party.code <= 0 && screen.party) throw new Error("Choose the party before saving");
  const chlnDate = parseDesktopDate(input.values.dtp_chlndate) ?? docDate;
  let fullDocNo = `${series}/${number}`;

  // Edit: the opened invoice, found by its unique_key; a locked one (doc_lock Y) cannot be changed.
  const mode: "A" | "E" = (input.editKey ?? 0) > 0 ? "E" : "A";
  const stockModule = text(book.row, "stkm_short");
  const editLed = mode === "E"
    ? (stock
      ? (await loader.readTable(`SELECT * FROM |sys.db|process WHERE process_key = $1 AND il_pos = 'A' AND BTRIM(stk_module) = $2`, [input.editKey, stockModule]))?.[0]
      : (await loader.readTable(`SELECT * FROM |sys.db|ledger WHERE unique_key = $1 AND doc_pos = 'A' AND book = $2`, [input.editKey, book.values.bookKey]))?.[0])
    : undefined;
  if (mode === "E" && !editLed) throw new Error("The invoice to change was not found: it may have been deleted");
  if (mode === "E" && !stock && text(editLed, "doc_lock").toUpperCase() === "Y") throw new Error("Current Entry Lock...  Changes Save not Allowed....");
  // The key the product, slab and addon rows hang on: led_key, or process_key for a stock register.
  const ledKey = mode === "E" ? toInt(field(editLed, stock ? "process_key" : "led_key")) : 0;
  // Duplicate guard: Save's "select @pkval_1=COUNT(*) ... where full_docno" check (the invoice being changed does not count).
  const taken = async (docNo: string) => Boolean(stock
    ? await loader.readTable(`SELECT process_key FROM |sys.db|process WHERE full_docno = $1 AND il_pos = 'A' AND BTRIM(stk_module) = $2 AND p_date BETWEEN $3 AND $4 AND process_key <> $5`, [docNo, stockModule, session.tarikh1, session.tarikh2, ledKey])
    : await loader.readTable(`SELECT led_key FROM |sys.db|ledger WHERE full_docno = $1 AND doc_pos = 'A' AND book = $2 AND doc_date BETWEEN $3 AND $4 AND led_key <> $5`, [docNo, book.values.bookKey, session.tarikh1, session.tarikh2, ledKey]));
  // The save lock is already held (the route takes it first), so what is read here is what every earlier save committed.
  // A new invoice whose number was taken meanwhile (another user saved it first) is given the next number after the highest.
  let renumberedFrom = "";
  if (await taken(fullDocNo)) {
    if (mode === "E") throw new Error(`${fullDocNo} is already saved`);
    let candidate = (await seriesDefaults(loader, entryName, book, series, now, formatDesktopDate(docDate))).number;
    for (let tries = 0; /^\d+$/.test(candidate) && tries < 100 && (await taken(`${series}/${candidate}`)); tries += 1) candidate = String(BigInt(candidate) + BigInt(1));
    if (!/^\d+$/.test(candidate) || (await taken(`${series}/${candidate}`))) throw new Error(`${fullDocNo} is already saved`);
    renumberedFrom = number;
    number = candidate;
    fullDocNo = `${series}/${number}`;
    warnings.push(`Number ${renumberedFrom} was already saved by another entry: this invoice takes ${number}`);
  }

  // The product rows: units, uom keys and the recalculated figures (the desktop's grid arithmetic).
  const uomRows = (await loader.readTable(`SELECT uom_key, uom_short, uom_roundup FROM |sys.db|prod_uom`)) ?? [];
  const uomKey = (short: string) => toInt(field(uomRows.find((uom) => text(uom, "uom_short") === short.trim()), "uom_key"));
  const uomRound = (key: number) => toInt(field(uomRows.find((uom) => toInt(field(uom, "uom_key")) === key), "uom_roundup"));
  const slabRows: SlabRow[] = screen.slabRows.map((row, index) => ({ ...row, perc: input.slab[index]?.perc ?? row.perc, amount: input.slab[index]?.amount ?? row.amount, manual: input.slab[index]?.manual === true }));
  const columns = screen.product.columns.filter((column) => column.visible);
  const context = { book: screen, columns };
  const lines: Ctx["lines"] = [];
  const checked: Line[] = [];
  for (const [index, line] of input.lines.entries()) {
    const product = await productChoice(loader, entryName, firstCombo, line.prodKey, input.party.code, formatDesktopDate(docDate));
    const base: Line = { cells: { ...line.cells }, product };
    const again = recalcLine(base, "", context, slabRows);
    if (Math.abs(toNumber(again.cells.il_value) - toNumber(line.cells.il_value)) > 0.005) throw new Error(`Row ${index + 1}: the amount ${line.cells.il_value} does not follow its quantity and rate (${again.cells.il_value})`);
    checked.push(base);
    lines.push({ cells: { ...line.cells }, product, il: {} });
  }
  // A book with no product rows (agency / expense bills typed in the slab grid) works on the slab's amount alone.
  if (lines.length === 0 && book.inventory) throw new Error("Total of All Product can not be Zero Value");
  const result = slabFromLines(screen, slabRows, checked);
  const finalAmount = round(result.final, 2);
  if (Math.abs(finalAmount - toNumber(input.finalAmount)) > 0.005) throw new Error(`The final amount ${input.finalAmount} differs from the ${finalAmount} the server works out`);
  const prodAmount = result.amounts[0] ?? 0;
  if (lines.length === 0 && finalAmount <= 0) throw new Error("Total of All Product can not be Zero Value");
  if (mode === "E" && !stock) {
    const own = (await loader.readTable(`SELECT out_setoff::numeric AS setoff, out_ly_setoff::numeric AS ly FROM |sys.db|outclear WHERE out_ledid = $1 AND COALESCE(out_ag_outid, 0) = 0 ORDER BY out_key LIMIT 1`, [ledKey]))?.[0];
    const settled = toDecimal(field(own, "setoff")) + toDecimal(field(own, "ly"));
    if (own && finalAmount < settled) throw new Error(`The amount cannot be below what is already set off against this bill (${settled})`);
  }

  // Slab rows with their accounts and posting side (Save_Entry's slab_postdb loop).
  let bkDbcode = book.values.bkDbcode;
  let acDbcode = book.values.acDbcode;
  if (finalAmount < 0 && book.values.bookKey === 8) { bkDbcode = 1; acDbcode = 2; }
  const slabMaster = (await loader.readTable(`SELECT slab_key, slab_accode FROM |sys.db|slab_master`)) ?? [];
  const taxAccounts = new Map(((await loader.readTable(`SELECT tax_rec, tax_accode FROM |sys.db|tax_master`)) ?? []).map((row) => [toInt(field(row, "tax_rec")), toInt(field(row, "tax_accode"))]));
  const slab: SlabGridRow[] = slabRows.map((row, index) => {
    const amount = result.amounts[index] ?? 0;
    const option = row.master && !row.itemWise ? row.options?.find((candidate) => candidate.text === row.perc) : undefined;
    const taxRec = option ? toInt(option.value) : 0;
    // A tax row's account is the chosen tax's own (tax_master.tax_accode), else the slab's.
    const accountOf = (taxRec > 0 ? taxAccounts.get(taxRec) ?? 0 : 0) || toInt(field(slabMaster.find((candidate) => toInt(field(candidate, "slab_key")) === row.key), "slab_accode"));
    const postDb = bkDbcode === 1 ? (row.mathOp === "A" && amount >= 0 ? 1 : 2) : (row.mathOp === "A" && amount >= 0 ? 2 : 1);
    return {
      key: row.key, mathOp: row.mathOp, master: row.master, itemWise: row.itemWise, amount, runTotal: result.runTotals[index] ?? 0,
      percText: row.perc, perc: option ? screen.taxPercs[option.value] ?? 0 : toNumber(row.perc), taxRec, accode: accountOf, postDb, desc: row.desc,
    };
  });

  const bookNumber = (await loader.readTable(replaceEntryTokens(`Select bkno.*, bkset.* from |sys.db|book_number bkno left join |sys.db|book_setup bkset on bkno.bn_id=bkset.bs_rec where bkno.bn_series ='|sys.doc_series|' and bkno.bn_pos<>'D' and bkset.bksetup_pos<>'D' and bkset.book_code =|sys.book_code| order by bkno.bn_from desc`, { ...book.values, series, docNo: number, docDate: formatDesktopDate(docDate) })))?.[0];

  // Entry addon fields (ADDON_AENTRY): their names and kinds from addon_fld, the chosen option's key for a list.
  const party = screen.party ? await partyDetails(loader, entryName, firstCombo, input.party.code, formatDesktopDate(docDate)) : null;
  const addonRows: Ctx["addonRows"] = [];
  for (const item of party?.addon ?? []) {
    const def = (await loader.readTable(`SELECT fiel_save, fiel_type FROM |sys.db|addon_fld WHERE fiel_key = $1`, [item.key]))?.[0];
    if (!def) continue;
    const value = (input.addon[item.key] ?? "").toString();
    const option = item.options?.find((candidate) => candidate.text === value);
    addonRows.push({ save: text(def, "fiel_save"), type: text(def, "fiel_type").toUpperCase(), value, key: option ? toInt(option.value) : 0 });
  }

  const partyBook = input.party.code > 0 ? toInt(field((await loader.readTable(`SELECT book FROM |sys.db|account WHERE code = $1`, [input.party.code]))?.[0], "book")) : 0;
  const values: EntryValues = { ...book.values, series, docNo: number, docDate: formatDesktopDate(docDate), acCode: input.party.code };
  const ctx: Ctx = {
    loader, book, screen, input, now, values, series, number, docDate, chlnDate, fullDocNo, finalAmount, prodAmount, bkDbcode, acDbcode,
    stockNat: book.stockNat === "A" ? "A" : "L", slab, lines, bookNumber, mode, aonaKey: 0, partyBook, bookAmount: finalAmount, addonRows, uomKey, uomRound,
    expCode: toInt(screen.controls.find((control) => control.name === "cmb_ac_exp_name")?.options.find((option) => option.text === (input.values.cmb_ac_exp_name ?? "") || option.value === (input.values.cmb_ac_exp_name ?? ""))?.value),
    stock, jobMode: book.stockNatBoth ? (values.stkmShort === "JOB-OUT" ? "OUT" : values.stkmShort === "JOB-IN" || values.stkmShort === "LJOUT-IN" ? "IN" : "") : "",
  };

  // The cells as the screen shows them (the special log writes these), before the uom texts become keys below.
  const displayCells = lines.map((line) => ({ ...line.cells }));
  // Product rows' grid cells as C1dg_Inputdata holds them: cells plus the hidden columns the rules read.
  const copyBundle = toText(session.setup.entry_para).toUpperCase().includes("COPY_BUNDLE_PACK") && columns.some((column) => column.key === "bundle");
  lines.forEach((line, index) => {
    const cells = line.cells;
    const entryUom = uomKey(cells.uomentry_id ?? line.product.qtyUom);
    const rateUom = uomKey(cells.rateuom_id ?? line.product.rateUom);
    cells.uomentry_id = String(entryUom);
    cells.rateuom_id = String(rateUom);
    cells.prod_key = String(line.product.key);
    cells.prod_desc = line.product.desc;
    cells.il_serial = String(index + 1);
    const trn = stockUnits(toNumber(cells.quantity), toNumber(cells.factor), entryUom, rateUom, line.product.units, uomRound(rateUom), copyBundle ? (cells.bundle ?? "0") : null);
    for (const [key, value] of Object.entries(trn)) cells[key] = String(value);
    line.il = trn;
    // A stock register whose rows go either way: the +/- mark gives the row its direction (- is out), and a Job Stock row moves
    // stock only on the side the desktop's |sys.inventory| names (Job Out: the - rows; Job In: the + rows).
    if (book.stockNatBoth) {
      const mark = (cells.prod_return ?? "").trim();
      const nat = mark === "-" ? "L" : mark === "+" ? "A" : (cells.stock_nat ?? "").trim() === "L" ? "L" : "A";
      cells.stock_nat = nat;
      line.il = { ...trn, _nat: nat, ...(ctx.jobMode === "OUT" ? { _inv: nat === "A" ? "N" : "Y" } : ctx.jobMode === "IN" ? { _inv: nat === "L" ? "N" : "Y" } : {}) };
    }
    if (toNumber(cells.il_div) > 0) line.il.il_div = toNumber(cells.il_div);
  });

  if (session.flags.productAccountPosting) warnings.push("Product account posting (s_code, i_posting = Y) is not ported: product accounts are not posted");
  const rules = await loadRules(loader, entryId, mode);
  const statements: Statement[] = [];
  const presetKeys: Record<string, number> = {};
  const oldIl = new Map<number, Row>();
  if (mode === "E") {
    presetKeys[stock ? "pkval_3" : "pkval_1"] = ledKey;
    ctx.aonaKey = toInt(field((await loader.readTable(`SELECT aona_key FROM |sys.db|addon_aentry WHERE ${stock ? "aona_processid" : "aona_ledid"} = $1 ORDER BY aona_key LIMIT 1`, [ledKey]))?.[0], "aona_key"));
    for (const row of (await loader.readTable(`SELECT il_key FROM |sys.db|prod_ledger WHERE ${stock ? "process_id" : "led_id"} = $1 AND il_pos = 'A'`, [ledKey])) ?? []) oldIl.set(toInt(field(row, "il_key")), row);
    // The old postings come off first (Save_CodePost's "first delete all existing ledger_post of the led_key"); the slab rows go and are written again.
    statements.push(...(await reversal(loader, ledKey, session.yearId, stock)));
    statements.push({ kind: "sql", label: "old slab rows", sql: `DELETE FROM |sys.db|ledger_ext WHERE ${stock ? "process_id" : "led_id"} = ${ledKey}` });
    for (const line of lines) {
      const key = toInt(line.cells._il_key);
      if (key > 0 && !oldIl.has(key)) throw new Error("A product row does not belong to this invoice");
    }
  }
  // ---- The Outstanding tab: what this entry sets off against the party's pending bills (c1dg_OutClear, save_order 8)
  const wanted = (input.setoffs ?? []).map((item) => ({ outKey: Number(item.outKey), amount: String(round(toNumber(item.amount), 2)) })).filter((item) => toNumber(item.amount) > 0);
  if (wanted.some((item) => !Number.isInteger(item.outKey) || item.outKey <= 0)) throw new Error("A set-off bill is not valid");
  const setoffRule = rules.some((rule) => text(rule, "grid_name").toLowerCase() === "c1dg_outclear" && field(rule, "multiple_save") === true && savedForBook(rule, ruleBook(book.values)));
  if (wanted.length > 0 && !setoffRule) throw new Error("This register does not set off outstanding bills");
  const oldSetoff = new Map<number, number>();
  if (mode === "E") {
    // The old set-offs come off the bills they were set against, and their rows go; the typed ones are written afresh below.
    for (const row of (await loader.readTable(`SELECT out_key, out_ag_outid, out_setoff::numeric AS setoff FROM |sys.db|outclear WHERE out_ledid = $1 AND COALESCE(out_ag_outid, 0) > 0`, [ledKey])) ?? []) {
      const bill = toInt(field(row, "out_ag_outid"));
      const amount = toDecimal(field(row, "setoff"));
      oldSetoff.set(bill, (oldSetoff.get(bill) ?? 0) + amount);
      statements.push({ kind: "sql", label: `set-off of bill ${bill} taken back`, sql: `UPDATE |sys.db|outclear SET out_setoff = out_setoff::numeric - ${amount}, clear_pos = (case when out_setoff::numeric - ${amount} + out_ly_setoff::numeric = 0 then 'P' else 'C' end) WHERE out_key = ${bill}` });
    }
    statements.push({ kind: "sql", label: "old set-off rows", sql: `DELETE FROM |sys.db|outclear WHERE out_ledid = ${ledKey} AND COALESCE(out_ag_outid, 0) > 0` });
  }
  if (wanted.length > 0) {
    if (new Set(wanted.map((item) => item.outKey)).size !== wanted.length) throw new Error("A bill is set off twice");
    const bills = (await loader.readTable(`SELECT out_key, out_fulldocno, code, (out_entryamt::numeric - out_setoff::numeric - out_ly_setoff::numeric) AS pending FROM |sys.db|outclear WHERE out_key = ANY($1::int[]) AND COALESCE(out_ag_outid, 0) = 0`, [wanted.map((item) => item.outKey)])) ?? [];
    let total = 0;
    for (const item of wanted) {
      const bill = bills.find((row) => toInt(field(row, "out_key")) === item.outKey);
      if (!bill || toInt(field(bill, "code")) !== input.party.code) throw new Error("A set-off bill does not belong to this party");
      const amount = toNumber(item.amount);
      const pending = toDecimal(field(bill, "pending")) + (oldSetoff.get(item.outKey) ?? 0);
      if (amount > pending + 0.005) throw new Error(`Outstanding Setoff Amount can not be greater than Balance Pending Amount... (${text(bill, "out_fulldocno")}: ${round(pending, 2)})`);
      total += amount;
    }
    if (total > finalAmount + 0.005) throw new Error("Outstanding Setoff Amount can not be greater than Entry Amount...");
  }
  const logfileOff = toText(session.setup.logfile).toUpperCase() === "N";
  const orders = [...new Set(rules.map((rule) => toInt(field(rule, "save_order"))))].sort((a, b) => a - b);
  let bookAmount = finalAmount;

  for (const order of orders) {
    const set = rules.filter((rule) => toInt(field(rule, "save_order")) === order);
    const first = set[0];
    const table = text(first, "table_name").toUpperCase();
    const queryType = text(first, mode === "A" ? "query_add_type" : "query_update_type").toUpperCase();
    if (queryType === "S") continue;
    if (!savedForBook(first, ruleBook(book.values))) continue;
    if (logfileOff && table.includes("LOG_")) continue;
    const gridName = text(first, "grid_name").toLowerCase();
    const multiple = field(first, "multiple_save") === true;

    if (multiple) {
      if (gridName === "c1dg_slab") {
        slab.forEach((row, index) => {
          if (!row.master && row.amount === 0) return;
          const cells: Record<string, string> = {
            slab_id: String(row.key), slab_amount: String(row.amount), s_lastot: String(row.runTotal), slab_perc: row.master ? String(row.perc) : (row.itemWise ? "0" : row.percText),
            tax_id: row.master && row.taxRec > 0 ? String(row.taxRec) : "", slab_accode: String(row.accode), slab_postdb: String(row.postDb),
          };
          for (const group of groups(set)) {
            runGroup(ctx, statements, group, cells, undefined, `slab ${index + 1}`);
          }
          // Slab-account posting (the codepost rule, bl_Slab_Account_Post): the book's own amount gives up what a slab account takes.
          void 0;
        });
        // After the slab rows' ledger_ext, post the rows that have an account.
        if (toText(session.setup.s_posting).toUpperCase() === "Y") {
          for (const row of slab) {
            if (row.accode <= 0 || (row.amount === 0 && !row.master)) continue;
            const side = row.mathOp === "L" || row.amount < 0 ? ctx.acDbcode : ctx.bkDbcode;
            if (row.mathOp === "L" || row.amount < 0) bookAmount += Math.abs(row.amount); else bookAmount -= row.amount;
            pushPostAccount(ctx, statements, row.accode, side, row.amount, 1, String(book.values.bookCode), `slab ${row.desc}`);
          }
        }
        continue;
      }
      if (gridName === "c1dg_outclear") {
        // One row per bill: this entry's set-off row (insert) and the bill's own row (out_setoff up, clear_pos), by the setup's rules.
        wanted.forEach((item, index) => {
          const cells: Record<string, string> = { out_key: String(item.outKey), out_setoff: String(toNumber(item.amount)), out_setoff_file: "0" };
          for (const group of groups(set)) runGroup({ ...ctx, mode: "A" }, statements, group, cells, undefined, `set-off ${index + 1}`);
        });
        continue;
      }
      if (gridName === "c1dg_inputdata") {
        const productPosting = session.flags.productAccountPosting;
        void productPosting;
        lines.forEach((line, index) => {
          const ilKey = mode === "E" ? toInt(line.cells._il_key) : 0;
          if (ilKey > 0) statements.push({ kind: "set", key: "pkval_2", value: ilKey, ilLine: index + 1, label: `row ${index + 1}: key` });
          const rowStart = statements.length;
          for (const group of groups(set)) {
            const head = group[0];
            if (!savedForBook(head, ruleBook(book.values))) continue;
            if (text(head, "codepost_para") !== "") {
              const cp = text(head, "codepost_file").toUpperCase();
              if (text(head, "codepost_para").split(",")[8] !== "+") continue;
              if (cp === "P") {
                if (!book.inventory) continue;
                if (text(head, "codepost_para").includes("sys.str_addon_mbal")) continue;
                if (!text(head, "codepost_para").includes("'RP'")) continue;
                // A Job Stock row on the side that does not move stock (inventory N) leaves the balance alone.
                if (line.il._inv === "N") continue;
                pushPostProduct(ctx, statements, line.product.key, line.il as Record<string, number>, typeof line.il._nat === "string" ? line.il._nat : ctx.stockNat, `row ${index + 1}: prod_balance`);
              }
              continue;
            }
            runGroup(ctx, statements, group, line.cells, line.il, `row ${index + 1}`, ilKey > 0 ? { column: "il_key", value: ilKey } : undefined);
          }
          for (let at = rowStart; at < statements.length; at += 1) {
            const made = statements[at];
            if (made.kind === "insert" && made.table === "prod_ledger") statements[at] = { ...made, ilLine: index + 1 };
          }
          itemSlabRows(ctx, statements, line, index);
        });
        // Rows taken out of the invoice stay as deleted rows (il_pos D), as the desktop does.
        const kept = new Set(lines.map((line) => toInt(line.cells._il_key)));
        for (const key of oldIl.keys()) if (!kept.has(key)) statements.push({ kind: "sql", label: `old row ${key} removed`, sql: `UPDATE |sys.db|prod_ledger SET il_pos = 'D', il_serial = 0 WHERE il_key = ${key}` });
        continue;
      }
      continue;
    }

    for (const group of groups(set)) {
      const head = group[0];
      if (!savedForBook(head, ruleBook(book.values))) continue;
      if (logfileOff && text(head, "table_name").toUpperCase().includes("LOG_")) continue;
      if (text(head, "table_name").toUpperCase() === "ADDON_AENTRY") {
        if (ctx.addonRows.length === 0) continue;
        runGroup(ctx, statements, group, {}, undefined, "addon", ctx.aonaKey > 0 ? { column: "aona_key", value: ctx.aonaKey } : undefined);
        continue;
      }
      const post = group.find((rule) => text(rule, "codepost_para") !== "");
      if (post) {
        // Only the adding half of an edit's pair of postings: the old figures are taken off by reversal().
        if (text(post, "codepost_para").split(",")[5] !== "+") continue;
        const when = text(post, "upd_when_fld_name");
        if (when !== "") {
          const left = when.includes("sys.") ? sysRequired(ctx, when) : when;
          if (!formula(text(post, "upd_when_fld_oper"), left, text(post, "upd_when_fld_chkval"))) continue;
        }
        const para = text(post, "codepost_para");
        if (para.includes("{") || para.split(",")[5] !== "+") continue;
        if (para.includes("|sys.ac_code|,|sys.ac_dbcode|")) {
          pushPostAccount(ctx, statements, input.party.code, ctx.acDbcode, finalAmount, partyBook, String(book.values.bookCode), "party");
        } else if (para.startsWith("|sys.book_code|,|sys.bk_dbcode|")) {
          pushPostAccount(ctx, statements, book.values.bookCode, ctx.bkDbcode, round(bookAmount, 2), 1, String(book.values.bookCode), "book");
        } else if (para.startsWith("|sys.exp_code|,|sys.bk_dbcode|")) {
          // An expense / agency book posts to the expense account chosen in Exp. Name instead of the book's own account.
          if (ctx.expCode > 0) pushPostAccount(ctx, statements, ctx.expCode, ctx.bkDbcode, round(bookAmount, 2), 1, String(book.values.bookCode), "expense");
        }
        continue;
      }
      runGroup(ctx, statements, group, {}, undefined, text(head, "table_name"));
    }
  }
  // The TDS auto journal (Save_Entry's block after the save): a new expense / agency / purchase entry of a party that deducts TDS, with a TDS amount in the foot box.
  if (mode === "A" && !stock && tdsBook(book.values.bookKey, book.values.bookActual)) {
    const found = await tdsInfo(loader, entryName, firstCombo, input.party.code, true);
    if (found.error) throw new Error(found.error);
    const amount = toNumber(input.values.tbx_credit_days ?? "");
    if (found.info && amount > 0) {
      let allowed = true;
      if (book.values.bookKey === BOOK.PURCH) {
        // A purchase party is liable only once its year's purchases (this entry included) pass the limit.
        const mine = slab.find((row) => row.key === found.info!.purchaseSlab);
        const total = found.info.purchaseYear + (mine ? mine.runTotal - mine.amount : 0);
        if (total <= TDS_PURCHASE_LIMIT) { allowed = false; warnings.push("Party's Purchase Amount Not Over than 50,00,000.00 So TDS Entry Not Allowed..."); }
      }
      if (allowed) {
        statements.push(...(await tdsJournal(loader, { bookKey: book.values.bookKey, partyCode: input.party.code, nature: found.info.nature, amount, date: docDate, now, fullDocNo })));
        warnings.push(`TDS journal of ${round(amount, 2)} posted`);
      }
    }
  }
  // logfile S: the special log (the desktop's [<company>_BIGLOG].LOG_ENTRY row, a readable copy of the whole entry).
  if (toText(session.setup.logfile).toUpperCase() === "S") {
    const registerLabel = properCaption(text(await entryProperties(loader, entryName), "first_label_caption"));
    statements.push(specialLogStatement({ ctx, mode, registerLabel, displayCells, party: party?.name ?? "", partyAddon: party?.addon ?? [], columns, slabRows, ledKey }));
  }
  return { statements, presetKeys, summary: { fullDocNo, finalAmount, bookAmount: round(bookAmount, 2), party: input.party.code, ...(renumberedFrom ? { renumberedFrom } : {}) }, warnings };
}

const properCaption = (value: string) => value.trim().toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_all, lead: string, letter: string) => lead + letter.toUpperCase());
/** DateTime.ToString("hh:mm:ss tt"). */
const clock12 = (now: Date) => `${String(now.getHours() % 12 === 0 ? 12 : now.getHours() % 12).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} ${now.getHours() < 12 ? "AM" : "PM"}`;
const money = (value: number) => (value === 0 ? "" : value.toFixed(2));

/**
 * The special log row (logfile S): the entry as the operator saw it, in captions, as JSON text. The desktop builds the text by
 * hand and never escapes it; here every value is JSON-escaped. "!*" marks the first row's key, "!" the others'.
 */
function specialLogStatement(input: { ctx: Ctx; mode: "A" | "E"; registerLabel: string; displayCells: Record<string, string>[]; party: string; partyAddon: readonly { key: number; label: string; value: string }[]; columns: BookScreen["product"]["columns"]; slabRows: SlabRow[]; ledKey: number }): Statement {
  const { ctx, mode, displayCells } = input;
  const { loader, screen } = ctx;
  const label = (name: string, fallback: string) => screen.controls.find((control) => control.name === name)?.label || fallback;
  const has = (name: string) => screen.controls.some((control) => control.name === name);
  const typed = (name: string) => (ctx.input.values[name] ?? "").toString();
  const pair = (key: string, value: string) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  const head: string[] = [
    pair(ctx.stock ? "!*Process_key" : "!*Led_key", ctx.stock ? "@pkval_3" : "@pkval_1"),
    pair(input.registerLabel || "Register", ctx.values.firstCombo.text),
    pair("user", loader.session.loginName),
    pair("savedate", formatDesktopDate(ctx.now)),
    pair("savetime", timeText(ctx.now)),
    pair("machine_name", "WEB"),
    pair(label("cmb_series", "Series"), ctx.series),
    pair(label("dtp_date", "Date"), formatDesktopDate(ctx.docDate)),
    pair(label("tbx_number", "Number"), ctx.number),
  ];
  if (has("tbx_chlnno")) { head.push(pair(label("dtp_chlndate", "Chln. Dt."), formatDesktopDate(ctx.chlnDate))); head.push(pair(label("tbx_chlnno", "Chln. No."), typed("tbx_chlnno"))); }
  if (has("tbx_partyname")) head.push(pair(label("tbx_partyname", "Party Name"), input.party));
  head.push(pair(label("tbx_narration", "Narration"), typed("tbx_narration")));
  if (has("tbx_credit_days")) head.push(pair(label("tbx_credit_days", "Credit Days"), typed("tbx_credit_days")));
  head.push(pair("Document Amount", ctx.finalAmount.toFixed(2)));
  const topBottom = `[{${head.join(",")}}]`;

  // Items: the columns the operator types in, the serial and the value, and the item-wise slab columns.
  const slabKeys = new Set(screen.slabRows.filter((row) => row.itemWise).flatMap((row) => [row.short, `${row.short}_amt`]));
  const shown = input.columns.filter((column) => column.visible && (column.editable || ["il_serial", "il_value", "prod_return"].includes(column.key) || slabKeys.has(column.key)));
  const items = ctx.lines.map((_line, index) => {
    const cells = displayCells[index];
    const parts = [pair(`!${index === 0 ? "*" : ""}Il_key`, `@il_${index + 1}`)];
    for (const column of shown) {
      const caption = column.caption === "Sr." ? "Item Sr." : column.caption;
      parts.push(pair(caption, column.key === "il_serial" ? String(index + 1) : (cells[column.key] ?? "")));
    }
    return `{${parts.join(",")}}`;
  });
  const itemsText = items.length > 0 ? `[${items.join(",")}]` : "";

  // Slab: serial, sign, particulars, short / %, amount of every row.
  const slabCaption = (key: string, fallback: string) => screen.grids.slab.find((column) => column.key === key)?.caption || fallback;
  const slabText = ctx.slab.length === 0 ? "" : `[${ctx.slab.map((row, index) => {
    const source = input.slabRows[index];
    return `{${[
      pair(`!${index === 0 ? "*" : ""}Slab_key`, String(row.key)),
      pair("Slab " + slabCaption("slab_order", "Sr."), String(source?.order ?? index + 1)),
      pair(slabCaption("slab_mathoper", "+ / -"), source?.sign ?? ""),
      pair(slabCaption("slab_desc", "Particulars"), row.desc),
      pair(slabCaption("slab_perc", "Short / %"), source?.perc ?? ""),
      pair(slabCaption("slab_amount", "Amount"), money(row.amount)),
    ].join(",")}}`;
  }).join(",")}]`;

  const addonText = input.partyAddon.length === 0 ? "" : `[${input.partyAddon.map((item, index) => `{${[pair(`!${index === 0 ? "*" : ""}Addon_Label`, item.label), pair(item.label, (ctx.input.addon[item.key] ?? "").toString())].join(",")}}`).join(",")}]`;
  const einvoiceText = toText(loader.session.setup.einvoice_req).toUpperCase() === "Y"
    ? `[{${[["cmb_supplytype", "Supply Type"], ["cmb_subsupplytype", "Sub Supply Type"], ["cmb_documenttype", "Document Type"], ["cmb_transportmode", "Transport Mode"], ["cmb_vehicletype", "Vehicle Type"], ["tbx_distancekm", "Distance KM"], ["tbx_ewaybillno", "E-Way Bill No."], ["dtp_ewaydate", "E-Way Date"], ["tbx_ewayvalid", "Valid Upto"]].map(([name, fallback]) => pair(label(name, fallback), typed(name))).join(",")}}]`
    : "";
  const fields = `{${[
    pair("book", String(ctx.values.bookKey)), pair("book_code", String(ctx.values.bookCode)), pair("ag_bkcode", String(ctx.values.agCode)), pair("ag_book", String(ctx.values.agBook)),
    pair("stkm_short", ctx.values.stkmShort), pair("full_docno", ctx.fullDocNo), pair("ac_dbcode", String(ctx.acDbcode)),
    pair("productkey", ctx.lines.map((line) => line.product.key).join(",")), pair("slabkey", ctx.slab.map((row) => row.key).join(",")),
    pair("outstandkey", ""), pair("type", String(ctx.values.type)), pair("year_id", loader.session.yearId),
  ].join(",")}}`;
  return {
    kind: "insert", table: "log_entry", schema: `${loader.session.companySchema}_biglog`, keyColumn: "lentry_key", label: "special log (log_entry)",
    columns: ["lentry_top_bottom", "lentry_items", "lentry_slab", "lentry_outstand", "lentry_addon", "lentry_einvoice", "lentry_fields", "lentry_mode", "lentry_user", "lentry_ledid", "lentry_processid", "lentry_code", "lentry_book", "lentry_bookcode", "lentry_savedate", "lentry_savetime", "lentry_machine_name"],
    values: [quote(topBottom), quote(itemsText), quote(slabText), "''", quote(addonText), quote(einvoiceText), quote(fields), quote(mode), String(loader.session.userNo), ctx.stock ? "null" : "@pkval_1", ctx.stock ? "@pkval_3" : "null", String(ctx.input.party.code), String(ctx.values.bookKey), String(ctx.values.bookCode), dateLiteral(ctx.now), quote(clock12(ctx.now)), quote("WEB")],
  };
}

/** One rule group as one INSERT or UPDATE. */
function runGroup(ctx: Ctx, statements: Statement[], group: Rule[], cells: Record<string, string>, il: Record<string, number | string> | undefined, label: string, target?: { column: string; value: number }) {
  const head = group[0];
  const table = text(head, "table_name").toLowerCase();
  // Edit: a rule list of type A adds, or changes the row named by target; U changes the row its where names.
  const ruleKind = text(head, ctx.mode === "A" ? "query_add_type" : "query_update_type").toUpperCase();
  if (ruleKind === "S") return;
  const targeted = target !== undefined && ((table === "prod_ledger" && target.column === "il_key") || (table === "addon_aentry" && target.column === "aona_key"));
  const kind = ctx.mode === "A" ? ruleKind : targeted ? "U" : ruleKind === "A" ? "I" : ruleKind;
  const grid = text(head, "grid_name") !== "" && field(head, "multiple_save") === true;
  const columns: string[] = [];
  const values: string[] = [];
  let where = "";
  for (const rule of group) {
    if (!savedForBook(rule, ruleBook(ctx.values))) continue;
    const name = text(rule, "save_field_name") || text(rule, "column_name");
    if (name === "") continue;
    // The optional product columns are saved only when the screen has them.
    if (grid && ["bundle", "pack_qty", "loose_qty", "il_leveldesc"].includes(name.toLowerCase()) && !Object.prototype.hasOwnProperty.call(cells, name.toLowerCase())) continue;
    const when = text(rule, "upd_when_fld_name");
    if (when !== "") {
      const left = fixedText(ctx, when, (n) => cells[n] ?? "", il);
      const right = fixedText(ctx, text(rule, "upd_when_fld_chkval"), (n) => cells[n] ?? "", il);
      if (!formula(text(rule, "upd_when_fld_oper"), left, right)) continue;
    }
    const value = grid ? gridValue(ctx, rule, cells, il) : ruleValue(ctx, rule);
    columns.push(name);
    values.push(value);
  }
  if (kind === "U") {
    // The desktop takes the where of the first rule that passes its own condition; a rule list whose first row fails would
    // update every row, so the where is taken from any rule of the group.
    const withWhere = group.find((rule) => text(rule, "query_where") !== "");
    if (targeted && target) where = `${target.column} = ${target.value}`;
    else if (withWhere) where = replaceEntryTokens(fixedText(ctx, text(withWhere, "query_where"), (n) => cells[n] ?? "", il), ctx.values);
    if (where === "") return;
  }
  if (table === "addon_aentry") {
    for (const row of ctx.addonRows) {
      if (row.type === "M") { columns.push(`key_${row.save}`, `txt_${row.save}`); values.push(String(row.key), quote(row.value)); }
      else if (row.type === "I") { columns.push(`input_${row.save}`); values.push(quote(row.value)); }
    }
  }
  if (columns.length === 0) return;
  if (kind === "U") {
    const set = columns.map((column, index) => `${columnName(column)} = ${values[index]}`).join(", ");
    statements.push({ kind: "sql", label: `${label}: update ${table}`, sql: `UPDATE |sys.db|${table} SET ${set}${where ? ` WHERE ${where}` : ""}` });
    return;
  }
  const capture = table === "ledger" ? "pkval_1" : table === "prod_ledger" ? "pkval_2" : table === "process" ? "pkval_3" : undefined;
  statements.push({ kind: "insert", table, keyColumn: KEY_COLUMN[table], columns, values, capture, label: `${label}: ${table}` });
}

/** The item-wise slab rows (ledger_ext with il_id) of a product row: tax and discount cells with their running figure. */
function itemSlabRows(ctx: Ctx, statements: Statement[], line: Ctx["lines"][number], index: number) {
  let net = toNumber(line.cells.il_value);
  ctx.slab.forEach((row, at) => {
    if (!row.itemWise || at === 0) return;
    const amount = toNumber(line.cells[`${ctx.screen.slabRows[at].short}_amt`]);
    if (!row.master && amount === 0) return;
    net = row.mathOp === "L" ? net - amount : net + amount;
    const short = ctx.screen.slabRows[at].short;
    const raw = line.cells[short] ?? "";
    const column = ctx.screen.product.columns.find((candidate) => candidate.key === short);
    const option = row.master ? column?.options?.find((candidate) => candidate.text === raw) : undefined;
    const perc = row.master ? (option ? ctx.screen.taxPercs[option.value] ?? 0 : 0) : toNumber(raw);
    statements.push({
      kind: "insert", table: "ledger_ext", keyColumn: KEY_COLUMN.ledger_ext, label: `row ${index + 1}: item slab ${row.desc}`,
      columns: ["led_id", "process_id", "il_id", "slab_id", "slab_amt", "tax_id", "s_lastot", "form_recd", "slab_perc", "year_id"],
      values: ["@pkval_1", "null", "@pkval_2", String(row.key), String(amount), row.master && option ? String(toInt(option.value)) : "null", String(round(net, 2)), "'N'", String(perc), quote(ctx.loader.session.yearId)],
    });
  });
}

export type SaveReport = Readonly<{ committed: boolean; keys: Record<string, number>; rows: { table: string; label: string; row: Record<string, unknown> }[]; updates: { label: string; rowCount: number }[]; summary: SavePlan["summary"]; warnings: string[] }>;

/**
 * Runs a plan on a client already inside a transaction. A dry run numbers each new row from MAX(key) + 1 with
 * OVERRIDING SYSTEM VALUE so the live sequences are not moved; a real run lets the sequence number the rows.
 */
export async function runPlan(client: Client, loader: Loader, plan: SavePlan, options: { commit: boolean }): Promise<SaveReport> {
  const keys: Record<string, number> = { ...plan.presetKeys };
  const rows: SaveReport["rows"] = [];
  const updates: SaveReport["updates"] = [];
  const bind = (sql: string) => sql.replace(/@(pkval_\d|il_\d+|jv_\d)/g, (_all, name) => String(keys[name] ?? "null"));
  const schema = loader.session.companySchema;
  const inSchema = (sql: string) => sql.replace(/\|sys\.db\|/gi, `${schema}.`);
  if (options.commit) {
    // The migrated tables' identity sequences can be behind the rows already there (log_regtrn's was at 2 with 35,884 rows):
    // one save at a time, and a sequence found behind its table is moved up to the table's largest key first.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa-entry-save'))");
    const tables = new Map<string, string>();
    for (const statement of plan.statements) if (statement.kind === "insert" && statement.keyColumn) tables.set(`${statement.schema ?? schema}.${statement.table}`, statement.keyColumn);
    for (const [table, keyColumn] of tables) {
      const sequence = (await client.query("SELECT pg_get_serial_sequence($1, $2) AS sequence", [table, keyColumn])).rows[0]?.sequence as string | null;
      if (!sequence) continue;
      const top = Number((await client.query(`SELECT COALESCE(MAX(${keyColumn}), 0) AS top FROM ${table}`)).rows[0].top);
      const seen = (await client.query(`SELECT last_value, is_called FROM ${sequence}`)).rows[0];
      const next = Number(seen.last_value) + (seen.is_called ? 1 : 0);
      if (next <= top) await client.query("SELECT setval($1, $2, true)", [sequence, top]);
    }
  }
  for (const statement of plan.statements) {
    if (statement.kind === "set") { keys[statement.key] = statement.value; if (statement.ilLine) keys[`il_${statement.ilLine}`] = statement.value; continue; }
    if (statement.kind === "sql") {
      const result = await client.query(inSchema(bind(statement.sql)));
      updates.push({ label: statement.label, rowCount: result.rowCount ?? 0 });
      continue;
    }
    const table = `${statement.schema ?? schema}.${statement.table}`;
    const columns = [...statement.columns];
    const values = statement.values.map((value) => bind(value));
    let override = "";
    if (!options.commit && statement.keyColumn) {
      const next = (await client.query(`SELECT COALESCE(MAX(${statement.keyColumn}), 0) + 1 AS next FROM ${table}`)).rows[0].next as number;
      columns.unshift(statement.keyColumn);
      values.unshift(String(next));
      override = " OVERRIDING SYSTEM VALUE";
    }
    const returning = statement.keyColumn ? `RETURNING ${statement.keyColumn} AS key` : "";
    const result = await client.query(`INSERT INTO ${table} (${columns.map(columnName).join(", ")})${override} VALUES (${values.join(", ")}) ${returning}`);
    const key = statement.keyColumn ? Number(result.rows[0]?.key) : 0;
    if (statement.capture) keys[statement.capture] = key;
    if (statement.ilLine) keys[`il_${statement.ilLine}`] = key;
    const read = statement.keyColumn ? (await client.query(`SELECT * FROM ${table} WHERE ${statement.keyColumn} = $1`, [key])).rows[0] : {};
    rows.push({ table: statement.table, label: statement.label, row: read });
  }
  return { committed: options.commit, keys, rows, updates, summary: plan.summary, warnings: plan.warnings };
}

export { toDecimal };

/** Takes an invoice's postings off the balances (the minus half of Save_CodePost / Save_ProductPost) and deletes its ledger_post rows. */
async function reversal(loader: Loader, ledKey: number, yearId: string, stock = false): Promise<Statement[]> {
  const out: Statement[] = [];
  const year = quote(yearId);
  // A stock register's entry (process) has no ledger postings: only its stock balances come off.
  const posts = stock ? [] : (await loader.readTable(`SELECT p.post_code, p.post_amt::numeric AS amount, p.post_dbcode, a.book FROM |sys.db|ledger_post p LEFT JOIN |sys.db|account a ON a.code = p.post_code WHERE p.led_id = $1 ORDER BY p.post_key`, [ledKey])) ?? [];
  for (const post of posts) {
    const amount = toDecimal(field(post, "amount"));
    const debit = toInt(field(post, "post_dbcode")) === 1;
    const column = debit ? "debit" : "credit";
    const closing = debit ? -amount : amount;
    const set = `closing = (closing::numeric + (${closing}))::money, ${column} = (${column}::numeric - (${amount}))::money`;
    out.push({ kind: "sql", label: `undo ac_balance ${toInt(field(post, "post_code"))}`, sql: `UPDATE |sys.db|ac_balance SET ${set} WHERE code = ${toInt(field(post, "post_code"))} AND a_recflag = 'AC' AND year_id = ${year}` });
    const book = toInt(field(post, "book"));
    if (book === 2 || book === 3) out.push({ kind: "sql", label: `undo control account ${book - 1}`, sql: `UPDATE |sys.db|ac_balance SET ${set} WHERE code = ${book - 1} AND a_recflag = 'AC' AND year_id = ${year}` });
  }
  if (!stock) out.push({ kind: "sql", label: "old ledger_post rows", sql: `DELETE FROM |sys.db|ledger_post WHERE led_id = ${ledKey}` });
  const rows = (await loader.readTable(`SELECT prod_id, stock_nat, trn_qty1, trn_qty2, trn_qty3, trn_pcs, trn_pack, trn_weight FROM |sys.db|prod_ledger WHERE ${stock ? "process_id" : "led_id"} = $1 AND il_pos = 'A' AND inventory = 'Y'`, [ledKey])) ?? [];
  for (const row of rows) {
    const add = text(row, "stock_nat") === "A";
    const move = add ? "add" : "less";
    const sign = add ? "+" : "-";
    const set = ["qty1", "qty2", "qty3", "pcs", "pack", "weight"].map((unit) => {
      const value = toDecimal(field(row, `trn_${unit}`));
      return [`${move}_${unit} = ${move}_${unit} - (${value})`, `clsg_${unit} = clsg_${unit} ${add ? "-" : "+"} (${value})`];
    }).flat();
    void sign;
    out.push({ kind: "sql", label: `undo prod_balance ${toInt(field(row, "prod_id"))}`, sql: `UPDATE |sys.db|prod_balance SET ${set.join(", ")} WHERE prec_flag = 'RP' AND year_id = ${year} AND prod_id = ${toInt(field(row, "prod_id"))}` });
  }
  return out;
}

export type DeleteSummary = SavePlan["summary"];

/**
 * Delete of a saved invoice (EntryNat "D"): the postings come off, the slab, addon and outstanding rows go, the ledger row and the product
 * rows stay as deleted rows (doc_pos / il_pos D), and the log rows record it. A bill that receipts are set off against is refused.
 */
export async function buildDelete(loader: Loader, entryName: string, firstCombo: EntryOption, uniqueKey: number, now = new Date()): Promise<SavePlan> {
  const { session } = loader;
  const book = await bookContext(loader, entryName, firstCombo);
  if (!book.values.bookActual) return buildStockDelete(loader, text(book.row, "stkm_short"), uniqueKey, now);
  const led = (await loader.readTable(`SELECT *, amount::numeric AS amount_n FROM |sys.db|ledger WHERE unique_key = $1 AND doc_pos = 'A' AND book = $2`, [uniqueKey, book.values.bookKey]))?.[0];
  if (!led) throw new Error("The invoice to delete was not found: it may be deleted already");
  if (text(led, "doc_lock").toUpperCase() === "Y") throw new Error("Current Entry Lock...  Changes Save not Allowed....");
  const ledKey = toInt(field(led, "led_key"));
  const out = (await loader.readTable(`SELECT out_key, out_setoff::numeric AS setoff, out_ly_setoff::numeric AS ly FROM |sys.db|outclear WHERE out_ledid = $1 AND COALESCE(out_ag_outid, 0) = 0`, [ledKey])) ?? [];
  const settled = out.reduce((sum, row) => sum + toDecimal(field(row, "setoff")) + toDecimal(field(row, "ly")), 0);
  const linked = out.length > 0 ? await loader.readTable(`SELECT out_key FROM |sys.db|outclear WHERE out_ag_outid = ANY($1)`, [out.map((row) => toInt(field(row, "out_key")))]) : null;
  if (settled > 0 || linked) throw new Error("Delete not allowed: receipts or notes are set off against this bill. Remove those set-offs first.");
  const yearId = session.yearId;
  const year = quote(yearId);
  const full = text(led, "full_docno");
  const statements: Statement[] = [...(await reversal(loader, ledKey, yearId))];
  const rows = (await loader.readTable(`SELECT * FROM |sys.db|prod_ledger WHERE led_id = $1 AND il_pos = 'A' ORDER BY il_key`, [ledKey])) ?? [];
  statements.push({ kind: "sql", label: "slab rows", sql: `DELETE FROM |sys.db|ledger_ext WHERE led_id = ${ledKey}` });
  statements.push({ kind: "sql", label: "addon row", sql: `DELETE FROM |sys.db|addon_aentry WHERE aona_ledid = ${ledKey}` });
  // What this entry set off against bills comes off them before its outstanding rows go.
  for (const row of (await loader.readTable(`SELECT out_ag_outid, out_setoff::numeric AS setoff FROM |sys.db|outclear WHERE out_ledid = $1 AND COALESCE(out_ag_outid, 0) > 0`, [ledKey])) ?? []) {
    const bill = toInt(field(row, "out_ag_outid"));
    const amount = toDecimal(field(row, "setoff"));
    statements.push({ kind: "sql", label: `set-off of bill ${bill} taken back`, sql: `UPDATE |sys.db|outclear SET out_setoff = out_setoff::numeric - ${amount}, clear_pos = (case when out_setoff::numeric - ${amount} + out_ly_setoff::numeric = 0 then 'P' else 'C' end) WHERE out_key = ${bill}` });
  }
  statements.push({ kind: "sql", label: "outstanding row", sql: `DELETE FROM |sys.db|outclear WHERE out_ledid = ${ledKey}` });
  const today = dateLiteral(now);
  const time = quote(timeText(now));
  for (const row of rows) {
    const key = toInt(field(row, "il_key"));
    statements.push({ kind: "sql", label: `row ${key} deleted`, sql: `UPDATE |sys.db|prod_ledger SET il_pos = 'D' WHERE il_key = ${key}` });
    if (toText(session.setup.logfile).toUpperCase() !== "N") {
      statements.push({
        kind: "insert", table: "log_regtrn", keyColumn: KEY_COLUMN.log_regtrn, label: `row ${key}: log_regtrn`,
        columns: ["lreg_logdate", "lreg_logmode", "lreg_loguser", "lreg_id", "lreg_docno1", "lreg_prodid", "lreg_quantity", "lreg_factor", "lreg_rate", "lreg_value", "lreg_rateuom", "lreg_date", "lreg_stocknat", "lreg_code", "lreg_logtime", "lreg_pos", "year_id", "lreg_machine_name"],
        values: [today, "'D'", String(session.userNo), String(key), quote(text(row, "doc_no1")), String(toInt(field(row, "prod_id"))), String(toDecimal(field(row, "quantity"))), String(toDecimal(field(row, "factor"))), String(toDecimal(field(row, "rate"))), String(toDecimal((await loader.readTable(`SELECT il_value::numeric AS v FROM |sys.db|prod_ledger WHERE il_key = $1`, [key]))?.[0]?.v)), String(toInt(field(row, "rateuom_id"))), dateLiteral(parseDesktopDate(field(row, "il_date")) ?? now), quote(text(row, "stock_nat")), String(toInt(field(row, "code"))), time, "'D'", year, quote("WEB")],
      });
    }
  }
  statements.push({ kind: "sql", label: "ledger deleted", sql: `UPDATE |sys.db|ledger SET doc_pos = 'D' WHERE led_key = ${ledKey}` });
  if (toText(session.setup.logfile).toUpperCase() !== "N") {
    statements.push({
      kind: "insert", table: "log_ledger", keyColumn: KEY_COLUMN.log_ledger, label: "log_ledger",
      columns: ["lled_logdate", "lled_logmode", "lled_loguser", "lled_id", "lled_code", "lled_docdate", "lled_fulldocno", "lled_docno1", "lled_amount", "lled_narration", "lled_logtime", "lled_docpos", "year_id", "lled_machine_name"],
      values: [today, "'D'", String(session.userNo), String(ledKey), String(toInt(field(led, "code"))), dateLiteral(parseDesktopDate(field(led, "doc_date")) ?? now), quote(full), quote(text(led, "doc_no1")), String(toDecimal(field(led, "amount_n"))), quote(text(led, "narration")), time, "'D'", year, quote("WEB")],
    });
  }
  // logfile S: the special log keeps a readable copy of what was deleted.
  if (toText(session.setup.logfile).toUpperCase() === "S") {
    const pair = (key: string, value: string) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    const slabRows = (await loader.readTable(`SELECT e.slab_id, e.slab_amt::numeric AS amount, s.slab_desc, s.slab_mathop FROM |sys.db|ledger_ext e LEFT JOIN |sys.db|slab_master s ON s.slab_key = e.slab_id WHERE e.led_id = $1 AND e.il_id IS NULL ORDER BY e.ledext_key`, [ledKey])) ?? [];
    const docDate = parseDesktopDate(field(led, "doc_date")) ?? now;
    const party = (await loader.readTable(`SELECT name FROM |sys.db|account WHERE code = $1`, [toInt(field(led, "code"))]))?.[0];
    const series = text(led, "doc_series");
    const number = text(led, "doc_no");
    const top = `[{${[
      pair("!*Led_key", String(ledKey)), pair("Register", firstCombo.text), pair("user", session.loginName), pair("savedate", formatDesktopDate(now)), pair("savetime", timeText(now)), pair("machine_name", "WEB"),
      pair("Series", series), pair("Date", formatDesktopDate(docDate)), pair("Number", number), pair("Party Name", text(party, "name")), pair("Narration", text(led, "narration")), pair("Document Amount", toDecimal(field(led, "amount_n")).toFixed(2)),
    ].join(",")}}]`;
    const items = rows.length === 0 ? "" : `[${rows.map((row, index) => `{${[pair(`!${index === 0 ? "*" : ""}Il_key`, String(toInt(field(row, "il_key")))), pair("Item Sr.", `${toInt(field(row, "il_serial"))} *Deleted`), pair("Qty.", String(toDecimal(field(row, "quantity")))), pair("Rate", String(toDecimal(field(row, "rate"))))].join(",")}}`).join(",")}]`;
    const slabs = slabRows.length === 0 ? "" : `[${slabRows.map((row, index) => `{${[pair(`!${index === 0 ? "*" : ""}Slab_key`, String(toInt(field(row, "slab_id")))), pair("Particulars", text(row, "slab_desc")), pair("Amount", toDecimal(field(row, "amount")).toFixed(2))].join(",")}}`).join(",")}]`;
    const fields = `{${[pair("book", String(book.values.bookKey)), pair("book_code", String(book.values.bookCode)), pair("full_docno", full), pair("ac_dbcode", String(toInt(field(led, "ac_dbcode")))), pair("productkey", rows.map((row) => toInt(field(row, "prod_id"))).join(",")), pair("slabkey", slabRows.map((row) => toInt(field(row, "slab_id"))).join(",")), pair("outstandkey", ""), pair("type", String(book.values.type)), pair("year_id", yearId)].join(",")}}`;
    statements.push({
      kind: "insert", table: "log_entry", schema: `${session.companySchema}_biglog`, keyColumn: "lentry_key", label: "special log (log_entry)",
      columns: ["lentry_top_bottom", "lentry_items", "lentry_slab", "lentry_outstand", "lentry_addon", "lentry_einvoice", "lentry_fields", "lentry_mode", "lentry_user", "lentry_ledid", "lentry_processid", "lentry_code", "lentry_book", "lentry_bookcode", "lentry_savedate", "lentry_savetime", "lentry_machine_name"],
      values: [quote(top), quote(items), quote(slabs), "''", "''", "''", quote(fields), "'D'", String(session.userNo), String(ledKey), "null", String(toInt(field(led, "code"))), String(book.values.bookKey), String(book.values.bookCode), today, quote(clock12(now)), quote("WEB")],
    });
  }
  return { statements, presetKeys: { pkval_1: ledKey }, summary: { fullDocNo: full, finalAmount: toDecimal(field(led, "amount_n")), bookAmount: 0, party: toInt(field(led, "code")) }, warnings: [] };
}

/**
 * Delete of a stock register's entry (Job Stock In / Out ...: a process row with its product rows, no ledger): the stock balances come off,
 * the slab and addon rows go, the process row and the product rows stay as deleted rows (il_pos D), and each product row is logged.
 */
async function buildStockDelete(loader: Loader, stockModule: string, processKey: number, now: Date): Promise<SavePlan> {
  const { session } = loader;
  const process = (await loader.readTable(`SELECT * FROM |sys.db|process WHERE process_key = $1 AND il_pos = 'A'`, [processKey]))?.[0];
  if (!process) throw new Error("The entry to delete was not found: it may be deleted already");
  if (text(process, "stk_module") !== stockModule) throw new Error("The entry belongs to another register");
  const yearId = session.yearId;
  const year = quote(yearId);
  const statements: Statement[] = [...(await reversal(loader, processKey, yearId, true))];
  const rows = (await loader.readTable(`SELECT * FROM |sys.db|prod_ledger WHERE process_id = $1 AND il_pos = 'A' ORDER BY il_key`, [processKey])) ?? [];
  statements.push({ kind: "sql", label: "slab rows", sql: `DELETE FROM |sys.db|ledger_ext WHERE process_id = ${processKey}` });
  statements.push({ kind: "sql", label: "addon row", sql: `DELETE FROM |sys.db|addon_aentry WHERE aona_processid = ${processKey}` });
  const today = dateLiteral(now);
  const time = quote(timeText(now));
  for (const row of rows) {
    const key = toInt(field(row, "il_key"));
    statements.push({ kind: "sql", label: `row ${key} deleted`, sql: `UPDATE |sys.db|prod_ledger SET il_pos = 'D' WHERE il_key = ${key}` });
    if (toText(session.setup.logfile).toUpperCase() !== "N") {
      statements.push({
        kind: "insert", table: "log_regtrn", keyColumn: KEY_COLUMN.log_regtrn, label: `row ${key}: log_regtrn`,
        columns: ["lreg_logdate", "lreg_logmode", "lreg_loguser", "lreg_id", "lreg_docno1", "lreg_prodid", "lreg_quantity", "lreg_factor", "lreg_rate", "lreg_value", "lreg_rateuom", "lreg_date", "lreg_stocknat", "lreg_code", "lreg_logtime", "lreg_pos", "year_id", "lreg_machine_name"],
        values: [today, "'D'", String(session.userNo), String(key), quote(text(row, "doc_no1")), String(toInt(field(row, "prod_id"))), String(toDecimal(field(row, "quantity"))), String(toDecimal(field(row, "factor"))), String(toDecimal(field(row, "rate"))), String(toDecimal((await loader.readTable(`SELECT il_value::numeric AS v FROM |sys.db|prod_ledger WHERE il_key = $1`, [key]))?.[0]?.v)), String(toInt(field(row, "rateuom_id"))), dateLiteral(parseDesktopDate(field(row, "il_date")) ?? now), quote(text(row, "stock_nat")), String(toInt(field(row, "code"))), time, "'D'", year, quote("WEB")],
      });
    }
  }
  statements.push({ kind: "sql", label: "process deleted", sql: `UPDATE |sys.db|process SET il_pos = 'D' WHERE process_key = ${processKey}` });
  return { statements, presetKeys: { pkval_3: processKey }, summary: { fullDocNo: text(process, "full_docno"), finalAmount: toDecimal(field(process, "p_amount")), bookAmount: 0, party: toInt(field(process, "code")) }, warnings: ["The special log (logfile S) is not written for a stock register's entry."] };
}
