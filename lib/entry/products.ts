import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toInt, toText } from "../master-program/legacy";
import { SETUP_SCHEMA } from "../master-program/session";
import { blankCoalesceAsText } from "../master-program/sql";
import { bookContext, controlEvents, entryProperties, helpColumns, partyTaxGroup } from "./invoice";
import { replaceEntryTokens } from "./values";
import type { EntryValues } from "./values";
import type { EntryOption, HelpList, ProductChoice, RestoredEntry } from "./types";
import type { ProductUnits } from "./calc";

/**
 * The product rows of Comman_Entry: the product help (Refresh_HelpGrid "P"), choosing a product
 * (Product_Selection with ProductChangeEffect's rate and MRP), and opening a saved entry from
 * Find / Edit (Restore_Entry's RESTINV_ queries).
 *
 * The licence-specific product helps (46, 59, 51, 28, 68, 75, 45, 9, 89) and the rate events that
 * need the party-rate addons (|sys.prate_addon_nm|) are not ported: docs/PENDING-WORK.md.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name));

// ---------------------------------------------------------------------------------------
// Refresh_HelpGrid("P"): the product help

export async function productHelp(loader: Loader, entryName: string, firstCombo: EntryOption): Promise<HelpList> {
  const book = await bookContext(loader, entryName, firstCombo);
  const helpRow = (await loader.readTable(`SELECT help_query, help_col_frozen FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = 'HELP_PRODUCT'`))?.[0];
  if (!helpRow) throw new Error("HELP_PRODUCT is not in smart_setup.help_table");
  // |sys.replace_prodaddon|: the product addons marked for the help; |sys.help_stock_3| only with the bundle copy (not ported).
  const addons = (await loader.readTable(`SELECT fiel_save, fiel_short FROM |sys.db|addon_fld WHERE fiel_relate = 'P' AND fiel_pos <> 'D' AND account_help = B'1' ORDER BY fiel_key`)) ?? [];
  let sql = text(helpRow, "help_query")
    .replace(/\|sys\.replace_prodaddon\|,/gi, addons.map((addon) => `txt_${text(addon, "fiel_save").trim()} as "${text(addon, "fiel_short").trim().replace(/"/g, "")}",`).join(""))
    .replace(/,?\|sys\.help_stock_3\|,?/gi, ",");
  sql = replaceEntryTokens(blankCoalesceAsText(sql), book.values);
  const rows = (await loader.readTable(sql)) ?? [];
  if (rows.length === 0) return { columns: [], rows: [], frozen: 0, total: "Product Master not found..." };
  const keys = Object.keys(rows[0]);
  const columns = await helpColumns(loader, "HELP_PRODUCT", "X", keys);
  // Only what the help shows and the key travel: 18,000 products with every column would be several megabytes.
  const kept = ["prod_key", ...columns.map((column) => column.key)];
  return {
    columns,
    rows: rows.map((row) => Object.fromEntries(kept.map((key) => [key, displayValue(row[key])]))),
    frozen: toInt(field(helpRow, "help_col_frozen")),
    total: `Total Help Record : ${rows.length}`,
  };
}

// ---------------------------------------------------------------------------------------
// Product_Selection: the chosen product's units, its rate and MRP

function unitsOf(row: Row): ProductUnits {
  const n = (name: string) => toDecimal(field(row, name));
  const k = (name: string) => toInt(field(row, name));
  return {
    pcsUom: k("pcs_uom"), basePcs: n("base_pcs"), packUom: k("pack_uom"), basePack: n("base_pack"),
    weightUom: k("weight_uom"), baseWeight: n("base_weight"), qty1Uom: k("qty1_uom"), baseQty1: n("base_qty1"),
    qty2Uom: k("qty2_uom"), baseQty2: n("base_qty2"), qty3Uom: k("qty3_uom"), baseQty3: n("base_qty3"),
  };
}

const PRODUCT_SELECT = `SELECT p.*, qa.uom_short AS qtyadd_short, ra.uom_short AS rateadd_short, ql.uom_short AS qtyless_short, rl.uom_short AS rateless_short,
    COALESCE(NULLIF(tax.tax_perc, 0), p.tax_perc) AS product_tax_perc
  FROM |sys.db|product_master p
  LEFT JOIN |sys.db|prod_uom qa ON qa.uom_key = p.recduom_id LEFT JOIN |sys.db|prod_uom ra ON ra.uom_key = p.recdrateuom_id
  LEFT JOIN |sys.db|prod_uom ql ON ql.uom_key = p.issuuom_id LEFT JOIN |sys.db|prod_uom rl ON rl.uom_key = p.issurateuom_id
  LEFT JOIN |sys.db|tax_master tax ON tax.tax_rec = p.vat_code`;

function choiceFrom(row: Row, stockNat: string, extra: Partial<ProductChoice> = {}): ProductChoice {
  const units = unitsOf(row);
  return {
    key: toInt(field(row, "prod_key")),
    short: text(row, "prod_short").trim(),
    desc: text(row, "prod_desc").trim(),
    stock1: "",
    stock2: "",
    qtyUom: (stockNat === "A" ? text(row, "qtyadd_short") : text(row, "qtyless_short")).trim(),
    rateUom: (stockNat === "A" ? text(row, "rateadd_short") : text(row, "rateless_short")).trim(),
    packing: units.basePack > 0 ? String(units.basePack) : "",
    mrp: "",
    rate: "",
    taxRec: toInt(field(row, "vat_code")),
    taxPerc: toDecimal(field(row, "product_tax_perc")),
    units,
    ...extra,
  };
}

/**
 * ProductChangeEffect "R" / "M": control_event input_rate's GF queries in order, as far as they
 * need no party-rate addon: the party's own rate for the product (party_rate), then the price
 * list (pricelist), whose row for the rate's unit gives the rate (sale or purchase) and the MRP.
 */
export async function productChoice(loader: Loader, entryName: string, firstCombo: EntryOption, prodKey: number, acCode: number, docDate: string): Promise<ProductChoice> {
  const book = await bookContext(loader, entryName, firstCombo, { acCode, docDate });
  const stockNat = book.stockNat === "A" ? "A" : "L";
  const row = (await loader.readTable(`${PRODUCT_SELECT} WHERE p.prod_key = $1`, [prodKey]))?.[0];
  if (!row) throw new Error("The product is not in the product master");
  const choice = choiceFrom(row, stockNat);
  const uomKeys = new Map<string, number>(((await loader.readTable(`SELECT uom_key, uom_short FROM |sys.db|prod_uom`)) ?? []).map((uom) => [text(uom, "uom_short").trim(), toInt(field(uom, "uom_key"))]));
  const rateUomKey = uomKeys.get(choice.rateUom) ?? 0;
  const balance = (await loader.readTable(`SELECT clsg_pcs, clsg_pack FROM |sys.db|prod_balance WHERE prod_id = $1 AND prec_flag = 'RP' LIMIT 1`, [prodKey]))?.[0];

  const properties = await entryProperties(loader, entryName);
  const events = (await controlEvents(loader, toInt(field(properties, "entry_key"))))
    .filter((event) => text(event, "control_name").toLowerCase() === "input_rate" && text(event, "control_event").toUpperCase() === "GF")
    .filter((event) => !/\|sys\.prate_addon_nm/i.test(toText(field(event, "fill_control_query"))));
  const values: EntryValues = { ...book.values, acCode, docDate };
  let rate = 0;
  let mrp = 0;
  for (const event of events) {
    const query = `Select ${toText(field(event, "fill_control_query"))}`
      .replace(/\|sys\.prod_key\|/gi, String(prodKey))
      .replace(/\|sys\.rate_stock_nat\|/gi, `'${stockNat}'`)
      .replace(/\|sys\.stock_nat\|/gi, `'${stockNat}'`);
    if (/\|sys\.ac_code\|/i.test(query) && acCode <= 0) continue;
    const rows = (await loader.readTable(replaceEntryTokens(query, values))) ?? [];
    if (rows.length === 0) continue;
    if (query.toLowerCase().includes("party_rate")) {
      const found = rows[0];
      if (rate === 0 && toDecimal(field(found, "pr_rate")) > 0) rate = toDecimal(field(found, "pr_rate"));
      if (mrp === 0 && toDecimal(field(found, "pr_masterrate")) > 0) mrp = toDecimal(field(found, "pr_masterrate"));
    } else if (query.toLowerCase().includes("pricelist")) {
      const rateColumn = stockNat === "A" ? "pl_prate" : "pl_srate";
      const uomColumn = stockNat === "A" ? "pl_puom" : "pl_suom";
      const ofUnit = rows.find((price) => toInt(field(price, uomColumn)) === rateUomKey && toDecimal(field(price, rateColumn)) > 0) ?? rows.find((price) => toDecimal(field(price, rateColumn)) > 0);
      if (rate === 0 && ofUnit) rate = toDecimal(field(ofUnit, rateColumn));
      const mrpRow = rows.find((price) => toInt(field(price, "pl_muom")) === rateUomKey && toDecimal(field(price, "pl_mrp")) > 0) ?? rows.find((price) => toDecimal(field(price, "pl_mrp")) > 0);
      if (mrp === 0 && mrpRow) mrp = toDecimal(field(mrpRow, "pl_mrp"));
    }
    if (rate > 0 && mrp > 0) break;
  }
  return {
    ...choice,
    stock1: balance ? toText(displayValue(field(balance, "clsg_pcs"))) : "",
    stock2: balance ? toText(displayValue(field(balance, "clsg_pack"))) : "",
    rate: rate > 0 ? String(rate) : "",
    mrp: mrp > 0 ? String(mrp) : "",
  };
}

// ---------------------------------------------------------------------------------------
// Restore_Entry: an entry opened from Find / Edit

async function restoreQuery(loader: Loader, id: string): Promise<string> {
  return text((await loader.readTable(`SELECT query_string FROM ${SETUP_SCHEMA}.query_table WHERE BTRIM(query_prog_id) = $1`, [id]))?.[0], "query_string");
}

function controlValue(value: unknown): string {
  if (value instanceof Date) return formatDesktopDate(value);
  const shownValue = toText(displayValue(value)).trim();
  const date = /^\d{4}-\d{2}-\d{2}/.test(shownValue) ? parseDesktopDate(shownValue) : null;
  return date ? formatDesktopDate(date) : shownValue;
}

/**
 * The invoice style's RESTINV_01_LEDGER (header), _02_PRODLEDGER (product rows), _03_SLAB
 * (slab amounts; an item-wise row's amounts per product row) and _04_ADDON (account addons);
 * each control takes the column entry_control names for it (field_name), as the desktop's
 * field_restore_queryid does.
 */
export async function restoreEntry(loader: Loader, entryName: string, firstCombo: EntryOption, uniqueKey: number): Promise<RestoredEntry & { itemSlab: Record<number, Record<number, { perc: string; taxId: number; amount: string }>>; slabTax: Record<number, number> }> {
  const book = await bookContext(loader, entryName, firstCombo);
  if (!book.values.bookActual) throw new Error("Opening a stock register's entry (process) is not ported yet; only account books (sale, purchase ...) open.");
  const properties = await entryProperties(loader, entryName);
  const entryId = toInt(field(properties, "entry_key"));
  const header = (await loader.readTable(replaceEntryTokens(blankCoalesceAsText((await restoreQuery(loader, "RESTINV_01_LEDGER")).replace(/\|sys\.@pkval_1\|/gi, String(uniqueKey))), book.values)))?.[0];
  if (!header) throw new Error("The entry is not found (deleted, or not posted)");
  const ledKey = toInt(field(header, "led_key"));

  const controls = (await loader.readTable(`SELECT control_name, field_name FROM ${SETUP_SCHEMA}.entry_control WHERE entry_id = $1 AND add_active AND BTRIM(field_restore_queryid) = 'RESTINV_01_LEDGER'`, [entryId])) ?? [];
  const values: Record<string, string> = {};
  for (const control of controls) {
    const name = text(control, "control_name").toLowerCase();
    const column = text(control, "field_name").trim();
    if (!/^(cmb|dtp|tbx)_/.test(name) || column === "" || column.startsWith("(")) continue;
    values[name] = controlValue(field(header, column));
  }
  const partyCode = toInt(field(header, "code"));
  values.tbx_partyname = text(header, "name").trim();
  const docDate = values.dtp_date ?? "";
  const { taxGroup } = partyCode > 0 ? await partyTaxGroup(loader, partyCode, docDate) : { taxGroup: (loader.session.coGstReq ? "G" : "V") as "G" | "I" | "V" };

  // Product rows.
  const products = (await loader.readTable(replaceEntryTokens(blankCoalesceAsText((await restoreQuery(loader, "RESTINV_02_PRODLEDGER"))
    .replace(/\|sys\.query\.@pkval_1\|/gi, `pled.led_id=${ledKey}`).replace(/\|sys\.query\.@pkilval_1\|/gi, "")), book.values))) ?? [];
  const stockNat = book.stockNat === "A" ? "A" : "L";
  const ext = (await loader.readTable(replaceEntryTokens(blankCoalesceAsText((await restoreQuery(loader, "RESTINV_03_SLAB"))
    .replace(/\|sys\.query\.@pkval_3\|/gi, `ledext.led_id=${ledKey}`)), book.values))) ?? [];
  const itemSlab: Record<number, Record<number, { perc: string; taxId: number; amount: string }>> = {};
  const slab: Record<number, { perc: string; amount: string }> = {};
  const slabTax: Record<number, number> = {};
  for (const row of ext) {
    const slabKey = toInt(field(row, "slab_id"));
    const ilKey = toInt(field(row, "il_id"));
    const entry = { perc: toText(displayValue(field(row, "slab_perc"))), taxId: toInt(field(row, "tax_id")), amount: toText(displayValue(field(row, "slab_amt"))) };
    if (ilKey > 0) (itemSlab[ilKey] ??= {})[slabKey] = entry;
    else { slab[slabKey] = { perc: entry.perc, amount: entry.amount }; if (entry.taxId > 0) slabTax[slabKey] = entry.taxId; }
  }
  const lines = products.map((row) => {
    const cells: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) cells[key.toLowerCase()] = toText(displayValue(value)).trim();
    cells.prod_key = text(row, "prod_short").trim();
    cells.uomentry_id = text(row, "qtyuom_desc").trim();
    cells.rateuom_id = text(row, "rateuom_desc").trim();
    cells._il_key = String(toInt(field(row, "il_key")));
    const choice = choiceFrom({ ...row, qtyless_short: cells.uomentry_id, qtyadd_short: cells.uomentry_id, rateless_short: cells.rateuom_id, rateadd_short: cells.rateuom_id, product_tax_perc: field(row, "tax_perc") }, stockNat, {
      key: toInt(field(row, "prod_id")),
    });
    return { cells, product: choice };
  });

  // Account addons (addon_aentry: txt_<fiel_save> by the addon's key).
  const addon: Record<number, string> = {};
  const addonRow = (await loader.readTable(replaceEntryTokens((await restoreQuery(loader, "RESTINV_04_ADDON")).replace(/\|sys\.@pkval_1\|/gi, String(ledKey)), book.values)))?.[0];
  if (addonRow) {
    const fields = (await loader.readTable(`SELECT fiel_key, fiel_save, fiel_type FROM |sys.db|addon_fld WHERE fiel_relate = 'A' AND fiel_pos <> 'D'`)) ?? [];
    for (const item of fields) {
      const save = text(item, "fiel_save").trim();
      // A list field keeps its text in txt_<name>; a typed field in input_<name>.
      const value = text(item, "fiel_type").toUpperCase() === "I" ? field(addonRow, `input_${save}`) : field(addonRow, `txt_${save}`);
      if (value !== undefined && value !== null) addon[toInt(field(item, "fiel_key"))] = toText(displayValue(value)).trim();
    }
  }
  return { uniqueKey, values, partyCode, taxGroup, lines, slab, addon, itemSlab, slabTax };
}

/**
 * Zoom from a report row (Comman_Entry with Zoom_Ledid): the register the voucher was entered in (its BOOK_CODE: the account of the book or of the link register
 * it was entered under) and the unique key that Restore_Entry opens it by.
 */
export async function zoomRegister(loader: Loader, options: readonly EntryOption[], ledKey: number): Promise<{ option: EntryOption; uniqueKey: number }> {
  const row = (await loader.readTable("SELECT unique_key, book_code FROM |sys.db|ledger WHERE led_key = $1 AND doc_pos <> 'D'", [ledKey]))?.[0];
  if (!row) throw new Error("The voucher is not found (deleted, or not posted)");
  const option = options.find((entry) => Number(entry.value) === toInt(Loader.field(row, "book_code")));
  if (!option) throw new Error("The register of this voucher is not in this program's list");
  return { option, uniqueKey: toInt(Loader.field(row, "unique_key")) };
}
