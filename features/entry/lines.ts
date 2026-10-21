import { bundleQuantity, fixed, itemSlabAmounts, rateFactor, round, slabRunTotal, toNumber } from "../../lib/entry/calc";
import type { SlabCalcRow, SlabResult } from "../../lib/entry/calc";
import type { BookScreen, EntryColumn, ProductChoice, SlabRow } from "../../lib/entry/types";

/**
 * The product rows of the entry screen and what they feed: C1dg_Inputdata_AfterEdit's
 * recalculation of a row (quantity from box × packing + loose, the factor in the rate's unit,
 * the value, the item-wise slab columns) and the slab grid's run total.
 */

export type Line = Readonly<{ cells: Readonly<Record<string, string>>; product: ProductChoice | null }>;

export const blankLine = (): Line => ({ cells: {}, product: null });

/** A line with a product is a real row; the rest are the empty rows below. */
export const filledLines = (lines: readonly Line[]) => lines.filter((line) => line.product !== null);

type Context = Readonly<{ book: BookScreen; columns: readonly EntryColumn[] }>;

const uomKey = (book: BookScreen, short: string) => Number(book.uoms.find((uom) => uom.text.trim() === short.trim())?.value ?? 0);
const has = (columns: readonly EntryColumn[], key: string) => columns.some((column) => column.visible && column.key.toLowerCase() === key);

/** The slab rows as the arithmetic reads them, with the % a tax row's list choice gives. */
export function slabCalcRows(book: BookScreen, slab: readonly SlabRow[]): SlabCalcRow[] {
  return slab.map((row) => {
    const tax = row.master && !row.itemWise ? book.taxPercs[row.options?.find((option) => option.text === row.perc)?.value ?? ""] ?? 0 : 0;
    return {
      mathOp: row.mathOp, calc: row.calc, roundPlaces: row.roundPlaces, link: row.link, itemWise: row.itemWise,
      percent: row.master ? tax : toNumber(row.perc),
      amount: toNumber(row.amount),
      manual: row.manual === true,
      fromPercent: !row.itemWise && (row.master || row.percEditable) && (row.master ? tax > 0 : toNumber(row.perc) > 0),
    };
  });
}

/** An item-wise % cell's figure: a tax list's text gives its tax_perc, a discount cell its own number. */
function itemPercent(book: BookScreen, columns: readonly EntryColumn[], row: SlabRow, cells: Readonly<Record<string, string>>): number {
  const value = cells[row.short] ?? "";
  if (!row.master) return toNumber(value);
  const column = columns.find((candidate) => candidate.key === row.short);
  const option = column?.options?.find((candidate) => candidate.text === value);
  return option ? book.taxPercs[option.value] ?? 0 : 0;
}

/** Recalculates a row after `edited` changed (the cell itself keeps what was typed). */
export function recalcLine(line: Line, edited: string, { book, columns }: Context, slab: readonly SlabRow[]): Line {
  if (!line.product) return line;
  const cells: Record<string, string> = { ...line.cells };
  const { decimals } = book;
  // C1dg_Inputdata_AfterEdit INPUT_BUNDLE: boxes typed with no packing take the product's own packing.
  if (edited === "bundle" && toNumber(cells.bundle) > 0 && (cells.pack_qty ?? "").trim() === "" && has(columns, "pack_qty") && line.product.units.basePack > 0) cells.pack_qty = fixed(line.product.units.basePack, decimals.qty);
  if (["bundle", "pack_qty", "loose_qty"].includes(edited) && (has(columns, "bundle") || has(columns, "pack_qty") || has(columns, "loose_qty"))) {
    const quantity = bundleQuantity(cells.bundle ?? "", cells.pack_qty ?? "", cells.loose_qty ?? "");
    if (quantity !== null) cells.quantity = fixed(quantity, decimals.qty);
  }
  const quantity = toNumber(cells.quantity);
  if (edited !== "factor") cells.factor = fixed(rateFactor(quantity, uomKey(book, cells.uomentry_id ?? ""), uomKey(book, cells.rateuom_id ?? ""), line.product.units, decimals.factor), decimals.factor);
  const value = round(toNumber(cells.factor) * toNumber(cells.rate), 2);
  cells.il_value = fixed(value, 2);
  // Item-wise slab columns: each one's % of the running figure of the row.
  const calcRows = slabCalcRows(book, slab);
  const percents = slab.map((row) => (row.itemWise ? itemPercent(book, columns, row, cells) : 0));
  // Amounts the operator typed against a blank %: kept as typed (the edited amount cell always is, for this pass).
  const typed = new Map<number, number>();
  slab.forEach((row, index) => {
    if (!row.itemWise || row.master) return;
    const amountKey = `${row.short}_amt`;
    const percentBlank = toNumber(cells[row.short]) === 0;
    if (edited === amountKey || (percentBlank && toNumber(cells[amountKey]) !== 0)) typed.set(index, toNumber(cells[amountKey]));
  });
  const amounts = itemSlabAmounts(value, calcRows, percents, typed);
  // The amount being typed keeps the text as typed (1, 12, 123 ...); it is shown with its decimals when the cell is left.
  slab.forEach((row, index) => { if (row.itemWise && edited !== `${row.short}_amt`) cells[`${row.short}_amt`] = fixed(amounts.get(index) ?? 0, 2); });
  return { ...line, cells };
}

/**
 * The tax list entry a product's tax gives for an item-wise tax column (the product's tax code, else
 * its own tax %): half the rate each for CGST and SGST / UTGST. Blank when the product has no tax,
 * so the compulsory column is chosen by the operator.
 */
function defaultTax(book: BookScreen, column: EntryColumn | undefined, product: ProductChoice): string {
  const options = column?.options ?? [];
  if (options.length === 0 || product.taxPerc <= 0) return "";
  const wanted = book.taxGroup === "G" ? product.taxPerc / 2 : product.taxPerc;
  return options.find((option) => Math.abs((book.taxPercs[option.value] ?? -1) - wanted) < 0.001)?.text ?? "";
}

/** Product_Selection: the chosen product fills its row (a new product clears the old one's figures). */
export function chooseProduct(line: Line, product: ProductChoice, context: Context, slab: readonly SlabRow[]): Line {
  const same = line.product?.key === product.key;
  const cells: Record<string, string> = same ? { ...line.cells } : {};
  // The +/- mark (a stock register's rows going in or out) belongs to the row, not to the product in it.
  if (!same && line.cells.prod_return !== undefined) cells.prod_return = line.cells.prod_return;
  cells.prod_key = product.short;
  cells.prod_desc = product.desc;
  cells.stock_1 = product.stock1;
  cells.stock_2 = product.stock2;
  if (!same || !cells.uomentry_id) cells.uomentry_id = product.qtyUom;
  if (!same || !cells.rateuom_id) cells.rateuom_id = product.rateUom;
  if (!same) {
    if (has(context.columns, "pack_qty") && product.packing !== "") cells.pack_qty = fixed(toNumber(product.packing), context.book.decimals.qty);
    cells.master_rate = product.mrp === "" ? "" : fixed(toNumber(product.mrp), 2);
    cells.rate = product.rate === "" ? "" : fixed(toNumber(product.rate), context.book.decimals.rate);
    for (const row of slab) {
      if (!row.itemWise) continue;
      if (row.master) cells[row.short] = defaultTax(context.book, context.columns.find((column) => column.key === row.short), product);
    }
    // The party-rate hit's discount % fills the 1st..4th item-wise less column (ProductChangeEffect: int_col_Item_LessSlab1..4).
    if (product.slabPercs) {
      slab.filter((row) => row.itemWise && !row.master && row.mathOp !== "A").forEach((row, index) => {
        const perc = product.slabPercs?.[index + 1];
        if (perc !== undefined && perc > 0) cells[row.short] = String(perc);
      });
    }
  }
  return recalcLine({ cells, product }, "", context, slab);
}

/** The totals line under the grid: the sum of each column whose field_total is Y. */
export function lineTotals(lines: readonly Line[], keys: readonly string[], decimals: (key: string) => number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const lower = key.toLowerCase();
    const sum = filledLines(lines).reduce((total, line) => total + toNumber(line.cells[lower]), 0);
    out[lower] = fixed(sum, decimals(lower));
  }
  return out;
}

/** The slab grid from the product rows: the product total, the item-wise rows' sums, and the run total. */
export function slabFromLines(book: BookScreen, slab: readonly SlabRow[], lines: readonly Line[]): SlabResult {
  const rows = filledLines(lines);
  const productTotal = rows.reduce((total, line) => total + toNumber(line.cells.il_value), 0);
  const itemTotals = new Map<number, number>();
  slab.forEach((row, index) => {
    if (row.itemWise) itemTotals.set(index, round(rows.reduce((total, line) => total + toNumber(line.cells[`${row.short}_amt`]), 0), 2));
  });
  return slabRunTotal(slabCalcRows(book, slab), productTotal, book.inventory, itemTotals);
}
