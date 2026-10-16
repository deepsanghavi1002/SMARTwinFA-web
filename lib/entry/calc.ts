/**
 * The invoice's arithmetic, as Comman_Entry does it after each product cell and slab cell
 * (C1dg_Inputdata_AfterEdit / Recalc_InputGrid_Upto_Value, C1dg_Slab_AfterEdit, Slab_RunTotal).
 * Pure, so the screen and the tests share it.
 */

/** A product's units (product_master pcs / pack / weight / qty1..3 with their base figures), by uom key. */
export type ProductUnits = Readonly<{
  pcsUom: number; basePcs: number;
  packUom: number; basePack: number;
  weightUom: number; baseWeight: number;
  qty1Uom: number; baseQty1: number;
  qty2Uom: number; baseQty2: number;
  qty3Uom: number; baseQty3: number;
}>;

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

/** Math.Round(x, places, MidpointRounding.AwayFromZero). */
export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.round(scaled + 1e-9) / factor;
  return value < 0 ? -rounded : rounded;
}

export function fixed(value: number, places: number): string {
  return round(value, places).toFixed(places);
}

/** Box × Packing + Loose: the quantity the bundle, packing and loose columns give (blank when none is filled). */
export function bundleQuantity(bundle: string, packing: string, loose: string): number | null {
  if (bundle.trim() === "" && packing.trim() === "" && loose.trim() === "") return null;
  const boxes = toNumber(bundle);
  const pack = toNumber(packing);
  return (pack > 0 ? boxes * pack : boxes) + toNumber(loose);
}

/**
 * Factor_calc: the quantity in the rate's unit. The same unit gives the quantity; otherwise it
 * goes through pieces: a pack holds base_pack pieces, a weight unit base_weight pieces (both
 * divide, as the desktop's non-multiplying units), qty1..qty3 are base_qtyN to a piece (multiply).
 */
export function rateFactor(quantity: number, qtyUom: number, rateUom: number, units: ProductUnits | null, places: number): number {
  if (qtyUom === rateUom || qtyUom === 0 || rateUom === 0 || !units) return round(quantity, places);
  const perPiece = (uom: number): { base: number; multiply: boolean } | null => {
    if (uom === units.pcsUom) return { base: units.basePcs || 1, multiply: true };
    if (uom === units.packUom) return { base: units.basePack, multiply: false };
    if (uom === units.weightUom) return { base: units.baseWeight, multiply: false };
    if (uom === units.qty1Uom) return { base: units.baseQty1, multiply: true };
    if (uom === units.qty2Uom) return { base: units.baseQty2, multiply: true };
    if (uom === units.qty3Uom) return { base: units.baseQty3, multiply: true };
    return null;
  };
  const from = perPiece(qtyUom);
  const to = perPiece(rateUom);
  if (!from || !to || from.base === 0 || to.base === 0) return round(quantity, places);
  // To pieces, then to the rate's unit.
  const pieces = from.multiply ? quantity / from.base : quantity * from.base;
  return round(to.multiply ? pieces * to.base : pieces / to.base, places);
}

/** A slab row as the arithmetic needs it. */
export type SlabCalcRow = Readonly<{
  /** slab_mathop: A add, L less, U round off / manual. */
  mathOp: string;
  /** slab_calc: A automatic, M manual, B round when slab_round is 0. */
  calc: string;
  roundPlaces: number;
  /** The row whose running total a linked row works on (slab_link), or -1. */
  link: number;
  itemWise: boolean;
  /** The % the row works its amount from (a tax row's tax_perc); 0 when the amount is typed. */
  percent: number;
  /** The amount typed, for a row whose amount is not worked out. */
  amount: number;
  /** The % is worked into the amount (perc editable, or a tax list). */
  fromPercent: boolean;
  /** The round-off amount was typed over the worked-out one (slab_calc B). */
  manual?: boolean;
}>;

/**
 * Recalc_InputGrid_Upto_Value's item-wise slab columns for one product row: from the row's
 * value, each item-wise slab row in order takes its % of the running figure (a linked row,
 * UTGST after CGST, of the figure before the row it is linked to) and adds or takes it off.
 * Returns each item-wise row's amount, by slab row index.
 */
export function itemSlabAmounts(value: number, rows: readonly SlabCalcRow[], percents: readonly number[], typed: ReadonlyMap<number, number> = new Map()): Map<number, number> {
  const out = new Map<number, number>();
  const after: number[] = [value];
  let running = value;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.itemWise) {
      const base = row.link >= 0 && row.link < index ? after[row.link] : running;
      // A discount row whose % is blank keeps the amount typed in its amount cell (C1dg_Inputdata_AfterEdit: the amount is worked out only from a % that is there).
      const amount = typed.has(index) ? round(typed.get(index) ?? 0, 2) : round(base * (percents[index] ?? 0) / 100, 2);
      out.set(index, amount);
      running = row.mathOp === "L" ? running - amount : running + amount;
    }
    after[index] = running;
  }
  return out;
}

export type SlabResult = Readonly<{ amounts: number[]; runTotals: number[]; final: number }>;

/**
 * C1dg_Slab_AfterEdit + Slab_RunTotal: the first row is the product total (or what is typed
 * when the book takes no products, or its calc is M); item-wise rows are the sums of the product
 * rows; a row with a % takes it of the running total before it (or of its linked row's); the
 * last round-off row rounds the total to the rupee.
 */
export function slabRunTotal(rows: readonly SlabCalcRow[], productTotal: number, inventory: boolean, itemTotals: ReadonlyMap<number, number>): SlabResult {
  const amounts: number[] = [];
  const runTotals: number[] = [];
  if (rows.length === 0) return { amounts, runTotals, final: 0 };
  const first = inventory && rows[0].calc !== "M" ? productTotal : rows[0].amount;
  amounts[0] = round(first, 2);
  runTotals[0] = amounts[0];
  let running = amounts[0];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    let amount = row.amount;
    if (row.itemWise) amount = itemTotals.get(index) ?? 0;
    else if (row.fromPercent && row.percent > 0) {
      const base = row.link >= 0 && row.link < index ? runTotals[row.link] : running;
      amount = round(base * row.percent / 100, 2);
    }
    const last = index === rows.length - 1;
    if (row.mathOp === "U" && last && (row.calc === "A" || (row.calc === "B" && row.roundPlaces === 0 && !row.manual))) {
      const rounded = round(running, 0);
      amount = round(rounded - running, 2);
      running = rounded;
    } else if (row.mathOp === "L") running = running < 0 ? running + amount : running - amount;
    else running += amount;
    running = round(running, 2);
    amounts[index] = round(amount, 2);
    runTotals[index] = running;
  }
  return { amounts, runTotals, final: running };
}

/** Factor_calc: a quantity expressed in one of the product's units. */
export function factorCalc(quantity: number, entryUom: number, factor: number, rateUom: number, base: number, baseUom: number, places: number, multiply: boolean): number {
  if (baseUom === 0 || base === 0) return 0;
  if (entryUom === baseUom) return quantity;
  if (rateUom === baseUom) return factor;
  if (multiply) return round(quantity * base, places);
  return base > 0 ? round(quantity / base, places) : round(quantity, places);
}

/**
 * C1dg_Inputdata's trn_* cells (Recalc_InputGrid_Upto_Value): the row's quantity in each of the product's stock units.
 * Entered in pieces (the first unit) the figures follow Factor_calc; a row entered in another unit goes through pieces first.
 */
export function stockUnits(quantity: number, factor: number, entryUom: number, rateUom: number, units: ProductUnits, places: number, copyBundle: string | null): Record<string, number> {
  const out = {
    trn_pcs: factorCalc(quantity, entryUom, factor, rateUom, units.basePcs, units.pcsUom, places, true),
    trn_pack: factorCalc(quantity, entryUom, factor, rateUom, units.basePack, units.packUom, places, false),
    trn_weight: factorCalc(quantity, entryUom, factor, rateUom, units.baseWeight, units.weightUom, places, false),
    trn_qty1: factorCalc(quantity, entryUom, factor, rateUom, units.baseQty1, units.qty1Uom, places, true),
    trn_qty2: factorCalc(quantity, entryUom, factor, rateUom, units.baseQty2, units.qty2Uom, places, true),
    trn_qty3: factorCalc(quantity, entryUom, factor, rateUom, units.baseQty3, units.qty3Uom, places, true),
  };
  if (copyBundle !== null) out.trn_pack = toNumber(copyBundle);
  if (units.pcsUom > 0 && out.trn_pcs === 0) out.trn_pcs = quantity;
  if (units.weightUom > 0 && out.trn_weight === 0) out.trn_weight = quantity;
  if (units.qty1Uom > 0 && out.trn_qty1 === 0) out.trn_qty1 = quantity;
  if (units.qty2Uom > 0 && out.trn_qty2 === 0) out.trn_qty2 = quantity;
  if (units.qty3Uom > 0 && out.trn_qty3 === 0) out.trn_qty3 = quantity;
  return out;
}
