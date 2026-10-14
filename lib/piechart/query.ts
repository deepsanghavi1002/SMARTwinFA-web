import type { Loader } from "../master-program/load";
import { toDecimal, toText } from "../master-program/legacy";

/**
 * The Pie Chart screen's data (the desktop's Report_PieChart.Btn_Ok_Click): the Sale, Purchase, Receipt or Payment of a period,
 * by month (fiscal order, April first) or by the chosen addon, as a quantity or an amount. One row a slice: its label and value.
 */

export type PieBook = "Sale" | "Purchase" | "Receipt" | "Payment";
export type PieSide = "Quantity" | "Amount";
export type PieAddon = Readonly<{ key: number; label: string }>;
export type PieSlice = Readonly<{ label: string; value: number }>;
export type PieRequest = Readonly<{ book: PieBook; side: PieSide; addonKey: number; from: string; upto: string }>;

export const PIE_BOOKS: readonly PieBook[] = ["Sale", "Purchase", "Receipt", "Payment"];
export const PIE_SIDES: readonly PieSide[] = ["Quantity", "Amount"];

/** The addons the chart can group by (Report_PieChart_Load): account and product master addons that are in use. */
export async function pieAddons(loader: Loader): Promise<PieAddon[]> {
  const rows = await loader.readTable(
    "SELECT fiel_desc, fiel_key FROM |sys.db|addon_fld WHERE fiel_type='M' AND fiel_relate IN ('A','P') AND fiel_masterpos='Y' AND fiel_pos='A' AND fiel_entrypos='N' ORDER BY fiel_desc");
  return (rows ?? []).map((row) => ({ key: Number(row.fiel_key), label: toText(row.fiel_desc).trim() }));
}

/** The fiscal month: April 1 ... March 12. */
const MONTH_LABEL = (column: string) => `lpad(extract(month from ${column})::int::text, 2, '0') || ' - ' || btrim(to_char(${column}, 'Month'))`;
const MONTH_ORDER = (column: string) => `CASE WHEN extract(month from ${column}) >= 4 THEN extract(month from ${column}) - 3 ELSE extract(month from ${column}) + 9 END`;

export async function pieSlices(loader: Loader, request: PieRequest): Promise<PieSlice[]> {
  const { book, side, from, upto } = request;
  const licence = loader.session.licence;
  const dates = [from, upto];

  let addon: { relate: string; column: string } | null = null;
  if ((book === "Sale" || book === "Purchase") && request.addonKey > 0) {
    const field = await loader.readTable("SELECT fiel_relate, fiel_save FROM |sys.db|addon_fld WHERE fiel_key = $1", [request.addonKey]);
    const save = toText(field?.[0]?.fiel_save).trim().toLowerCase();
    if (!field || !/^[a-z0-9_]{1,40}$/.test(save)) throw new Error("Choose an addon from the list");
    addon = { relate: toText(field[0].fiel_relate).trim(), column: `adata.txt_${save}` };
  }

  let sql: string;
  if (book === "Receipt" || book === "Payment") {
    sql = `SELECT ${MONTH_LABEL("led.doc_date")} AS label, SUM(led.amount::numeric) AS value FROM |sys.db|ledger led`
      + ` WHERE led.doc_pos='A' AND led.doc_posting='P' AND led.book IN (4,6) AND led.ac_dbcode=${book === "Receipt" ? 2 : 1} AND led.doc_series<>'Auto'`
      + ` AND led.doc_date BETWEEN $1 AND $2 GROUP BY extract(month from led.doc_date), 1 ORDER BY ${MONTH_ORDER("led.doc_date")}`;
  } else if (side === "Quantity") {
    // Product lines: the sale's books 8 and 16 add (stock goes out, nature L), the purchase's 11 and 13 (nature A); the other nature takes away.
    const nature = book === "Sale" ? "L" : "A";
    const books = book === "Sale" ? "8,16" : "11,13";
    const measure = licence === 2 ? "pl.factor" : "pl.quantity";
    const sum = `SUM(CASE WHEN pl.stock_nat='${nature}' THEN ${measure}::numeric ELSE ${measure}::numeric * -1 END)`;
    const join = !addon ? "" : addon.relate === "A" ? " LEFT JOIN |sys.db|addon_data adata ON adata.code=pl.code" : " LEFT JOIN |sys.db|addon_data adata ON adata.prod_id=pl.prod_id";
    const label = addon ? `${addon.column}` : MONTH_LABEL("pl.il_date");
    sql = `SELECT ${label} AS label, ${sum} AS value FROM |sys.db|prod_ledger pl${join}`
      + ` WHERE pl.il_pos='A' AND pl.quantity-pl.ag_qty>0 AND pl.book IN (${books}) AND pl.inventory='Y' AND pl.led_id>0 AND pl.il_date BETWEEN $1 AND $2`
      + ` GROUP BY ${addon ? addon.column : `extract(month from pl.il_date), 1`} ORDER BY ${addon ? addon.column : MONTH_ORDER("pl.il_date")}`;
  } else if (addon?.relate === "P") {
    // An amount by a product addon comes from the product lines' value.
    const nature = book === "Sale" ? "L" : "A";
    const books = book === "Sale" ? "8,16" : "11,13";
    sql = `SELECT ${addon.column} AS label, SUM(CASE WHEN pl.stock_nat='${nature}' THEN pl.il_value::numeric ELSE pl.il_value::numeric * -1 END) AS value`
      + ` FROM |sys.db|prod_ledger pl LEFT JOIN |sys.db|addon_data adata ON adata.prod_id=pl.prod_id`
      + ` WHERE pl.il_pos='A' AND pl.quantity-pl.ag_qty>0 AND pl.book IN (${books}) AND pl.inventory='Y' AND pl.led_id>0 AND pl.il_date BETWEEN $1 AND $2`
      + ` GROUP BY ${addon.column} ORDER BY ${addon.column}`;
  } else {
    // The voucher's amount, or (when the book has a master tax slab) its amount net of that slab.
    const own = book === "Sale" ? 8 : 13;
    const slabs = await loader.readTable(`SELECT slab_key FROM |sys.db|slab_master WHERE book=${own} AND slab_master='Y' AND slab_active='Y' AND slab_link=0`);
    const slab = slabs ? Number(slabs[0].slab_key) : 0;
    const positive = `(led.book=${own} OR (led.book=${book === "Sale" ? 11 : 16} AND led.ag_book=${own}))`;
    const measure = slab > 0 ? "(ledext.s_lastot::numeric - ledext.slab_amt::numeric)" : "led.amount::numeric";
    const join = (slab > 0 ? ` LEFT JOIN |sys.db|ledger_ext ledext ON ledext.led_id=led.led_key AND ledext.il_id IS NULL AND ledext.slab_id=${slab}` : "")
      + (addon ? " LEFT JOIN |sys.db|addon_data adata ON adata.code=led.code" : "");
    const label = addon ? addon.column : MONTH_LABEL("led.doc_date");
    sql = `SELECT ${label} AS label, SUM(CASE WHEN ${positive} THEN ${measure} ELSE ${measure} * -1 END) AS value FROM |sys.db|ledger led${join}`
      + ` WHERE led.doc_pos='A' AND led.doc_posting='P' AND (led.book=${own} OR (led.book=${book === "Sale" ? 16 : 11} AND led.ag_book=${own}) OR (led.book=${book === "Sale" ? 11 : 16} AND led.ag_book=${own}))`
      + ` AND led.doc_date BETWEEN $1 AND $2 GROUP BY ${addon ? addon.column : `extract(month from led.doc_date), 1`} ORDER BY ${addon ? addon.column : MONTH_ORDER("led.doc_date")}`;
  }

  const rows = await loader.readTable(sql, dates);
  if (rows === null && loader.warnings.length > 0) throw new Error(loader.warnings[loader.warnings.length - 1].split(" :: ")[0]);
  return (rows ?? []).map((row) => ({ label: toText(row.label).trim() || "(Blank)", value: toDecimal(row.value) }));
}
