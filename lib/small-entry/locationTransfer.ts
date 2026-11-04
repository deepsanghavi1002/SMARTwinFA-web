import { formatDesktopDate, formatDesktopTime, parseDesktopDate, toInt } from "../master-program/legacy";
import type { Loader } from "../master-program/load";
import { cellOf } from "./entrySave";
import type { EntryStatement } from "./entrySave";
import type { EditedRow, EntryOption, EntryState } from "./types";

/**
 * Small_Entry.Save_Click for Location Transfer (115): the quantities typed against each product move stock from the From Location
 * (the header's Select box) to the Upto Location (the first combo) as two stock registers dated the Entry Date:
 *   CHLN-OUT  series STI/<yy>-<yy>, book 8, stock nature L, ADDON_IENTRY location = From Location;
 *   CHLN-IN   series STO/<yy>-<yy>, book 13, stock nature A, ADDON_IENTRY location = Upto Location.
 * A line whose quantity is more than the stock of its product at the From Location (its closing quantity from the stock registers
 * of that location) is left out with a message, as the desktop puts its quantity back to 0. Quantities carry the desktop's own
 * book, unit and type numbers; the register numbers follow the highest in the year's series.
 */

export const LOCATION_TRANSFER = 115;

export type LocationTransferResult = Readonly<{ statements: EntryStatement[]; savedRows: Set<number>; messages: string[] }>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const amountOf = (value: unknown) => Number(String(value ?? "").replace(/,/g, "").trim()) || 0;
const number = (value: number) => String(Number(value.toFixed(4)));

/** The stock of one product at one location: the closing quantity of the Stock Register for the location (Small_Entry, entry 115). */
export async function locationStock(loader: Loader, productKey: number, locationKey: number): Promise<number> {
  const schema = loader.session.companySchema;
  const part = (nature: string) => `sum(case when prodled.stock_nat = '${nature}' and prodled.order_no <> 'OPENING' then (case
      when product.rep1_uom = product.pcs_uom then prodled.trn_pcs::numeric - prodled.ag_qty::numeric
      when product.rep1_uom = product.qty1_uom then prodled.trn_qty1::numeric - round((prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.trn_qty1::numeric), 4)
      when product.rep1_uom = product.qty2_uom then prodled.trn_qty2::numeric - round((prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.trn_qty2::numeric), 4)
      when product.rep1_uom = product.qty3_uom then prodled.trn_qty3::numeric - round((prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.trn_qty3::numeric), 4)
      when product.rep1_uom = product.pack_uom then prodled.trn_pack::numeric - round((prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.trn_pack::numeric), 4)
      when product.rep1_uom = product.weight_uom then prodled.trn_weight::numeric - round((prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.trn_weight::numeric), 4)
      else prodled.quantity::numeric - prodled.ag_qty::numeric end) else 0 end)`;
  const row = (await loader.readTable(
    `select coalesce(sum(case when prodled.order_no = 'OPENING' and prodled.trn_module = 'CHLN-IN' then prodled.quantity::numeric when prodled.order_no = 'OPENING' and prodled.trn_module = 'CHLN-OUT' then -prodled.quantity::numeric else 0 end), 0)
        + coalesce(${part("A")}, 0) - coalesce(${part("L")}, 0) as clsg
       from ${schema}.prod_ledger prodled right join ${schema}.product_master product on prodled.prod_id = product.prod_key
       left join ${schema}.addon_ientry aient on prodled.prod_id = aient.aoni_prodid and prodled.process_id = aient.aoni_processid
      where product.inventory = 'Y' and product.prod_pos <> 'D' and prodled.il_pos = 'A' and prodled.prod_id = $1 and aient.key_location = $2 and prodled.trn_module in ('CHLN-OUT', 'CHLN-IN')`,
    [productKey, locationKey]))?.[0];
  return amountOf(row?.clsg);
}

/** The product a grid line names (its description without line breaks, as the desktop matches it) and its packing. */
export async function transferProduct(loader: Loader, description: string): Promise<{ key: number; basePack: number } | null> {
  const clean = description.replace(/[\r\n]/g, "");
  const row = (await loader.readTable(`select prod_key, base_pack from ${loader.session.companySchema}.product_master where prod_pos <> 'D' and regexp_replace(prod_desc, '[\\r\\n]', '', 'g') = $1 limit 1`, [clean]))?.[0];
  return row ? { key: toInt(row.prod_key), basePack: amountOf(row.base_pack) } : null;
}

export async function locationTransferStatements(loader: Loader, entryId: number, rows: readonly EditedRow[], state: EntryState, choices: Readonly<Record<string, EntryOption>>, now = new Date()): Promise<LocationTransferResult | null> {
  if (entryId !== LOCATION_TRANSFER) return null;
  const { session } = loader;
  const schema = session.companySchema;
  const statements: EntryStatement[] = [];
  const savedRows = new Set<number>();
  const messages: string[] = [];

  const from = choices.cmb_smallentry1 ?? { text: state.controls.cmb_smallentry1 ?? "", value: "" };
  const upto = state.firstCombo;
  if (!upto || toInt(upto.value) <= 0 || toInt(from.value) <= 0) return { statements, savedRows, messages: ["Choose the From Location and the Upto Location"] };
  if (from.text.trim() === upto.text.trim() || toInt(from.value) === toInt(upto.value)) return { statements, savedRows, messages: ["From And Upto Both Location Same Not Allowed...."] };

  const date = formatDesktopDate(parseDesktopDate(state.controls.dtp_date ?? "") ?? now);
  const year = quote(session.yearId);
  const saveDate = quote(formatDesktopDate(now));
  const saveTime = quote(formatDesktopTime(now));

  // The lines that move stock: a product that is found, with a quantity the From Location holds.
  const lines: { index: number; description: string; productKey: number; basePack: number; quantity: number; bundle: number; loose: number }[] = [];
  for (const [index, row] of rows.entries()) {
    const quantity = amountOf(cellOf(row.values, "Quantity"));
    if (row.deleted || !(quantity > 0)) continue;
    const description = cellOf(row.values, "prod_desc") ?? "";
    const product = await transferProduct(loader, description);
    if (!product) { messages.push(`Product not found: ${description.trim()}`); continue; }
    const stock = await locationStock(loader, product.key, toInt(from.value));
    if (quantity > stock) { messages.push(`Product Name : ${description.trim()}  - Stock Quantity : ${number(stock)}  - Input Quantity : ${number(quantity)}`); continue; }
    lines.push({ index, description, productKey: product.key, basePack: product.basePack, quantity, bundle: amountOf(cellOf(row.values, "bundle")), loose: amountOf(cellOf(row.values, "loose_qty")) });
  }
  if (lines.length === 0) return { statements, savedRows, messages };

  const yy = `${String(session.tarikh1.getFullYear()).slice(-2)}-${String(session.tarikh2.getFullYear()).slice(-2)}`;
  const register = async (module: "CHLN-OUT" | "CHLN-IN", prefix: "STI" | "STO") => {
    const series = `${prefix}/${yy}`;
    const top = Number((await loader.readTable(`select max(nullif(regexp_replace(doc_no2, '\\D', '', 'g'), '')::numeric) as top from ${schema}.process where stk_module = $1 and p_docseries = $2 and il_pos <> 'D'`, [module, series]))?.[0]?.top ?? 0);
    return { series, docNo: top > 0 ? top + 1 : 1 };
  };
  const sides = [
    { module: "CHLN-OUT", prefix: "STI", capture: "out", book: 8, bookDb: 2, type: 21, nature: "L", location: from },
    { module: "CHLN-IN", prefix: "STO", capture: "in", book: 13, bookDb: 1, type: 20, nature: "A", location: upto },
  ] as const;

  for (const side of sides) {
    const { series, docNo } = await register(side.module, side.prefix);
    const fullDocNo = `${series}/${docNo}`;
    const padded = quote(String(docNo).padStart(10));
    const ref = `{{${side.capture}}}`;
    statements.push({ sql: "", insert: { table: "process", capture: side.capture,
      fields: ["stk_module", "doc_no2", "book", "p_date", "post_date", "il_pos", "p_docseries", "full_docno", "p_bkdbcode", "p_amount", "entry_for", "stk_remark", "year_id", "last_savedate", "last_savetime", "entry_no", "ent_address_id", "user_id", "eway_billno", "eway_billdate", "eway_valid", "supply_type", "sub_supply_type", "eway_doc_type", "trp_mode", "distance_km", "eway_veh_type"],
      values: [quote(side.module), padded, String(side.book), quote(date), quote(date), "'A'", quote(series), quote(fullDocNo), String(side.bookDb), "0", "'P'", "''", year, saveDate, saveTime, "''", "0", String(session.userNo), "''", quote(date), "''", "0", "0", "0", "0", "''", "0"] } });
    let serial = 0;
    for (const line of lines) {
      serial += 1;
      const lineRef = `${side.capture}line${serial}`;
      const qty = number(line.quantity);
      statements.push({ sql: "", insert: { table: "prod_ledger", capture: lineRef, row: line.index,
        fields: ["il_serial", "doc_no1", "prod_id", "il_prodcd", "il_billdesc", "quantity", "rate", "master_rate", "il_value", "book", "rateuom_id", "uomentry_id", "type", "il_date", "stock_nat", "il_pos", "il_div", "full_docno", "order_no", "slab_cost", "cost_rate", "inventory", "stock_type", "factor", "trn_qty1", "trn_qty2", "trn_qty3", "trn_pcs", "trn_pack", "trn_weight", "trn_module", "trn_stkmid", "link_stkmdl", "ag_qty", "ag_fact", "process_id", "year_id", "ag_pack", "loose_qty", "pack_qty", "bundle", "lot_no"],
        values: [String(serial), padded, String(line.productKey), "''", quote(line.description.trim()), qty, "0", "0", "0", String(side.book), "5", "5", String(side.type), quote(date), quote(side.nature), "'A'", "0", quote(fullDocNo), "''", "0", "0", "'N'", "'R'", qty, qty, qty, qty, qty, qty, qty, quote(side.module), "'CH'", "''", "0", "0", ref, year, "0", number(line.loose), number(line.basePack), number(line.bundle), "'Yes'"] } });
      statements.push({ sql: "", insert: { table: "addon_ientry",
        fields: ["aoni_processid", "aoni_il_id", "aoni_prodid", "aoni_stknat", "aoni_entry_qty", "aoni_entry_uom", "aoni_entry_fact", "aoni_entry_factuom", "aoni_rep_qty", "aoni_clear_qty", "aoni_rate", "aoni_date", "key_location", "txt_location"],
        values: [ref, `{{${lineRef}}}`, String(line.productKey), quote(side.nature), qty, "5", qty, "5", qty, "0", "0", quote(date), String(toInt(side.location.value)), quote(side.location.text.trim())] } });
    }
  }
  for (const line of lines) savedRows.add(line.index);
  return { statements, savedRows, messages };
}
