import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toInt, toText } from "../master-program/legacy";
import { SETUP_SCHEMA } from "../master-program/session";
import { blankCoalesceAsText } from "../master-program/sql";
import { queryOptions } from "../small-entry/load";
import { againstNames, bookContext, controlEvents, entryProperties, helpColumns, partyTaxGroup } from "./invoice";
import { BOOK, replaceEntryTokens } from "./values";
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

/**
 * HELP_PRODUCT runs two per-product subqueries (the latest MRP of the price list, the product's first addon row). Company tables carry
 * only their primary key, so each one scans the whole table once per product (18,000 products: 30 s). The same answer read in one pass.
 */
function helpOnePass(sql: string): string {
  const loose = (piece: string) => new RegExp(piece.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
  const mrp = loose("(select pl_mrp from |sys.db|pricelist where prod_id=product.prod_key and pl_pos<>'D' and pl_mrp > 0 order by pl_wefrom desc limit 1) as prod_MRP");
  const addon = loose("left join |sys.db|ADDON_DATA adata on adata.prod_id=product.prod_key and adata.aon_key in (select a.aon_key from |sys.db|addon_data a where a.prod_id=product.prod_key limit 1)");
  const where = loose(") WHERE product.prod_pos<>'D'");
  if (!mrp.test(sql) || !addon.test(sql) || !where.test(sql)) return sql;
  return sql
    .replace(mrp, "mrp.pl_mrp as prod_MRP")
    .replace(addon, "left join (SELECT DISTINCT ON (prod_id) * FROM |sys.db|addon_data ORDER BY prod_id, aon_key) adata on adata.prod_id=product.prod_key")
    .replace(where, () => ") left join (SELECT DISTINCT ON (prod_id) prod_id, pl_mrp FROM |sys.db|pricelist WHERE pl_pos<>'D' AND pl_mrp > 0 ORDER BY prod_id, pl_wefrom DESC) mrp ON mrp.prod_id=product.prod_key WHERE product.prod_pos<>'D'");
}

export async function productHelp(loader: Loader, entryName: string, firstCombo: EntryOption): Promise<HelpList> {
  const book = await bookContext(loader, entryName, firstCombo);
  const helpRow = (await loader.readTable(`SELECT help_query, help_col_frozen FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = 'HELP_PRODUCT'`))?.[0];
  if (!helpRow) throw new Error("HELP_PRODUCT is not in smart_setup.help_table");
  // |sys.replace_prodaddon|: the product addons marked for the help; |sys.help_stock_3| only with the bundle copy (not ported).
  const addons = (await loader.readTable(`SELECT fiel_save, fiel_short FROM |sys.db|addon_fld WHERE fiel_relate = 'P' AND fiel_pos <> 'D' AND account_help::int = 1 ORDER BY fiel_key`)) ?? [];
  // item_para PGFILT with a product addon marked PRDFILT: the product help is filtered by that addon's list (cmb_ProdFilter).
  const filterAddon = toText(loader.session.setup.item_para).toUpperCase().includes("PGFILT,")
    ? (await loader.readTable(`SELECT fiel_key, fiel_name, fiel_save FROM |sys.db|addon_fld WHERE fiel_relate = 'P' AND fiel_pos <> 'D' AND fiel_err ILIKE '%PRDFILT,%' ORDER BY fiel_key LIMIT 1`))?.[0]
    : undefined;
  const filterSave = filterAddon ? text(filterAddon, "fiel_save").trim() : "";
  const filterColumn = /^[A-Za-z0-9_]+$/.test(filterSave) ? `adata.txt_${filterSave} AS "pg_filter",` : "";
  let sql = text(helpRow, "help_query")
    .replace(/\|sys\.replace_prodaddon\|,/gi, filterColumn + addons.map((addon) => `txt_${text(addon, "fiel_save").trim()} as "${text(addon, "fiel_short").trim().replace(/"/g, "")}",`).join(""))
    .replace(/,?\|sys\.help_stock_3\|,?/gi, ",");
  sql = replaceEntryTokens(blankCoalesceAsText(helpOnePass(sql)), book.values);
  const rows = (await loader.readTable(sql)) ?? [];
  if (rows.length === 0) return { columns: [], rows: [], frozen: 0, total: "Product Master not found..." };
  const keys = Object.keys(rows[0]);
  const columns = await helpColumns(loader, "HELP_PRODUCT", "X", keys);
  // Only what the help shows and the key travel: 18,000 products with every column would be several megabytes.
  const kept = ["prod_key", ...(filterColumn ? ["pg_filter"] : []), ...columns.map((column) => column.key)];
  const filter = filterColumn
    ? { caption: text(filterAddon, "fiel_name").trim(), options: await queryOptions(loader, `select sub_name, sub_code from |sys.db|addon_sub where sub_pos <> 'D' and para_id = ${toInt(field(filterAddon, "fiel_key"))} order by sub_name`) }
    : undefined;
  return {
    columns,
    rows: rows.map((row) => Object.fromEntries(kept.map((key) => [key, displayValue(row[key])]))),
    frozen: toInt(field(helpRow, "help_col_frozen")),
    total: `Total Help Record : ${rows.length}`,
    ...(filter ? { filter } : {}),
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
 * the party-rate addons: the party's own rate for the product (party_rate), then the price
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
    .sort((a, b) => toInt(field(a, "control_query_sr")) - toInt(field(b, "control_query_sr")));
  const values: EntryValues = { ...book.values, acCode, docDate };

  // The party-rate addons (addon_fld fiel_partyrate Y): the account's (its value for this party is |sys.prate_addon_nm|)
  // and the product's (its key_ column on the product's addon_data is |sys.prate_addon_nm2|; a purchase book takes the PBRFN one).
  const rateAddons = (await loader.readTable(`SELECT fiel_relate, fiel_save, fiel_err FROM |sys.db|addon_fld WHERE fiel_partyrate = 'Y' AND fiel_pos <> 'D' ORDER BY fiel_key`)) ?? [];
  const safeName = (value: string) => (/^[A-Za-z0-9_]+$/.test(value.trim()) ? value.trim() : "");
  const acAddon = safeName(text(rateAddons.find((addon) => text(addon, "fiel_relate") === "A"), "fiel_save"));
  const prodAddon = safeName(text(rateAddons.find((addon) => text(addon, "fiel_relate") === "P"), "fiel_save"));
  let prodColumn = prodAddon;
  if (book.values.bookKey === BOOK.PURCH) {
    const purchase = (await loader.readTable(`SELECT fiel_save FROM |sys.db|addon_fld WHERE fiel_pos <> 'D' AND fiel_err ILIKE '%PBRFN,%' ORDER BY fiel_key LIMIT 1`))?.[0];
    if (purchase && safeName(text(purchase, "fiel_save"))) prodColumn = safeName(text(purchase, "fiel_save"));
  }
  const hasAc = acAddon !== "";
  const hasProd = prodColumn !== "";
  const partyName = hasAc && acCode > 0
    ? toText(displayValue(Object.values((await loader.readTable(`SELECT txt_${acAddon} FROM |sys.db|addon_data WHERE code = $1 LIMIT 1`, [acCode]))?.[0] ?? {})[0])).trim()
    : "";
  const sql = (value: string) => value.replace(/'/g, "''");
  // ProductChangeEffect "R": each party_rate query runs only while no rate is found, and only when the addons it needs exist
  // (1 party + product; 2 party + a/c addon + product addon; 3 a/c addon; 4 product addon; 5 a/c addon; 6 both; 7 product addon).
  const wanted: Record<number, boolean> = { 1: true, 2: hasAc && hasProd, 3: hasAc, 4: hasProd, 5: hasAc, 6: hasAc && hasProd, 7: hasProd };
  const rateField = book.values.bookKey === BOOK.PURCH ? "pr_prate" : "pr_rate";
  let rate = 0;
  let mrp = 0;
  let found = false;
  /** pr_slabperc of the party-rate hit, by the item-wise discount column it fills (int_col_Item_LessSlab1..4). */
  const slabPercs: Record<number, number> = {};
  for (const event of events) {
    const order = toInt(field(event, "control_query_sr"));
    const raw = toText(field(event, "fill_control_query"));
    const isPartyRate = /party_rate/i.test(raw);
    if (isPartyRate && (found || !wanted[order])) continue;
    if (!isPartyRate && /pricelist/i.test(raw) && rate > 0 && mrp > 0) continue;
    if (!isPartyRate && !/pricelist/i.test(raw)) continue;
    const query = `Select ${raw}`
      .replace(/'\|sys\.prate_addon_nm2\|'/gi, hasProd ? `key_${prodColumn}` : "null")
      .replace(/\|sys\.prate_addon_nm\|/gi, sql(partyName))
      .replace(/\|sys\.prod_key\|/gi, String(prodKey))
      .replace(/\|sys\.rate_stock_nat\|/gi, `'${stockNat}'`)
      .replace(/\|sys\.stock_nat\|/gi, `'${stockNat}'`);
    if (/\|sys\.ac_code\|/i.test(query) && acCode <= 0) continue;
    if (/\|sys\.prate_addon_nm1\|/i.test(query)) continue;
    const rows = (await loader.readTable(replaceEntryTokens(query, values))) ?? [];
    if (rows.length === 0) continue;
    if (isPartyRate) {
      const hit = rows[0];
      const figure = toDecimal(field(hit, rateField));
      if (figure > 0) { if (rate === 0) rate = figure; found = true; }
      const percent = (name: string) => toDecimal(field(hit, name));
      if (order === 4) { if (percent("pr_slabperc") > 0) slabPercs[1] = percent("pr_slabperc"); if (percent("pr_slabperc1") > 0) slabPercs[2] = percent("pr_slabperc1"); }
      if (order === 5 && percent("pr_slabperc") > 0) slabPercs[3] = percent("pr_slabperc");
      if (order === 6 && percent("pr_slabperc") > 0) slabPercs[4] = percent("pr_slabperc");
      if (order === 7 && mrp === 0 && toDecimal(field(hit, "pr_masterrate")) > 0) { mrp = toDecimal(field(hit, "pr_masterrate")); found = true; }
    } else {
      const rateColumn = stockNat === "A" ? "pl_prate" : "pl_srate";
      const uomColumn = stockNat === "A" ? "pl_puom" : "pl_suom";
      const ofUnit = rows.find((price) => toInt(field(price, uomColumn)) === rateUomKey && toDecimal(field(price, rateColumn)) > 0) ?? rows.find((price) => toDecimal(field(price, rateColumn)) > 0);
      if (rate === 0 && ofUnit) rate = toDecimal(field(ofUnit, rateColumn));
      const mrpRow = rows.find((price) => toInt(field(price, "pl_muom")) === rateUomKey && toDecimal(field(price, "pl_mrp")) > 0) ?? rows.find((price) => toDecimal(field(price, "pl_mrp")) > 0);
      if (mrp === 0 && mrpRow) mrp = toDecimal(field(mrpRow, "pl_mrp"));
    }
  }
  return {
    ...choice,
    stock1: balance ? toText(displayValue(field(balance, "clsg_pcs"))) : "",
    stock2: balance ? toText(displayValue(field(balance, "clsg_pack"))) : "",
    rate: rate > 0 ? String(rate) : "",
    mrp: mrp > 0 ? String(mrp) : "",
    ...(Object.keys(slabPercs).length > 0 ? { slabPercs } : {}),
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
  let book = await bookContext(loader, entryName, firstCombo);
  // A debit / credit note opens against the book it was saved with.
  let against: RestoredEntry["against"];
  if (book.entryFor === "DrCr") {
    const own = (await loader.readTable(`SELECT ag_bkcode, "TYPE" AS nature FROM |sys.db|ledger WHERE unique_key = $1 AND doc_pos <> 'D' LIMIT 1`, [uniqueKey]))?.[0];
    const code = toInt(field(own, "ag_bkcode"));
    if (code > 0) {
      const nature = toInt(field(own, "nature"));
      const names = await againstNames(loader, [code], [nature]);
      against = { code, nature, accountName: names.accounts.get(code) ?? "", natureText: names.kinds.get(nature) ?? "" };
      firstCombo = { ...firstCombo, against: { code, nature } };
      book = await bookContext(loader, entryName, firstCombo);
    }
  }
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
  const addressId = toInt(field((await loader.readTable(`SELECT ent_address_id FROM |sys.db|ledger WHERE unique_key = $1 LIMIT 1`, [uniqueKey]))?.[0], "ent_address_id"));
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
  return { uniqueKey, ...(against ? { against } : {}), values, partyCode, addressId, taxGroup, lines, slab, addon, itemSlab, slabTax };
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
