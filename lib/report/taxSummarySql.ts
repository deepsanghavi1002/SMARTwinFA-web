/**
 * SP_FRT_RPT_TAXSUMM's SQL, apart from the database (so it can be tested on its own): the net and tax
 * column lists the procedure builds in @varSlabNetCols / @varSlabTaxCols. PostgreSQL; the SQL Server
 * original is quoted where it differs.
 */
export type TaxRow = { rec: number; place: number; repohd: string; placeDesc: string };
export type SlabRow = { key: number; short: string };

export type TaxColumnInput = {
  /** @varNet, @varTax and @varSlab_TOT_Net: the amount expressions (SGST nets nothing, a return book changes sign). */
  net: string;
  tax: string;
  totNet: string;
  /** CHK_MONTHCOL: the columns are named without the |..| markers the grid splits its headings on. */
  month: boolean;
  /** TAX_MASTER's active taxes by TAX_PLACE. */
  taxes: readonly TaxRow[];
  /** How many TAX_MASTER rows each TAX_PLACE has, active or not (a place's total column goes after its last row only when they all are here). */
  placeRows: ReadonlyMap<number, number>;
  /** @varTaxPlaces: every TAX_PLACE of the active taxes, comma separated. */
  places: string;
  /** The slabs after the last tax slab, by SLAB_ORDER; slabCount is how many slabs of the book have such an order, active or not. */
  slabs: readonly SlabRow[];
  slabCount: number;
  slabKeys: string;
};

const quoted = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const sum = (when: string, amount: string, alias: string): string => `SUM(CASE WHEN ${when} THEN ${amount} ELSE 0.00 END) AS ${quoted(alias)},`;

/** @varSlabNetCols and @varSlabTaxCols, without the last comma: the net amount row's and the tax amount row's columns, position for position. */
export function taxColumns(input: TaxColumnInput): { netCols: string; taxCols: string } {
  const placeName = (desc: string) => (input.month ? desc : `|${desc}|`);
  let net = "";
  let tax = "";
  const seen = new Map<number, number>();
  for (const row of input.taxes) {
    net += sum(`LEDEXT.TAX_ID = ${row.rec}`, input.net, row.repohd);
    tax += sum(`LEDEXT.TAX_ID = ${row.rec}`, input.tax, row.repohd);
    const rank = (seen.get(row.place) ?? 0) + 1;
    seen.set(row.place, rank);
    if (rank === (input.placeRows.get(row.place) ?? -1)) {
      net += sum(`TAX.TAX_PLACE = ${row.place}`, input.net, `${placeName(row.placeDesc)}_TOTAL_TAX`);
      tax += sum(`TAX.TAX_PLACE = ${row.place}`, input.tax, `${placeName(row.placeDesc)}_TOTAL_TAX`);
    }
  }
  net += sum(`TAX.TAX_PLACE IN (${input.places})`, input.net, input.month ? "TOTAL_TAX_AMT" : "|TOTAL|_TAX_AMT");
  tax += sum(`TAX.TAX_PLACE IN (${input.places})`, input.tax, input.month ? "TOTAL_TAX_AMT1" : "|TOTAL|_TAX_AMT1");
  input.slabs.forEach((slab, at) => {
    net += sum(`LEDEXT.SLAB_ID = ${slab.key}`, input.tax, slab.short);
    tax += sum(`LEDEXT.SLAB_ID = ${slab.key}`, "0.00", slab.short);
    if (at + 1 === input.slabCount) {
      net += sum(`LEDEXT.SLAB_ID IN (${input.slabKeys})`, input.tax, "|SLABS|_TOTAL_AMT");
      tax += sum(`LEDEXT.SLAB_ID IN (${input.slabKeys})`, "0.00", "|SLABS|_TOTAL_AMT");
    }
  });
  net += `SUM(${input.totNet}) AS ${quoted("|TOTAL|_MONTHLY_AMT")},`;
  tax += `SUM(0.00) AS ${quoted("|TOTAL|_MONTHLY_AMT1")},`;
  return { netCols: net.replace(/,$/, ""), taxCols: tax.replace(/,$/, "") };
}

/**
 * The amount expressions. A sale (8, 9) or purchase (13, 14) book has a return book (16 / 11) whose amounts count the other way; SGST
 * carries no net (its CGST twin does).
 */
export function amountExpressions(oppBook: string): { net: string; tax: string; totNet: string } {
  const sgst = (amount: string) => `(case when IDOP.OPT_DESC='SGST' then 0 else ${amount} end)`;
  if (oppBook !== "") {
    const signed = (amount: string) => `(CASE WHEN LED.BOOK = ${oppBook} THEN (${sgst(`${amount} * -1`)}) ELSE (${sgst(amount)}) END)`;
    const tax = `(CASE WHEN LED.BOOK = ${oppBook} THEN (LEDEXT.SLAB_AMT * -1) ELSE LEDEXT.SLAB_AMT END)`;
    const net = `(${signed("LEDEXT.S_LASTOT")} - ${signed("LEDEXT.SLAB_AMT")})`;
    return { net, tax, totNet: `${net}+${tax}` };
  }
  const net = `(${sgst("LEDEXT.S_LASTOT")} - ${sgst("LEDEXT.SLAB_AMT")})`;
  return { net, tax: "LEDEXT.SLAB_AMT", totNet: `${net}+LEDEXT.SLAB_AMT` };
}
