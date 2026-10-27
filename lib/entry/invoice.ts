import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toInt, toText } from "../master-program/legacy";
import { GST_START_DATE, readRights, SETUP_SCHEMA } from "../master-program/session";
import { blankCoalesceAsText, replaceSessionValues } from "../master-program/sql";
import { publicSetup, toSetup } from "../master-rules";
import { properHeading } from "../master-program/heading";
import { addonColumns, columnFor, controlOptions, queryOptions } from "../small-entry/load";
import type { GridPlan } from "../small-entry/load";
import { orderByAliases } from "../small-entry/text";
import { moneyColumnNames } from "../report/generate";
import { BOOK, entryDialect, replaceEntryTokens, tdsAutoJournal, tdsBook } from "./values";
import type { EntryValues } from "./values";
import type { AddonItem, BookScreen, ControlPlace, EntryColumn, EntryOption, GridColumn, HelpList, InvoiceControl, InvoiceDefinition, PartyDetails, SeriesDefaults, SlabRow } from "./types";

/**
 * Comman_Entry (Entry.cs), the Invoice screen, as far as setting the screen up: opening the
 * menu, choosing a register (Cmb_FirstCombo_Leave, Fill_Slab_and_Addon, InputCol_Property_Change),
 * the series' default date and number, the party help and the party's address.
 *
 * Product rows (product selection, rates, the slab arithmetic), saving, restoring an entry,
 * printing and the e-invoice / e-way calls are not ported yet: docs/PENDING-WORK.md lists them.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name));
const flag = (row: Row | undefined, name: string) => field(row, name) === true;

/** The setup row of a company flag list (entry_para, item_para ...) holds the token. */
function para(setup: Readonly<Record<string, unknown>>, column: string, token: string): boolean {
  return toText(setup[column]).toUpperCase().includes(token);
}

export async function entryProperties(loader: Loader, entryName: string): Promise<Row> {
  const rows = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_properties WHERE BTRIM(entry_name) = $1`, [entryName]);
  if (!rows) throw new Error(`Entry ${entryName} is not in smart_setup.entry_properties`);
  return rows[0];
}

export async function controlEvents(loader: Loader, entryId: number): Promise<Row[]> {
  return (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.control_event WHERE entry_properties_id = $1 ORDER BY control_query_sr, control_event_key`, [entryId])) ?? [];
}

async function gridBody(loader: Loader, eventId: number, activeOnly = true): Promise<Row[]> {
  return (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_grid_body WHERE entry_control_id = $1 ${activeOnly ? "AND add_active" : ""} ORDER BY field_add_order, entry_grid_body_key`, [eventId])) ?? [];
}

/** A side grid's visible columns (slab, addon, outstanding), with captions as Setting_GridCol gives them. */
async function gridColumns(loader: Loader, eventId: number): Promise<GridColumn[]> {
  if (eventId <= 0) return [];
  return (await gridBody(loader, eventId)).filter((row) => flag(row, "update_grid_visible")).map((row) => {
    const align = text(row, "update_grid_align").toUpperCase();
    const type = text(row, "field_type").toUpperCase();
    return {
      key: (text(row, "field_name") || text(row, "field_restore")).replace(/^.*\./, ""),
      caption: text(row, "head_grid"),
      width: toInt(field(row, "update_grid_width")) || 80,
      align: align === "R" || align === "C" ? align : type === "N" || type === "C" ? "R" : "L",
      decimals: toInt(field(row, "decimal_points")),
      editable: flag(row, "update_grid_editable"),
    };
  });
}

/** The fill event of a named grid (c1dg_Addon, c1dg_OutClear), from any control's events. */
function eventFilling(events: readonly Row[], gridName: string): Row | undefined {
  return events.find((event) => text(event, "fill_control_name").toLowerCase() === gridName && toInt(field(event, "fill_grid_event_id")) > 0 && !text(event, "control_name").toLowerCase().startsWith("x"));
}

// ---------------------------------------------------------------------------------------
// Comman_Entry_Load

export async function loadInvoice(loader: Loader, entryName: string, menuShortName: string): Promise<InvoiceDefinition> {
  const { session } = loader;
  const properties = await entryProperties(loader, entryName);
  const entryId = toInt(field(properties, "entry_key"));
  const style = entryName.trim().toUpperCase().startsWith("V") ? "V" : "I";
  const unsupported: string[] = [];

  // Read_Entry_FirstComboBox: first_combo_query + where + order by (licences 5, 7, 16, 18 order by name).
  let sql = text(properties, "first_combo_query");
  const where = text(properties, "first_combo_where");
  if (where !== "") sql += ` where ${where}`;
  const orderBy = [5, 7, 16, 18].includes(session.licence) ? "Name" : text(properties, "first_combo_orderby");
  if (orderBy !== "") sql += ` order by ${orderByAliases(sql, orderBy)}`;
  const options = await queryOptions(loader, replaceSessionValues(sql, session));

  const setup = session.setup;
  const rights = await readRights(loader.client, session, `Menu-${menuShortName}`);
  const einvoice = toText(setup.einvoice_req).toUpperCase() === "Y";
  const limits = (await loader.readTable(`SELECT within_state_amt, out_state_amt FROM ${SETUP_SCHEMA}.setup LIMIT 1`))?.[0];
  return {
    entryId,
    entryName,
    caption: text(properties, "entry_caption"),
    statusHead: text(properties, "entry_status_head"),
    style,
    firstCombo: { label: properTitle(text(properties, "first_label_caption")), options },
    rights: { restricted: rights.restricted, add: rights.add, edit: rights.edit, delete: rights.delete, modulePassword: rights.modulePassword !== "" },
    buttons: {
      upload: toText(setup.doc_upload).toUpperCase().includes("Y"),
      einvoice: style !== "V" && (einvoice || toText(setup.einvoice_json_req).toUpperCase().includes("Y")),
      log: toText(setup.logfile).toUpperCase() === "S",
    },
    tabs: { outstanding: session.licence !== 17, eway: style === "I" && session.coGstReq && session.licence !== 17 },
    ewayDates: !einvoice,
    ewayLimits: { within: toDecimal(field(limits, "within_state_amt")), out: toDecimal(field(limits, "out_state_amt")) },
    licence: session.licence,
    unsupported,
  };
}

/** The desktop's label text is upper case in the setup (REGISTER); the form shows "Register". */
function properTitle(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

// ---------------------------------------------------------------------------------------
// Cmb_FirstCombo_Leave: what the register is

export type BookContext = Readonly<{
  values: EntryValues;
  /** dtbl_FirstCombo: the account row with its book_properties. */
  row: Row;
  stkmId: string;
  stkmToShort: string;
  stockNat: string;
  stockNatBoth: boolean;
  returnFor: string;
  inventory: boolean;
  party: boolean;
  slab: boolean;
  entryFor: string;
  linkFromParty: boolean;
  warnings: string[];
}>;

export async function bookContext(loader: Loader, entryName: string, firstCombo: EntryOption, extra: Partial<EntryValues> = {}): Promise<BookContext> {
  const { session } = loader;
  const properties = await entryProperties(loader, entryName);
  const blank: EntryValues = {
    session, firstCombo, bookKey: 0, type: 0, bookCode: 0, bkDbcode: 0, acDbcode: 0, agBook: 0, agCode: 0, bookActual: true, forBook: 0,
    stkmShort: "", stkmFromShort: "", acHelp: "", series: "", docNo: "", docDate: "", acCode: 0, entryNat: "A",
    moneyColumns: await moneyColumnNames(loader),
  };
  const row = (await loader.readTable(replaceEntryTokens(text(properties, "fc_lostfocus_qry"), blank)))?.[0];
  if (!row) throw new Error(`The register ${firstCombo.text} is not in the account master`);
  const warnings: string[] = [];
  const bookBy = async (column: string, value: string) => (await loader.readTable(`SELECT * FROM |sys.db|book_properties WHERE BTRIM(${column}) = $1 AND BTRIM(stkm_pos) = 'A' LIMIT 1`, [value.trim()]))?.[0];

  const bookActual = text(row, "book_actual") === "Y";
  let bookKey: number;
  let type = 0;
  let slab = true;
  let linkFromParty = true;
  if (bookActual) {
    bookKey = toInt(field(row, "stkm_tobook")) > 0 ? toInt(field(row, "stkm_tobook")) : toInt(field(row, "book_key"));
  } else {
    bookKey = toInt(field(row, "stkm_forbook")) || toInt(field(row, "book_key"));
    if (toInt(field(row, "stkm_frombook")) === 0) {
      const from = await bookBy("stkm_short", text(row, "stkm_fromshort"));
      if (from) linkFromParty = text(from, "stkm_pcode").toUpperCase() === "Y";
    }
    type = toInt(field(row, "book_key"));
    slab = text(row, "stkm_slab").toUpperCase() === "Y";
    if (text(row, "book_against") !== "") bookKey = toInt(field(row, "stkm_tobook")) > 0 ? bookKey : type;
  }
  const acDbcode = toInt(field(row, "ac_dbcode"));
  let bkDbcode = acDbcode === 1 ? 2 : acDbcode === 2 ? 1 : 0;
  let stockNat = text(row, "stkm_ioper");
  const stockNatBoth = stockNat === "B" && !bookActual;
  if (stockNat === "B") stockNat = "A";
  const returnFor = text(row, "book_desc").includes("LINK") ? "" : text(row, "book_against");
  const plain = text(row, "stkm_toshort") === "" && session.licence !== 71;
  const stkmShort = plain ? (bookActual ? "" : text(row, "stkm_short")) : text(row, "stkm_short");
  const stkmFromShort = plain ? (bookActual ? text(row, "stkm_fromshort") : "") : text(row, "stkm_fromshort");
  const stkmToShort = plain ? (bookActual ? text(row, "stkm_toshort") : "") : text(row, "stkm_toshort");
  const stkmId = plain ? (bookActual ? "" : text(row, "stkm_id")) : text(row, "stkm_id");
  if (!bookActual && stkmId === "GT") bkDbcode = 0;
  const id = text(row, "stkm_id").toUpperCase();
  const acpost = text(row, "stkm_acpost").toUpperCase();
  const stkpost = text(row, "stkm_stkpost").toUpperCase();

  // str_Entry_for, as the invoice style sets it.
  let entryFor = "Bill";
  if (bookActual && returnFor !== "") entryFor = "DrCr";
  else if (!bookActual && type > 0) {
    if (id === "CH" || stkmToShort.toUpperCase().includes("CHLN")) entryFor = text(row, "stkm_short").toUpperCase() === "CHLN-IN" || stkmToShort.toUpperCase() === "CHLN-IN" ? "Chlnin" : "Chln";
    else if (id === "OR" || id === "QO") entryFor = "Order";
    else if (id === "IN") entryFor = text(row, "stkm_short").toUpperCase() === "IND-IN" || stkmToShort.toUpperCase() === "IND-IN" ? "Indentin" : "Indent";
    else if (id === "AM") entryFor = "Amendment";
    else if (id === "QT") entryFor = "Qtn";
    else if (id.startsWith("S") && acpost === "N" && stkpost === "Y") entryFor = "Stkad";
    else if (id.startsWith("GT") && acpost === "N" && stkpost === "Y") entryFor = "Gwtrf";
    else if (id.startsWith("PR") && acpost === "N") entryFor = "Process";
    else if (id.startsWith("PF") && acpost === "N") entryFor = "Proforma";
    else if (id.startsWith("JO")) entryFor = "Jobout";
    else if (id.startsWith("FR")) entryFor = "Formula";
    else if (id.startsWith("DY")) entryFor = "Dryer";
  }
  // Lbx_Ag_Nature_Leave: the account the note is against gives byte_ag_book (its book), the nature is int_type; |sys.slab_book| follows the book against.
  const against = returnFor !== "" && bookActual ? firstCombo.against : undefined;
  let agBook = 0;
  if (against && against.code > 0) {
    agBook = toInt(field((await loader.readTable(`SELECT book FROM |sys.db|account WHERE code = $1`, [against.code]))?.[0], "book"));
    if (agBook > 0) type = against.nature;
  }
  // A note of a nature that takes no stock (Others: book_properties.stkm_stkentry N) has no product rows: its slab amounts are typed.
  const natureNoStock = agBook > 0 && type > 0 && text((await loader.readTable(`SELECT stkm_stkentry FROM |sys.db|book_properties WHERE book_key = $1`, [type]))?.[0], "stkm_stkentry").toUpperCase() === "N";

  // A LINK register (licence 21) is not a book of its own: it makes the destination book's entry from a source entry (LINK ORDER SALE: a SALE invoice from a sale
  // order), so the series, numbers and the saved book code are the destination's (C1dg_LinkEntry_KeyUp: the first account of the destination book).
  let bookCode = toInt(field(row, "code"));
  if (bookActual && session.licence === 21 && text(row, "stkm_fromshort") !== "" && toInt(field(row, "stkm_tobook")) > 0 && text(row, "book_desc").toUpperCase().startsWith("LINK")) {
    const destination = toInt(field((await loader.readTable(`SELECT code FROM |sys.db|account WHERE book = $1 AND a_pos <> 'D' ORDER BY code LIMIT 1`, [bookKey]))?.[0], "code"));
    if (destination > 0) bookCode = destination;
  }
  const values: EntryValues = {
    ...blank,
    bookKey, type, bookCode, bkDbcode, acDbcode, bookActual, forBook: toInt(field(row, "stkm_forbook")),
    stkmShort, stkmFromShort,
    ...(agBook > 0 && against ? { agBook, agCode: against.code } : {}),
    ...extra,
  };
  return {
    values, row, stkmId, stkmToShort, stockNat, stockNatBoth, returnFor,
    inventory: text(row, "stkm_stkentry").toUpperCase() === "Y" && !natureNoStock,
    party: text(row, "stkm_pcode").toUpperCase() === "Y",
    slab, entryFor, linkFromParty, warnings,
  };
}

// ---------------------------------------------------------------------------------------
// Entry_Control_Properties

const EWAY_CONTROLS = new Set(["cmb_supplytype", "cmb_subsupplytype", "cmb_documenttype", "cmb_transportmode", "cmb_vehicletype", "tbx_distancekm", "tbx_ewaybillno", "dtp_ewaydate", "tbx_ewayvalid"]);
const FOOT_CONTROLS = new Set(["tbx_narration", "tbx_credit_days", "cmb_rev_entry"]);

function placeOf(name: string): ControlPlace {
  return EWAY_CONTROLS.has(name) ? "E" : FOOT_CONTROLS.has(name) ? "B" : "T";
}

function typeOf(name: string): InvoiceControl["type"] | null {
  if (name.startsWith("cmb_")) return "CB";
  if (name.startsWith("dtp_")) return "DT";
  if (name.startsWith("tbx_")) return "TB";
  return null;
}

/** Licence 21 names the challan / entry boxes after the invoice on a purchase-side book. */
function licence21Caption(caption: string, forBook: number, bookActual: boolean): string {
  if ((bookActual && forBook === 8) || (!bookActual && (forBook === 27 || forBook === 28))) return caption;
  return ({ "Chln. Dt.": "Inv. Dt.", "Chln. No.": "Inv. No.", Date: "Ent. Dt.", Number: "Ent. No." } as Record<string, string>)[caption] ?? caption;
}

async function headerControls(loader: Loader, entryId: number, book: BookContext, replace: (sql: string) => string, voucher = false): Promise<InvoiceControl[]> {
  const { session } = loader;
  const { values } = book;
  const forBook = values.type > 0 ? values.type : values.bookKey;
  const rows = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_control WHERE entry_id = $1 AND add_active ORDER BY field_add_order, entry_control_key`, [entryId])) ?? [];
  const controls: InvoiceControl[] = [];
  for (const original of rows) {
    const name = text(original, "control_name").toLowerCase();
    const type = typeOf(name);
    if (!type) continue; // the grids are laid out by the screen
    const row: Row = { ...original };
    // Cmb_FirstCombo_Leave's per-control changes before Entry_Control_Properties.
    if ((name === "dtp_chlndate" || name === "tbx_chlnno") && !values.bookActual && values.type > BOOK.JOURNAL) continue;
    if (name === "dtp_entrydate" || name === "tbx_entryno") {
      const orders = !values.bookActual && (values.type === 22 || values.type === 23) && session.licence !== 14 && (name === "tbx_entryno" || session.licence !== 21);
      if (orders) { row.field_enable_book = ""; row.add_visible = false; }
      else if (name === "dtp_entrydate" && !values.bookActual && values.type === 37 && session.licence === 21) { row.field_enable_book = `${text(row, "field_enable_book")} ${values.type},`; row.add_visible = true; }
      else if (name === "dtp_entrydate" && para(session.setup, "entry_para", "COL_REELNO13,") && values.bookKey === BOOK.PURCH && values.firstCombo.text.startsWith("LINK")) { row.field_enable_book = `${text(row, "field_enable_book")} ${values.type},`; row.add_visible = true; }
      if (session.licence !== 21 && (values.type === 28 || values.type === 30)) row.field_enable_book = toText(row.field_enable_book).replace(" 28, 30,", "");
    }
    if (name === "tbx_partyname" && !book.party) continue;
    if (name === "cmb_rev_entry" && !voucher && !((values.bookKey === BOOK.EXPENSE || values.bookKey === BOOK.AGENCY) && session.coGstReq)) continue;
    // The TDS auto journal shows the foot box (Credit Days, as "TDS Amount") on the expense, agency and purchase books; the screen hides it for a party with no TDS.
    const tdsBox = name === "tbx_credit_days" && tdsAutoJournal(session.setup) && tdsBook(values.bookKey, values.bookActual);
    if (tdsBox) { row.field_enable_book = `${text(row, "field_enable_book")} ${forBook},`; row.field_disable_book = ""; row.add_visible = true; }
    // Entry_Control_Properties: shown on an add when add_visible and the book is enabled (and not disabled).
    if (!flag(row, "add_visible")) continue;
    if (!` ${toText(row.field_enable_book)}`.includes(` ${forBook},`) || ` ${toText(row.field_disable_book)}`.includes(` ${forBook},`)) continue;
    let label = text(row, "label_caption");
    if (session.licence === 21) label = licence21Caption(label, forBook, values.bookActual);
    if (tdsBox) label = "TDS Amount";
    const compulsory = flag(row, "value_compulsory") && text(row, "field_name").toUpperCase() !== "(GRID)";
    const options = type === "CB" ? await controlOptions(loader, row, replace) : [];
    controls.push({
      name,
      label: compulsory ? `* ${label}` : label,
      type,
      place: placeOf(name),
      label_: { left: toInt(field(row, "label_left")), top: toInt(field(row, "label_top")), width: toInt(field(row, "label_width")), height: toInt(field(row, "label_height")), right: text(row, "label_textalign").toUpperCase() === "R" },
      box: { left: toInt(field(row, "control_left")), top: toInt(field(row, "control_top")), width: toInt(field(row, "control_width")), height: toInt(field(row, "control_height")) },
      tabIndex: toInt(field(row, "control_tabindex")),
      compulsory,
      editableOnEdit: flag(row, "update_editable"),
      options,
      initial: text(row, "defa_fixvalue") || (type === "CB" ? (options[0]?.text ?? "") : ""),
      maxLength: toInt(field(row, "field_length_max")) || toInt(field(row, "field_length")),
      tooltip: text(row, "field_tooltips"),
      ...(tdsBox ? { tds: true } : {}),
    });
  }
  return controls;
}

// ---------------------------------------------------------------------------------------
// Fill_Slab_and_Addon + InputCol_Property_Change: the product grid's columns

type BodyItem = { row: Row; column: string; addon: boolean };

/** The packing / loose / bundle / rejection / part code columns the company and the book show. */
function columnSwitches(loader: Loader, book: BookContext) {
  const { setup, licence } = loader.session;
  const { values } = book;
  const entry = (token: string) => para(setup, "entry_para", token);
  const sw = {
    packing: entry("COL_PACK,"), loose: entry("COL_LOOSE,"), bundle: entry("COL_BUNDLE,"), rejection: entry("COL_REJECT,"),
    partCode: values.bookKey === 10 || values.bookKey === 15 ? false : entry("COL_PARTCODE,"),
    mrp: !entry("X_MRP,"), rateWithTax: entry("RATE_WITH_TAX,"), sameBillReturn: entry("SAME_BILL_RET,"), reelNo13: entry("COL_REELNO13,"),
    hideStock: para(setup, "item_para", "STKHIDE,"), hideFactor: para(setup, "item_para", "FACTHIDE,"),
  };
  if (entry("COL_PACK8,") || entry("COL_PACK13,")) {
    if (licence === 21) {
      const plain = ["IND-PURCH", "QTN-PURCH", "ORD-IN"].some((short) => values.stkmFromShort.includes(short)) || ["JOB-OUT", "LJOUT-IN", "JOB-IN"].includes(values.stkmShort)
        || ["FR", "PS", "PF", "PM", "ST"].includes(book.stkmId) || values.bookKey === 10 || values.bookKey === 15 || (values.stkmShort === "" && values.bookKey === 13);
      sw.packing = !plain; sw.loose = !plain; sw.bundle = !plain;
      sw.rejection = plain && ["LJOUT-IN", "JOB-IN", "PROD-SFG"].includes(values.stkmShort);
    } else if (values.bookKey === BOOK.SALE && (values.bookActual || values.stkmShort === "ORD-OUT" || licence === 6)) {
      sw.packing = entry("COL_PACK8,"); sw.loose = entry("COL_LOOSE8,"); sw.bundle = entry("COL_BUNDLE8,");
    } else if (values.bookKey === BOOK.PURCH || licence === 6) {
      sw.packing = entry("COL_PACK13,"); sw.loose = entry("COL_LOOSE13,"); sw.bundle = entry("COL_BUNDLE13,");
    }
  }
  if (entry("COL_BUNDLE8,") && book.stockNat === "L" && !values.bookActual && book.stockNatBoth) sw.bundle = false;
  else if (entry("COL_BUNDLE13,") && book.stockNat === "A" && !values.bookActual && book.stockNatBoth) sw.bundle = false;
  return sw;
}

function setRow(body: BodyItem[], column: string, change: Row) {
  const item = body.find((candidate) => candidate.column.toLowerCase() === column);
  if (item) item.row = { ...item.row, ...change };
}

/** InputCol_Property_Change, for the invoice style. */
function columnChanges(loader: Loader, book: BookContext, body: BodyItem[], style: "I" | "V" = "I"): { hidden: Set<string>; captions: Map<string, string>; widths: Map<string, number> } {
  const { licence } = loader.session;
  if (style === "V") {
    // The voucher style keeps a column only for the day books its visible_for_book lists (Entry.cs, InputCol_Property_Change).
    const hiddenColumns = new Set<string>();
    for (const item of body) {
      const books = text(item.row, "visible_for_book").trim();
      if (books !== "" && !` ${books}`.includes(` ${book.values.bookKey},`)) hiddenColumns.add(item.column.toLowerCase());
    }
    return { hidden: hiddenColumns, captions: new Map(), widths: new Map() };
  }
  const sw = columnSwitches(loader, book);
  const { values } = book;
  const hidden = new Set<string>();
  const captions = new Map<string, string>();
  const widths = new Map<string, number>();
  const drCrOrStock = sw.sameBillReturn && (!values.bookActual || book.entryFor === "DrCr");
  if (!sw.mrp) hidden.add("master_rate");
  else if (sw.rateWithTax) { setRow(body, "master_rate", { update_grid_editable: true }); setRow(body, "rate", { update_grid_editable: false }); }
  else if (licence === 6) setRow(body, "master_rate", { update_grid_editable: true });
  if (!sw.packing || drCrOrStock) hidden.add("pack_qty");
  if (values.stkmShort === "JOB-BILL" || values.stkmShort === "LJOUT-IN") hidden.add("master_rate");
  if (!sw.loose) hidden.add("loose_qty");
  if (!sw.rejection || !["LJOUT-IN", "JOB-IN", "PROD-SFG"].includes(values.stkmShort)) hidden.add("cost_rate");
  if (values.stkmShort === "PROD-SFG") setRow(body, "cost_rate", { update_grid_editable: false });
  if (!sw.bundle || drCrOrStock) hidden.add("bundle");
  if (values.bookActual && sw.reelNo13 && values.bookKey === BOOK.PURCH) { setRow(body, "reel_no", { update_grid_visible: true }); captions.set("reel_no", "Reel No."); } else hidden.add("reel_no");
  if (!sw.partCode) hidden.add("il_prodcd");
  if (licence === 82 && sw.partCode) { captions.set("il_prodcd", "Description"); widths.set("il_prodcd", 110); }
  if (sw.hideStock) { hidden.add("stock_1"); hidden.add("stock_2"); }
  else if ([14, 17, 82].includes(licence)) hidden.add("stock_2");
  if (licence === 45) { hidden.add("prod_desc"); hidden.add("uomentry_id"); }
  if (licence === 82) { hidden.add("stock_1"); hidden.add("prod_desc"); }
  if (values.stkmShort === "LJOUT-IN" || values.stkmShort === "JOB-OUT") { widths.set("prod_desc", 400); hidden.add("stock_2"); }
  hidden.add("order_no");
  if (sw.sameBillReturn && values.bookActual) { captions.set("pack_qty", "Retn.Qty."); captions.set("bundle", "Order Qty."); }
  if (sw.hideFactor) { hidden.add("factor"); hidden.add("stock_2"); }
  return { hidden, captions, widths };
}

/** Tax lists by group, as Fill_Slab_and_Addon reads tax_master for a master slab row. */
async function taxList(loader: Loader, group: BookScreen["taxGroup"], linked: boolean): Promise<Row[]> {
  const stateName = loader.session.licence === 21 ? "UTGST" : "SGST";
  const where = group === "V"
    ? "tax_div = (select idopt_key from |sys.db|idopt_master where idopt_flag='TX' and coalesce(opt_short,'')<>'GST' limit 1)"
    : `tax_type = (select idopt_key from |sys.db|idopt_master where idopt_flag='TT' and coalesce(opt_short,'')='${linked ? stateName : group === "I" ? "IGST" : "CGST"}' limit 1)`;
  return (await loader.readTable(entryDialect(`Select tax_desc,tax_rec,tax_defa,tax_short from |sys.db|tax_master where ${where} and tax_pos<>'D' order by tax_desc`))) ?? [];
}

/** Whether choosing the register asks CGST / IGST / VAT (a stock module whose source has no party, on a GST company). */
export function asksTaxGroup(book: Pick<BookContext, "linkFromParty" | "slab">, gst: boolean): boolean {
  return !book.linkFromParty && gst && book.slab;
}

export async function loadBook(loader: Loader, entryName: string, firstCombo: EntryOption, chosenGroup?: BookScreen["taxGroup"]): Promise<BookScreen & { asksTaxGroup: boolean }> {
  const { session } = loader;
  const properties = await entryProperties(loader, entryName);
  const entryId = toInt(field(properties, "entry_key"));
  let book = await bookContext(loader, entryName, firstCombo);
  const warnings = [...book.warnings];

  // Book rights: "Book-<book_desc>" position 0 (entries allowed at all).
  const bookRights = await readRights(loader.client, session, `Book-${text(book.row, "book_desc") || firstCombo.text}`);
  if (!bookRights.entry) throw new Error("Entry Allowed Rights Not Available For User");

  const allEvents = await controlEvents(loader, entryId);
  const events = allEvents.filter((event) => text(event, "control_name").toLowerCase() === "first_combo");
  const grids = {
    slab: await gridColumns(loader, toInt(field(events.find((event) => text(event, "fill_column_for").toLowerCase() === "item_slab"), "fill_grid_event_id"))),
    addon: await gridColumns(loader, toInt(field(eventFilling(allEvents, "c1dg_addon"), "fill_grid_event_id"))),
    outstanding: await gridColumns(loader, toInt(field(eventFilling(allEvents, "c1dg_outclear") ?? eventFilling(allEvents, "c1dg_v_outclear"), "fill_grid_event_id"))),
  };
  const replace = (sql: string) => replaceEntryTokens(blankCoalesceAsText(sql), book.values);
  const asks = asksTaxGroup(book, session.coGstReq);
  const taxGroup: BookScreen["taxGroup"] = chosenGroup ?? (session.coGstReq ? "G" : "V");

  let balance = "";
  let seriesOptions: EntryOption[] = [];
  let inventory = book.inventory;
  const body: BodyItem[] = [];
  const slabRows: SlabRow[] = [];
  const itemSlabColumns: { item: BodyItem; options?: readonly EntryOption[] }[] = [];

  const voucher = entryName.trim().toUpperCase().startsWith("V");
  for (const event of events) {
    // control_cond_oper "in": the event runs only for the books listed (the journal book's own series list).
    if (text(event, "control_cond_oper").toLowerCase() === "in" && !` ${text(event, "control_cond_book")}`.includes(` ${book.values.bookKey},`)) continue;
    if (voucher && text(event, "control_type").toLowerCase() === "cmb" && text(event, "control_cond_oper") === "") continue;
    const eventId = toInt(field(event, "fill_grid_event_id"));
    const fillFor = text(event, "fill_column_for").toLowerCase();
    const fill = toText(field(event, "fill_control_query"));
    if (eventId > 0) {
      const rows = await gridBody(loader, eventId);
      if (fillFor === "") {
        // c1dg_Inputdata: one column per body row, named by field_name (or its restore).
        for (const row of rows) body.push({ row, column: (text(row, "field_name") || text(row, "field_restore")).replace(/^.*\./, ""), addon: false });
        continue;
      }
      if (fillFor === "item_slab" && book.slab) {
        const select = `Select ${rows.map((row) => text(row, "field_restore") || text(row, "field_name")).join(",")},${fill}`;
        const slab = (await loader.readTable(replace(select))) ?? [];
        if (slab.length === 0 && book.values.bookActual) throw new Error("Slab Master not define for the book...");
        slabRows.push(...await slabGrid(loader, book, slab, taxGroup, inventory, itemSlabColumns));
        continue;
      }
      if (fillFor === "product_addon") {
        let sql = `Select ${fill}`;
        if (!book.values.bookActual && book.values.type > 0 && book.stkmToShort === "") sql = sql.replace(/\|sys\.book\|/g, String(book.values.type));
        const fields = (await loader.readTable(replace(sql))) ?? [];
        const addonBody = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_grid_body WHERE LEFT(BTRIM(field_name), 7) = '_addon_' AND UPPER(BTRIM(field_unique_name)) LIKE 'INPUT\\_%' ORDER BY entry_grid_body_key`)) ?? [];
        const added = addonColumns(fields, addonBody, "aientry", false);
        for (const item of added.body) {
          const addon = fields.find((candidate) => item.column.toLowerCase().endsWith(text(candidate, "fiel_save").toLowerCase()));
          const options = text(addon, "fiel_type") === "M" ? await queryOptions(loader, replace(`select sub_name,sub_code from |sys.db|addon_sub where para_id=${toInt(field(addon, "fiel_key"))} and sub_pos <>'D' order by sub_name`)) : undefined;
          body.push({ ...item, row: { ...item.row, ...(options ? { _options: options } : {}) } });
        }
      }
      continue;
    }
    // Plain events: the book balance label, the series list, and the variables.
    let sql = `Select ${fill}`;
    const controlType = text(event, "control_type").toLowerCase();
    if (!book.values.bookActual && book.stkmToShort !== "" && sql.includes("|sys.book_code|") && controlType === "cmb") {
      sql = sql.replace("|sys.book_code|", `(select code from |sys.db|account where book=(select book_key from |sys.db|book_properties where stkm_short='${book.stkmToShort.replace(/'/g, "''")}'))`);
    }
    const rows = await loader.readTable(replace(sql));
    if (!rows) continue;
    const first = displayValue(Object.values(rows[0])[0]);
    if (controlType === "cmb") seriesOptions = rows.map((row) => { const values = Object.values(row); return { text: toText(displayValue(values[0])).trim(), value: toText(displayValue(values[1])) }; });
    else if (controlType === "lbl") balance = first;
    else if (controlType === "vrbl") {
      const system = text(event, "system_value").toLowerCase();
      if (system === "sys.var.str_ac_help") book = { ...book, values: { ...book.values, acHelp: first !== "" ? first : " 2, 3," } };
      else if (system === "sys.var.str_inventory" && first !== "Y" && book.slab) inventory = false;
    }
  }
  const sides = voucher ? await voucherSides(loader, book, allEvents) : [];
  // The voucher's addon fields by the register: events 39 (header, entrypos L) and 40 (a column of each account row, entrypos P) read addon_fld for the book.
  const voucherAddon = voucher
    ? {
      header: await readAddonItems(loader, book, `Select ${toText(field(allEvents.find((event) => text(event, "control_name").toLowerCase() === "first_combo" && text(event, "fill_control_name").toLowerCase() === "c1dg_addon"), "fill_control_query"))}`, 0),
      row: await (async () => {
        const rowEvent = allEvents.find((event) => text(event, "control_name").toLowerCase() === "first_combo" && text(event, "fill_column_for").toLowerCase() === "account_addon");
        const items = await readAddonItems(loader, book, `Select ${toText(field(rowEvent, "fill_control_query"))}`, 0);
        // The `_addon_combo` (a list) and `_addon_input` (typed) rows of the account grid's event give the column widths.
        const widths = new Map(((await loader.readTable(`SELECT field_name, update_grid_width FROM ${SETUP_SCHEMA}.entry_grid_body WHERE entry_control_id = $1 AND BTRIM(field_name) IN ('_addon_combo', '_addon_input')`, [toInt(field(rowEvent, "fill_grid_event_id"))])) ?? []).map((row) => [text(row, "field_name"), toInt(field(row, "update_grid_width"))]));
        return items.map((item) => { const width = widths.get(item.options ? "_addon_combo" : "_addon_input"); return width ? { ...item, width } : item; });
      })(),
    }
    : undefined;
  if (voucher && sides.length > 0 && seriesOptions.length === 0) seriesOptions = [...sides[0].series];
  if (book.values.acHelp === "") book = { ...book, values: { ...book.values, acHelp: text(book.row, "bs_achelp") || " 2, 3," } };

  // The balance label hides on HIDEBAL, and for a book that does not post (str_Book_Post N).
  const bookPost = para(session.setup, "entry_para", "XBOOK_POST,") ? "X" : text((await loader.readTable(`Select a_posting from |sys.db|account where code=$1`, [book.values.bookCode]))?.[0], "a_posting").toUpperCase() === "N" ? "N" : "Y";
  if (para(session.setup, "disp_para", "HIDEBAL,") || bookPost === "N") balance = "";

  // Decimals from the company setup (Fill_Slab_and_Addon).
  const setup = session.setup;
  setRow(body, "il_value", { decimal_points: toInt(setup.decamount) });
  setRow(body, "quantity", { decimal_points: toInt(setup.i_decqty) });
  setRow(body, "factor", { decimal_points: toInt(setup.i_decfact) });
  setRow(body, "rate", { decimal_points: toInt(setup.i_decrate) });
  if (!book.values.bookActual && text(book.row, "stkm_rate") === "N") setRow(body, "rate", { update_grid_editable: false });
  // Item-wise slab columns go after the event's own columns, then the product addon columns.
  const productBody = [...body.filter((item) => !item.addon), ...itemSlabColumns.map((entry) => entry.item), ...body.filter((item) => item.addon)];
  const changes = columnChanges(loader, book, productBody, entryName.trim().toUpperCase().startsWith("V") ? "V" : "I");
  const options = new Map<string, readonly EntryOption[]>(itemSlabColumns.filter((entry) => entry.options).map((entry) => [entry.item.column.toLowerCase(), entry.options!]));
  const plan = { body: productBody } as unknown as GridPlan;
  const seen = new Set<string>();
  const columns: EntryColumn[] = [];
  for (const item of productBody) {
    const key = item.column;
    if (seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    const column = columnFor(key, plan);
    const lower = key.toLowerCase();
    const caption = changes.captions.get(lower) ?? column.caption;
    const listed = options.get(lower) ?? (item.row._options as readonly EntryOption[] | undefined);
    columns.push({
      ...column,
      caption: properHeading(caption),
      width: changes.widths.get(lower) ?? column.width,
      visible: column.visible && !changes.hidden.has(lower),
      setup: publicSetup(toSetup(item.row)),
      ...(listed ? { options: listed } : {}),
    });
  }
  // c1dg_Inputdata.Cols.Frozen = prod_key + 1 (not licence 45): the columns up to Product stay put.
  const productAt = columns.filter((column) => column.visible).findIndex((column) => column.key.toLowerCase() === "prod_key");
  const frozen = session.licence !== 45 && productAt >= 0 ? productAt + 1 : 0;
  const totals = productBody.filter((item) => text(item.row, "field_total") === "Y").map((item) => item.column);

  const controls = await headerControls(loader, entryId, book, replace, voucher);
  const series = seriesOptions[0]?.text ?? "";
  const defaults = series === "" ? { date: clampToYear(loader, new Date()), number: "", from: formatDesktopDate(session.tarikh1), upto: formatDesktopDate(session.tarikh2), chlnFrom: formatDesktopDate(addDays(session.tarikh1, -120)) } : await seriesDefaults(loader, entryName, book, series);
  const taxPercs = Object.fromEntries(((await loader.readTable(`SELECT tax_rec, tax_perc FROM |sys.db|tax_master WHERE tax_pos <> 'D'`)) ?? []).map((row) => [toText(displayValue(field(row, "tax_rec"))), toDecimal(field(row, "tax_perc"))]));
  const uomQuery = text((await loader.readTable(`SELECT query_string FROM ${SETUP_SCHEMA}.query_table WHERE BTRIM(query_prog_id) = 'PROD_UOM_LIST_SRT'`))?.[0], "query_string");
  const uoms = uomQuery !== "" ? await queryOptions(loader, replace(uomQuery)) : [];
  const setoffBooks = ((await loader.readTable(`SELECT save_only_forbook FROM ${SETUP_SCHEMA}.entry_save_properties WHERE entrykey_id = $1 AND record_active AND LOWER(grid_name) = 'c1dg_outclear' AND multiple_save`, [entryId])) ?? []).map((row) => text(row, "save_only_forbook"));
  return {
    bookCode: book.values.bookCode,
    bookKey: book.values.bookKey,
    bookActual: book.values.bookActual,
    type: book.values.type,
    side: book.values.bkDbcode === 1 ? "Debit" : "Credit",
    entryFor: book.entryFor,
    stkmShort: book.values.stkmShort,
    party: book.party,
    inventory,
    slab: book.slab,
    setoff: voucher || setoffBooks.some((list) => list.replace(/ /g, "").split(",").includes(String(book.values.bookKey))),
    ...(voucherAddon ? { voucherAddon } : {}),
    balance,
    taxGroup,
    controls: controls.map((control) => (control.name === "cmb_series" ? { ...control, options: seriesOptions, initial: series } : control.name === "cmb_side" ? { ...control, options: sides.map((side) => ({ text: side.text, value: side.value })), initial: sides[0]?.text ?? "" } : control)),
    sides,
    ...(voucher ? { voucherMulti: { daybook: para(session.setup, "entry_para", "MULTIDAY,"), jv: para(session.setup, "entry_para", "MULTIJV,") } } : {}),
    // The desktop offers Field_LastValue.Count() (2000) rows: enough for any bill.
    product: { columns, rows: inventory ? 200 : 0, frozen, totals },
    slabRows,
    grids,
    partyBooks: book.values.acHelp,
    defaults,
    taxPercs,
    productRules: {
      rateOptional: text(book.row, "stkm_ropt").toUpperCase() === "O",
      noDuplicate: toText(session.setup.i_duplichk).toUpperCase() === "Y",
      // bl_Stock_compulsory (i_stock C) on a stock-posting issue book of the invoice style; an AD user is exempt unless SMARTWINFA_STOCK_CHECK_FOR_ADMIN=true (testing).
      stockCheck: toText(session.setup.i_stock).toUpperCase() === "C" && text(book.row, "stkm_stkpost").toUpperCase() === "Y" && book.stockNat === "L" && (session.userType !== "AD" || process.env.SMARTWINFA_STOCK_CHECK_FOR_ADMIN === "true"),
      message: !(book.values.bookKey === BOOK.SALE && book.values.bookActual) && book.values.stkmShort !== "CHLN-OUT" ? "" : para(session.setup, "item_para", "PROD_LOCK,") ? "lock" : para(session.setup, "item_para", "PROD_WARN,") ? "warn" : "",
    },
    uoms,
    decimals: { qty: toInt(setup.i_decqty), factor: toInt(setup.i_decfact), rate: toInt(setup.i_decrate), value: toInt(setup.decamount) || 2 },
    stockNat: book.stockNat === "A" ? "A" : "L",
    stockNatBoth: book.stockNatBoth,
    warnings,
    asksTaxGroup: asks && !chosenGroup,
  };
}

/**
 * The voucher's Book Side box (combo_value V): book_properties.book_side holds the letters (RP receipt / payment, DC debit / credit,
 * GT given / taken), BOOK_SIDE lists their names, and the side picked sets the account's side (Cmb_Side_Leave: first item account debit,
 * second account credit) which picks the series list (cmb_side's LF event, bn_dbcode = the book's side).
 */
async function voucherSides(loader: Loader, book: BookContext, events: readonly Row[]): Promise<NonNullable<BookScreen["sides"]>> {
  const letters = text((await loader.readTable(`SELECT book_side FROM |sys.db|book_properties WHERE book_key = $1`, [book.values.bookKey]))?.[0], "book_side").trim();
  if (letters === "") return [];
  const list = (await loader.readTable(`SELECT combo_list, crv_key FROM ${SETUP_SCHEMA}.combo_runvalue WHERE BTRIM(combo_run_id) = 'BOOK_SIDE' AND STRPOS($1, BTRIM(combo_run_value)) > 0 ORDER BY crv_key`, [letters])) ?? [];
  const seriesEvent = events.find((event) => text(event, "control_name").toLowerCase() === "cmb_side" && text(event, "control_event").toUpperCase() === "LF");
  const sides: NonNullable<BookScreen["sides"]>[number][] = [];
  for (const [index, row] of list.entries()) {
    const acDbcode = index === 0 ? 1 : 2;
    const bkDbcode = acDbcode === 1 ? 2 : 1;
    const fill = toText(field(seriesEvent, "fill_control_query"));
    const series = fill === "" ? [] : await queryOptions(loader, replaceEntryTokens(blankCoalesceAsText(`Select ${fill}`), { ...book.values, acDbcode, bkDbcode }));
    sides.push({ text: text(row, "combo_list"), value: toText(displayValue(field(row, "crv_key"))), acDbcode, series });
  }
  return sides;
}

/** Fill_Slab_and_Addon's item_slab branch: the slab rows, their tax lists, and the item-wise columns. */
async function slabGrid(loader: Loader, book: BookContext, rows: Row[], group: BookScreen["taxGroup"], inventory: boolean, itemColumns: { item: BodyItem; options?: readonly EntryOption[] }[]): Promise<SlabRow[]> {
  const work = rows.map((row) => ({ ...row }));
  // Rows from the second on: the tax master rows are renamed for the group, the linked (SGST) row dropped unless CGST.
  const removed = new Set<number>();
  let serial = 1;
  for (let index = 1; index < work.length; index += 1) {
    const row = work[index];
    let keep = true;
    if (text(row, "slab_master") === "Y") {
      const linked = toInt(field(row, "slab_link")) > 0;
      if (group === "V") { if (linked) keep = false; else Object.assign(row, { slab_repohd: "VAT Code", slab_desc: "VAT Code", slab_short: "VAT" }); }
      else if (group === "G") { if (!linked) Object.assign(row, { slab_repohd: "CGST Code", slab_desc: "CGST Code", slab_short: "CGST" }); }
      else if (linked) keep = false;
      else Object.assign(row, { slab_repohd: "IGST Code", slab_desc: "IGST Code", slab_short: "IGST" });
    }
    if (keep) { serial += 1; row.slab_order = serial; } else removed.add(index);
  }
  const kept = work.filter((_row, index) => !removed.has(index));
  // slab_link names the grid row (1-based) whose running total a linked row works on: its place among the kept rows.
  const keptIndex = (original: number) => (removed.has(original) ? -1 : original - [...removed].filter((gone) => gone < original).length);
  const itemBody = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_grid_body WHERE BTRIM(database_name) = 'ledger_ext' AND LEFT(BTRIM(field_name), 6) = '_slab_' ORDER BY entry_grid_body_key`)) ?? [];
  const bookKey = book.values.bookKey;
  const out: SlabRow[] = [];
  for (let index = 0; index < kept.length; index += 1) {
    const row = kept[index];
    const master = text(row, "slab_master") === "Y";
    // Item-wise rows (slab_pos P) are fed by the product rows; a book with no product rows (Entry.cs: slab_pos P with str_Inventory not Y) works them as the entry's own rows.
    const itemWise = text(row, "slab_pos") === "P" && inventory;
    const calc = text(row, "slab_calc");
    const mathOp = text(row, "slab_mathop").toUpperCase();
    const short = text(row, "slab_short").trim();
    let perc = toDecimal(field(row, "slab_pdefa")) > 0 ? String(toDecimal(field(row, "slab_pdefa"))) : "";
    let percEditable = false;
    let amountEditable = false;
    let options: EntryOption[] | undefined;
    if (itemWise) {
      // Item-wise: the % (a tax list on a master row) and the amount become product grid columns.
      for (const base of itemBody) {
        const name = text(base, "field_name");
        if (name === "_slab_perc") {
          const listQuery = master ? (group === "V" ? "VAT_LIST" : group === "I" ? "IGST_LIST" : toInt(field(row, "slab_link")) === 0 ? "CGST_LIST" : "SGST_LIST") : "";
          const list = master ? await queryOptions(loader, replaceEntryTokens(text((await loader.readTable(`SELECT query_string FROM ${SETUP_SCHEMA}.query_table WHERE BTRIM(query_prog_id) = $1`, [listQuery]))?.[0], "query_string"), book.values)) : undefined;
          const heading = master ? `${text(row, "slab_repohd")}%` : `${short}%`;
          itemColumns.push({
            item: { column: short, addon: false, row: { ...base, field_name: short, head_label: heading, head_grid: heading, add_active: true, update_grid_visible: true, update_grid_editable: true, ...(master ? { value_compulsory: true, combo_value: "Q", combo_query: listQuery } : { combo_value: "N", field_type: "N", force_inputtype: "N", update_grid_align: "R", decimal_points: 3, round_length: 2, value_allowed: ".|,|0-9", number_positiveonly: true }) } },
            options: list,
          });
        } else if (name === "_slab_amount") {
          const heading = text(row, "slab_repohd");
          itemColumns.push({ item: { column: `${short}_amt`, addon: false, row: { ...base, field_name: `${short}_amt`, head_label: heading, head_grid: heading, add_active: true, update_grid_visible: true, update_grid_editable: calc !== "A", combo_value: "N", field_type: "N", force_inputtype: "N", update_grid_align: "R", value_allowed: ".|,|0-9", decimal_points: 2, round_length: 2 } } });
        }
      }
    } else if (master) {
      percEditable = true;
      amountEditable = calc !== "A";
      const taxes = await taxList(loader, group, toInt(field(row, "slab_link")) > 0);
      options = taxes.map((tax) => ({ text: text(tax, "tax_desc"), value: toText(displayValue(field(tax, "tax_rec"))) }));
      // The book's default tax (tax_defa lists the books), else the first.
      const preferred = taxes.slice(1).find((tax) => ` ${text(tax, "tax_defa")}`.includes(` ${bookKey},`));
      perc = preferred ? text(preferred, "tax_desc") : (options[0]?.text ?? "");
    } else if (index === 0) {
      amountEditable = !inventory || calc === "M";
    } else if (!(calc === "A" && mathOp === "U")) {
      percEditable = text(row, "slab_preq").toUpperCase() === "Y";
      amountEditable = true;
    }
    out.push({
      key: toInt(field(row, "slab_key") ?? field(row, "slab_id")), // slab_master.* carries its own slab_id: the key is slab_key
      order: toInt(field(row, "slab_order")),
      sign: text(row, "slab_mathoper"),
      desc: master ? `* ${text(row, "slab_desc")}` : text(row, "slab_desc"),
      short,
      master,
      itemWise,
      mathOp,
      perc,
      amount: "0.00",
      percEditable,
      amountEditable,
      ...(options ? { options } : {}),
      calc,
      roundPlaces: toInt(field(row, "slab_round")),
      link: toInt(field(row, "slab_link")) > 0 ? keptIndex(toInt(field(row, "slab_link")) - 1) : -1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Dtp_Date_Enter / Tbx_Number_Enter: a series' default date and number

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function clampToYear(loader: Loader, now: Date): string {
  const { tarikh1, tarikh2 } = loader.session;
  return formatDesktopDate(now > tarikh2 ? tarikh2 : now < tarikh1 ? tarikh1 : now);
}

/**
 * Control_Event_Procedure's "defa" events: book_number's bn_datedefa / bn_docdefa (or its
 * period D, M, P) pick a query_condition row; its query gives the last date, or the last number
 * to add one to; a system value gives today or a blank.
 */
export async function seriesDefaults(loader: Loader, entryName: string, book: BookContext, series: string, now = new Date(), numberDate = ""): Promise<SeriesDefaults> {
  const properties = await entryProperties(loader, entryName);
  const entryId = toInt(field(properties, "entry_key"));
  const values: EntryValues = { ...book.values, series };
  const events = await controlEvents(loader, entryId);
  const numberEvent = events.find((event) => text(event, "control_name").toLowerCase() === "cmb_series" && text(event, "control_event").toUpperCase() === "LF" && text(event, "system_value").toLowerCase() === "sys.var.booknumber");
  const bookNumber = numberEvent ? (await loader.readTable(replaceEntryTokens(`Select ${toText(field(numberEvent, "fill_control_query"))}`, values)))?.[0] : undefined;
  const today = clampToYear(loader, now);
  const seriesFrom = parseDesktopDate(displayValue(field(bookNumber, "bn_from")));
  const seriesUpto = parseDesktopDate(displayValue(field(bookNumber, "bn_upto")));
  const seriesPeriod = {
    from: formatDesktopDate(seriesFrom && seriesFrom > loader.session.tarikh1 ? seriesFrom : loader.session.tarikh1),
    upto: formatDesktopDate(seriesUpto && seriesUpto < loader.session.tarikh2 ? seriesUpto : loader.session.tarikh2),
    // A challan may be dated up to 120 days before the series starts.
    chlnFrom: formatDesktopDate(addDays(seriesFrom ?? loader.session.tarikh1, -120)),
  };
  if (!bookNumber) return { date: today, number: "", ...seriesPeriod };
  const queryFor = book.values.bookActual ? "B" : "S";
  const conditions = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.query_condition WHERE BTRIM(qc_control_event) = 'GF' AND LOWER(BTRIM(qc_bn_fieldname)) IN ('bn_datedefa', 'bn_docdefa') AND BTRIM(qc_queryfor) = $1 ORDER BY query_condition_key`, [queryFor])) ?? [];

  let date = today;
  const dateSetting = text(bookNumber, "bn_datedefa");
  for (const condition of conditions.filter((row) => text(row, "qc_bn_fieldname").toLowerCase() === "bn_datedefa" && text(row, "qc_fieldvalue") === dateSetting)) {
    const query = text(condition, "qc_fullquery");
    if (query !== "") {
      const found = parseDesktopDate(displayValue(Object.values((await loader.readTable(replaceEntryTokens(query, values)))?.[0] ?? {})[0]));
      if (found) date = formatDesktopDate(found);
    } else if (text(condition, "qc_systemvalue").toLowerCase().includes("sys.today")) date = formatDesktopDate(now);
  }

  let number = "";
  const period = text(bookNumber, "bn_period");
  const numberSetting = ["D", "M", "P"].includes(period) ? period : text(bookNumber, "bn_docdefa");
  for (const condition of conditions.filter((row) => text(row, "qc_bn_fieldname").toLowerCase() === "bn_docdefa" && text(row, "qc_fieldvalue") === numberSetting)) {
    const query = text(condition, "qc_fullquery");
    if (query !== "") {
      const last = toText(displayValue(Object.values((await loader.readTable(replaceEntryTokens(query, { ...values, docDate: numberDate || date })))?.[0] ?? {})[0])).trim();
      number = /^\d+$/.test(last) ? String(BigInt(last) + BigInt(1)) : text(bookNumber, "bn_start");
    } else if (text(condition, "qc_systemvalue").toLowerCase().includes("sys.blank")) number = "";
  }
  return { date, number, ...seriesPeriod };
}

// ---------------------------------------------------------------------------------------
// Refresh_HelpGrid("A"): the party help

export async function helpColumns(loader: Loader, helpName: string, helpFor: string, keys: readonly string[]) {
  const properties = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.help_properties WHERE help_for = $1 AND help_name = $2 ORDER BY help_colkey`, [helpFor, helpName])) ?? [];
  return properties.flatMap((property: Row) => {
    const key = keys.find((candidate) => candidate.toLowerCase() === text(property, "col_field").toLowerCase());
    if (!key || field(property, "col_visible") !== true) return [];
    const type = text(property, "col_type");
    const decimals = toInt(field(property, "col_decimal"));
    return [{
      key,
      caption: text(property, "col_heading") || key,
      width: toInt(field(property, "col_width")),
      align: text(property, "col_alignment").toUpperCase() || (type === "N" || type === "C" ? "R" : "L"),
      format: type === "C" ? "N2" : type === "D" ? "dd/MM/yyyy" : type === "N" ? (decimals > 0 && decimals <= 4 ? `N${decimals}` : "N") : "",
    }];
  });
}

export async function partyHelp(loader: Loader, entryName: string, firstCombo: EntryOption, acHelp: string): Promise<HelpList> {
  const book = await bookContext(loader, entryName, firstCombo, { acHelp });
  const helpRow = (await loader.readTable(`SELECT help_query, help_col_frozen FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = 'HELP_ENT_ACCOUNT'`))?.[0];
  if (!helpRow) throw new Error("HELP_ENT_ACCOUNT is not in smart_setup.help_table");
  // |sys.replace_acaddon|: the account addons shown in the help (account_help, or the party-rate addon).
  const addons = (await loader.readTable(`SELECT fiel_save, fiel_short FROM |sys.db|addon_fld WHERE fiel_relate = 'A' AND fiel_pos <> 'D' AND (account_help = B'1' OR fiel_partyrate = 'Y') ORDER BY fiel_key`)) ?? [];
  let sql = text(helpRow, "help_query").replace(/\|sys\.replace_acaddon\|,/gi, addons.map((addon) => `txt_${text(addon, "fiel_save").trim()} as "${text(addon, "fiel_short").trim().replace(/"/g, "")}",`).join(""));
  sql = replaceEntryTokens(blankCoalesceAsText(sql), book.values);
  const rows = (await loader.readTable(sql)) ?? [];
  if (rows.length === 0) return { columns: [], rows: [], frozen: 0, total: "Account Master not found... first open New Account then start Entry..." };
  const keys = Object.keys(rows[0]);
  return {
    columns: await helpColumns(loader, "HELP_ENT_ACCOUNT", "E", keys),
    rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, displayValue(value)]))),
    frozen: toInt(field(helpRow, "help_col_frozen")),
    total: `Total Help Record : ${rows.length}`,
  };
}

// ---------------------------------------------------------------------------------------
// Tbx_PartyName_Leave: the address lines (Display_Address) and the account addon grid

/** The first row's values in column order, whatever the columns are called (several may share a name). */
async function firstRowValues(loader: Loader, sql: string): Promise<string[]> {
  await loader.client.query("SAVEPOINT entry_rows");
  try {
    const result = await loader.client.query({ text: sql, rowMode: "array" });
    await loader.client.query("RELEASE SAVEPOINT entry_rows");
    return ((result.rows[0] ?? []) as unknown[]).map((value) => displayValue(value).trimEnd());
  } catch (error) {
    await loader.client.query("ROLLBACK TO SAVEPOINT entry_rows");
    loader.warnings.push(`${error instanceof Error ? error.message : String(error)} :: ${sql.slice(0, 300)}`);
    return [];
  }
}

/**
 * Fill_Slab_and_Addon's addon list for one query over addon_fld: a typed field (I) is an empty input (a date for fiel_mbal D), a list field (M) the subs of the addon
 * (Fill_AddonGridCombo), set to the party's own value when the addon is kept on the master. Compulsory = a list field or fiel_entry C.
 */
async function readAddonItems(loader: Loader, book: BookContext, query: string, code: number): Promise<AddonItem[]> {
  let sql = query;
  if (!book.values.bookActual && book.values.type > 0) sql = sql.replace(/\|sys\.book\|/g, String(book.values.type));
  const fields = (await loader.readTable(replaceEntryTokens(sql, book.values))) ?? [];
  const items: AddonItem[] = [];
  for (const row of fields) {
    const type = text(row, "fiel_type");
    const compulsory = type !== "I" || text(row, "fiel_entry") === "C";
    const label = `${compulsory ? "* " : ""}${text(row, "addon_label")}`;
    if (type !== "M") { items.push({ key: toInt(field(row, "fiel_key")), label, value: "", date: text(row, "fiel_mbal").toUpperCase() === "D", compulsory }); continue; }
    const options = await queryOptions(loader, replaceEntryTokens(`select sub_name,sub_code from |sys.db|addon_sub where para_id=${toInt(field(row, "fiel_key"))} and sub_pos <> 'D' order by sub_name`, book.values));
    let value = options[0]?.text ?? "";
    if (code > 0 && text(row, "fiel_relate") === "A" && text(row, "fiel_masterpos") === "Y" && /^[A-Za-z0-9_]+$/.test(text(row, "fiel_save").trim())) {
      const own = (await loader.readTable(`select txt_${text(row, "fiel_save").trim()} from |sys.db|addon_data where code=$1`, [code]))?.[0];
      if (own) value = toText(displayValue(Object.values(own)[0]));
    }
    items.push({ key: toInt(field(row, "fiel_key")), label, value, options });
  }
  return items;
}

/**
 * The voucher style's account row (input_name's LF event): the account's address box and the bills pending on the side the day book posts to (event 53).
 * voucher.acDbcode is the account's side on this row; voucher.ledKey the row's saved ledger key (an opened voucher: what it set off counts as pending again).
 */
export async function partyDetails(loader: Loader, entryName: string, firstCombo: EntryOption, code: number, docDate = "", addressId = 0, editKey = 0, voucher?: Readonly<{ acDbcode: number; ledKey: number }>): Promise<PartyDetails> {
  const properties = await entryProperties(loader, entryName);
  const entryId = toInt(field(properties, "entry_key"));
  const book = await bookContext(loader, entryName, firstCombo, { acCode: code, ...(voucher && (voucher.acDbcode === 1 || voucher.acDbcode === 2) ? { acDbcode: voucher.acDbcode, bkDbcode: voucher.acDbcode === 1 ? 2 : 1 } : {}) });
  const account = (await loader.readTable(`SELECT name, credit_days FROM |sys.db|account WHERE code = $1 AND a_pos <> 'D'`, [code]))?.[0];
  if (!account) throw new Error("The party is not in the account master");
  const events = (await controlEvents(loader, entryId)).filter((event) => text(event, "control_name").toLowerCase() === (voucher ? "input_name" : "tbx_partyname") && text(event, "control_event").toUpperCase() === "LF");
  let address: string[] = [];
  const addon: AddonItem[] = [];
  for (const event of events) {
    const fillName = text(event, "fill_control_name").toLowerCase();
    if (fillName === "lbx_address") {
      // Display_Address: each column of the row is one line. The columns have no names, so the row is read as a list.
      address = await firstRowValues(loader, replaceEntryTokens(`Select ${toText(field(event, "fill_control_query"))}`, book.values));
    } else if (fillName === "c1dg_addon") {
      addon.push(...(await readAddonItems(loader, book, `Select ${toText(field(event, "fill_control_query"))}`, code)));
    }
  }
  // C1dg_Slab_Leave fills c1dg_OutClear: the party's pending bills on the side the book posts to.
  const outEvents = await controlEvents(loader, entryId);
  const outEvent = eventFilling(outEvents, "c1dg_outclear") ?? eventFilling(outEvents, "c1dg_v_outclear");
  // Only a book that sets off against bills (the debit / credit notes) lists them: a sale or purchase entry leaves the Outstanding grid empty.
  const setoffBooks = ((await loader.readTable(`SELECT save_only_forbook FROM ${SETUP_SCHEMA}.entry_save_properties WHERE entrykey_id = $1 AND record_active AND LOWER(grid_name) = 'c1dg_outclear' AND multiple_save`, [entryId])) ?? []).map((row) => text(row, "save_only_forbook"));
  const settlesBills = Boolean(voucher) || setoffBooks.some((list) => list.replace(/ /g, "").split(",").includes(String(book.values.bookKey)));
  let outSql = outEvent && settlesBills ? `Select ${toText(field(outEvent, "fill_control_query"))}` : "";
  if (voucher) outSql = outSql.replace(/,\s*ledger\s+led\b/i, ", |sys.db|ledger led");
  if (outSql !== "" && (voucher ? voucher.ledKey > 0 : editKey > 0)) {
    // An entry being changed: what it set off against a bill counts as pending again and shows as typed (the bill stays listed even when it is settled).
    const ledKey = voucher ? voucher.ledKey : toInt(field((await loader.readTable(`SELECT led_key FROM |sys.db|ledger WHERE unique_key = $1 AND doc_pos <> 'D' LIMIT 1`, [editKey]))?.[0], "led_key"));
    // The entry's own set-offs, read first (a few rows) and written into the query as figures: a subquery per bill scans the whole outstanding table.
    const own = (await loader.readTable(`SELECT out_ag_outid, SUM(out_setoff::numeric) AS setoff FROM |sys.db|outclear WHERE out_ledid = $1 AND COALESCE(out_ag_outid, 0) > 0 GROUP BY out_ag_outid`, [ledKey])) ?? [];
    const mine = own.length === 0 ? "0" : `(CASE out.out_key ${own.map((row) => `WHEN ${toInt(field(row, "out_ag_outid"))} THEN ${toDecimal(field(row, "setoff"))}`).join(" ")} ELSE 0 END)`;
    const pending = `(out.out_entryamt::numeric-out.out_setoff::numeric-out.out_ly_setoff::numeric+${mine})`;
    outSql = outSql.split("(out.out_entryamt-out.out_setoff-out.out_ly_setoff)>0").join(`${pending}>0`)
      .split("(out.out_entryamt-out.out_setoff-out.out_ly_setoff) as \"out_pending\"").join(`${pending} as "out_pending"`)
      .split("CAST(0 AS DECIMAL(18,4)) as \"out_setoff\"").join(`CAST(${mine} AS DECIMAL(18,4)) as "out_setoff"`)
      .split("CAST(0 AS DECIMAL(18,4)) as \"out_setoff_old\"").join(`CAST(${mine} AS DECIMAL(18,4)) as "out_setoff_old"`)
      .split("CAST(0 AS DECIMAL(18,4)) as \"out_setoff_file\"").join(`CAST(${mine} AS DECIMAL(18,4)) as "out_setoff_file"`);
  }
  const outRows = outSql !== "" ? (await loader.readTable(replaceEntryTokens(outSql, book.values))) ?? [] : [];
  const outstanding = outRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, displayValue(value)])));
  const { stateCode, taxGroup } = await partyTaxGroup(loader, code, docDate);
  // HELP_ADDRESS: all the party's addresses; another than the first adds "Ship to" lines (Display_Address).
  const addressRows = (await loader.readTable(`SELECT address_id, address_1, address_2, address_3, city, pin_code, tel_no, mobile_no, contact FROM |sys.db|address WHERE code = $1 AND a_pos <> 'D' ORDER BY address_id`, [code])) ?? [];
  const addresses = addressRows.map((row) => Object.fromEntries(["address_id", "address_1", "address_2", "address_3", "city", "pin_code", "tel_no", "mobile_no", "contact"].map((key) => [key, toText(displayValue(field(row, key))).trim()])));
  const chosen = addresses.find((row) => Number(row.address_id) === addressId) ?? addresses[0];
  const shown = chosen && Number(chosen.address_id) > 1
    ? [...address.slice(0, 1), `Ship to   : ${chosen.address_1}`, `                : ${chosen.address_2}`, `                : ${chosen.address_3}    City+PIN : ${chosen.city}- ${chosen.pin_code}`, ...address.slice(1)]
    : address;
  return { code, name: text(account, "name"), address: shown, addresses, addressId: chosen ? Number(chosen.address_id) : 1, addon, creditDays: toText(displayValue(field(account, "credit_days"))), stateCode, taxGroup, outstanding };
}

/**
 * Tbx_PartyName_Leave's GST slab setting: before GST (or a company without GST) VAT; a party in
 * the company's state CGST + SGST / UTGST, any other IGST.
 */
export async function partyTaxGroup(loader: Loader, code: number, docDate = ""): Promise<{ stateCode: string; taxGroup: "G" | "I" | "V" }> {
  const { session } = loader;
  const state = (await loader.readTable(`SELECT o.opt_short FROM |sys.db|address a LEFT JOIN |sys.db|idopt_master o ON o.idopt_key = a.state_id WHERE a.code = $1 AND a.address_id = 1`, [code]))?.[0];
  const stateCode = text(state, "opt_short").trim();
  const date = parseDesktopDate(docDate);
  if (!session.coGstReq || (date && date < GST_START_DATE)) return { stateCode, taxGroup: "V" };
  const same = stateCode !== "" && stateCode.replace(/^0+/, "") === session.coStateCode.trim().replace(/^0+/, "");
  return { stateCode, taxGroup: same ? "G" : "I" };
}

// ---------------------------------------------------------------------------------------
// Invoice_Tab_Find_Edit_Enter: the entries of the register and series

/** The names of the book a debit / credit note is against (ledger.ag_bkcode: an account) and its nature (ledger type: a book_properties book_key). */
export async function againstNames(loader: Loader, codes: readonly number[], natures: readonly number[]) {
  const accounts = new Map<number, string>();
  const kinds = new Map<number, string>();
  if (codes.length > 0) for (const row of (await loader.readTable(`SELECT code, name FROM |sys.db|account WHERE code = ANY($1::int[])`, [codes as number[]])) ?? []) accounts.set(toInt(field(row, "code")), toText(field(row, "name")).trim());
  if (natures.length > 0) for (const row of (await loader.readTable(`SELECT book_key, book_desc FROM |sys.db|book_properties WHERE book_key = ANY($1::int[]) AND BTRIM(stkm_pos) = 'A'`, [natures as number[]])) ?? []) kinds.set(toInt(field(row, "book_key")), toText(field(row, "book_desc")).trim());
  return { accounts, kinds };
}

export async function entryPreview(loader: Loader, entryName: string, firstCombo: EntryOption, series: string): Promise<HelpList> {
  const properties = await entryProperties(loader, entryName);
  const helpName = text(properties, "help_preview_queryname");
  const book = await bookContext(loader, entryName, firstCombo, { series });
  // Invoice_Tab_Find_Edit_Enter: a stock-only register (a link / process book such as Job Stock In / Out, with no book against) lists its entries
  // from the process table (STOCK_PREVIEW), not from the ledger the bill list reads.
  const stockOnly = !entryName.trim().toUpperCase().startsWith("V") && !book.values.bookActual && book.values.type > 0 && book.values.agBook === 0;
  const helpRow = (await loader.readTable(`SELECT help_query, help_col_frozen FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = $1`, [stockOnly ? "STOCK_PREVIEW" : helpName]))?.[0];
  if (!helpRow) throw new Error(`${stockOnly ? "STOCK_PREVIEW" : helpName} is not in smart_setup.help_table`);
  // Edit is allowed for every series of the register, so the list is not narrowed to the series on the screen.
  const listQuery = text(helpRow, "help_query").replace(/\s+and\s+[\w.]+\s*=\s*'\|sys\.doc_series\|'/gi, "");
  // A voucher's list row is one ledger row (an account row of the voucher): its own key and side are read along for the Dr/Cr, Final Amt. and Outstanding columns.
  const voucher = entryName.trim().toUpperCase().startsWith("V");
  const rows = (await loader.readTable(replaceEntryTokens(blankCoalesceAsText(voucher ? listQuery.replace(/(select\s+FALSE\s+as\s+"Tick"\s*,)/i, "$1led.led_key AS led_key_raw,led.ac_dbcode AS dbcode_raw,") : listQuery), book.values))) ?? [];
  const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
  const shown = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, displayValue(value)])));
  const columns = keys.length > 0 ? await helpColumns(loader, helpName, "E", keys) : [];
  if (voucher && shown.length > 0) {
    // Amount (the row's own), the row's Dr/Cr, and the voucher's Final Amt. (the larger of its debit and credit totals, as the screen's Entry Final Amt.).
    const amountAt = columns.findIndex((column) => column.key.toLowerCase() === "amount");
    if (amountAt >= 0) columns[amountAt] = { ...columns[amountAt], caption: "Amount" };
    const sums = (await loader.readTable(`SELECT unique_key, ac_dbcode, SUM(amount::numeric) AS total FROM |sys.db|ledger WHERE unique_key = ANY($1::int[]) AND doc_pos <> 'D' AND COALESCE(doc_posting, '') <> 'A' GROUP BY unique_key, ac_dbcode`, [[...new Set(shown.map((row) => toInt(row.unique_key)))]])) ?? [];
    const totals = new Map<number, [number, number]>();
    for (const sum of sums) {
      const pair = totals.get(toInt(field(sum, "unique_key"))) ?? [0, 0];
      pair[toInt(field(sum, "ac_dbcode")) === 1 ? 0 : 1] += toDecimal(field(sum, "total"));
      totals.set(toInt(field(sum, "unique_key")), pair);
    }
    for (const row of shown) {
      const mutable = row as Record<string, string>;
      mutable.dr_cr = toInt(row.dbcode_raw) === 1 ? "Dr" : toInt(row.dbcode_raw) === 2 ? "Cr" : "";
      const pair = totals.get(toInt(row.unique_key));
      mutable.final_amt = pair ? Math.max(pair[0], pair[1]).toFixed(2) : "";
    }
    columns.splice(amountAt + 1, 0, { key: "dr_cr", caption: "Dr/Cr", width: 50, align: "L", format: "" }, { key: "final_amt", caption: "Final Amt.", width: 110, align: "R", format: "N2" });
  }
  // A debit / credit note's list also shows the book each entry is against and its nature.
  if (book.entryFor === "DrCr" && shown.length > 0) {
    const own = (await loader.readTable(`SELECT unique_key, ag_bkcode, "TYPE" AS nature FROM |sys.db|ledger WHERE unique_key = ANY($1::int[])`, [shown.map((row) => toInt(row.unique_key))])) ?? [];
    const byKey = new Map(own.map((row) => [toInt(field(row, "unique_key")), row]));
    const names = await againstNames(loader, [...new Set(own.map((row) => toInt(field(row, "ag_bkcode"))).filter((code) => code > 0))], [...new Set(own.map((row) => toInt(field(row, "nature"))).filter((kind) => kind > 0))]);
    for (const row of shown) {
      const mine = byKey.get(toInt(row.unique_key));
      (row as Record<string, string>).against_book = names.accounts.get(toInt(field(mine, "ag_bkcode"))) ?? "";
      (row as Record<string, string>).against_nature = names.kinds.get(toInt(field(mine, "nature"))) ?? "";
    }
    columns.push({ key: "against_book", caption: "Against Book", width: 130, align: "L", format: "" }, { key: "against_nature", caption: "Nature", width: 130, align: "L", format: "" });
  }
  // How many product rows (Sr.) each listed entry has: one grouped read for the whole list.
  if (shown.length > 0 && book.inventory) {
    const keys = shown.map((row) => toInt(row.unique_key)).filter((key) => key > 0);
    const counts = keys.length === 0 ? [] : (await loader.readTable(
      `SELECT ${stockOnly ? "process_id" : "led_id"} AS owner, COUNT(*) AS n FROM |sys.db|prod_ledger WHERE il_pos = 'A' AND ${stockOnly ? "process_id" : "led_id"} = ANY($1::int[]) GROUP BY 1`,
      [stockOnly ? keys : (await loader.readTable(`SELECT led_key FROM |sys.db|ledger WHERE unique_key = ANY($1::int[])`, [keys]))?.map((row) => toInt(field(row, "led_key"))) ?? []])) ?? [];
    const byOwner = new Map(counts.map((row) => [toInt(field(row, "owner")), toInt(field(row, "n"))]));
    const ledgerKeys = stockOnly ? new Map<number, number>() : new Map(((await loader.readTable(`SELECT unique_key, led_key FROM |sys.db|ledger WHERE unique_key = ANY($1::int[])`, [keys])) ?? []).map((row) => [toInt(field(row, "unique_key")), toInt(field(row, "led_key"))]));
    for (const row of shown) (row as Record<string, string>).sr_count = String(byOwner.get(stockOnly ? toInt(row.unique_key) : ledgerKeys.get(toInt(row.unique_key)) ?? 0) ?? 0);
    columns.push({ key: "sr_count", caption: "Item Row", width: 70, align: "R", format: "" });
  }
  // How many bills each entry sets off in its Outstanding window (a debit / credit note, or any register that sets off): one grouped read for the whole list.
  // The column shows only when some entry of the list has a set-off.
  if (shown.length > 0 && !stockOnly) {
    const keys = shown.map((row) => toInt(row.unique_key)).filter((key) => key > 0);
    const ledgerKeys = new Map(((await loader.readTable(`SELECT unique_key, led_key FROM |sys.db|ledger WHERE unique_key = ANY($1::int[])`, [keys])) ?? []).map((row) => [toInt(field(row, "unique_key")), toInt(field(row, "led_key"))]));
    const ownKey = (row: Record<string, string>) => (voucher && toInt(row.led_key_raw) > 0 ? toInt(row.led_key_raw) : ledgerKeys.get(toInt(row.unique_key)) ?? 0);
    const counts = new Map(((await loader.readTable(`SELECT out_ledid, COUNT(*) AS n FROM |sys.db|outclear WHERE out_ledid = ANY($1::int[]) AND COALESCE(out_ag_outid, 0) > 0 AND out_setoff::numeric > 0 GROUP BY out_ledid`, [voucher ? shown.map(ownKey) : [...ledgerKeys.values()]])) ?? []).map((row) => [toInt(field(row, "out_ledid")), toInt(field(row, "n"))]));
    if (counts.size > 0) {
      for (const row of shown) (row as Record<string, string>).out_rows = String(counts.get(ownKey(row)) ?? 0);
      columns.push({ key: "out_rows", caption: "O/s Row", width: 62, align: "R", format: "" });
      // A voucher's list ends with O/s Row, then Short.
      const shortAt = voucher ? columns.findIndex((column) => column.key.toLowerCase() === "a_short") : -1;
      if (shortAt >= 0) columns.push(...columns.splice(shortAt, 1));
    }
  }
  return {
    columns,
    rows: shown,
    frozen: toInt(field(helpRow, "help_col_frozen")),
    total: `Total Records : ${rows.length}`,
  };
}

// ---------------------------------------------------------------------------------------
// Fill_ReturnsPanel: what a debit / credit note is against

export type ReturnsChoices = Readonly<{
  /** cmb_Ag_Book: the sale and purchase accounts (account books 8 and 13). */
  accounts: readonly Readonly<{ name: string; code: number; book: number }>[];
  /** lbx_Ag_Nature: the books that have a note nature (stkm_fornote), as book_desc / book_key. */
  natures: readonly Readonly<{ text: string; value: number }>[];
  /** The account selected first: the purchase account (21) when the note's account is on the debit side, else the sale account (16). */
  defaultCode: number;
}>;

export async function returnsChoices(loader: Loader, entryName: string, firstCombo: EntryOption): Promise<ReturnsChoices> {
  const book = await bookContext(loader, entryName, firstCombo);
  const accounts = ((await loader.readTable(`SELECT name, code, book FROM |sys.db|account WHERE book IN (8, 13) AND a_pos <> 'D' ORDER BY book, name`)) ?? [])
    .map((row) => ({ name: toText(field(row, "name")).trim(), code: toInt(field(row, "code")), book: toInt(field(row, "book")) }));
  const natures = ((await loader.readTable(`SELECT book_desc, book_key FROM |sys.db|book_properties WHERE BTRIM(book_actual) = 'X' AND BTRIM(stkm_pos) = 'A' AND COALESCE(BTRIM(stkm_fornote), '') <> '' ORDER BY book_desc`)) ?? [])
    .map((row) => ({ text: toText(field(row, "book_desc")).trim(), value: toInt(field(row, "book_key")) }));
  const wanted = book.values.acDbcode === 1 ? 21 : 16;
  return { accounts, natures, defaultCode: accounts.find((account) => account.code === wanted)?.code ?? accounts[0]?.code ?? 0 };
}
