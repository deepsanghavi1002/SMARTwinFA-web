/**
 * SP_FRT_RPT_FORM_SUMM's SQL, apart from the database (so it can be tested on its own): the summed
 * amount columns, the select / group / order of its two formats, and the SGST / UTGST clean-up.
 * PostgreSQL; the procedure's SQL Server original is quoted where it differs.
 */
export type AmountColumns = { bnet: string; btax: string; cnnet: string; cntax: string; rnet: string; rtax: string; totnet: string; tottax: string; totfin: string };

const ALIASES: readonly (readonly [keyof AmountColumns, string])[] = [
  ["bnet", "B_NET"], ["btax", "B_TAX"], ["cnnet", "CN_NET"], ["cntax", "CN_TAX"], ["rnet", "R_NET"], ["rtax", "R_TAX"], ["totnet", "TOT_NET"], ["tottax", "TOT_TAX"], ["totfin", "TOT_FIN"],
];

/** @varFixCols: SUM(column) AS "B_NET" , ... for each amount column the book has (each followed by " ,"). */
export const sumColumns = (columns: AmountColumns): string => ALIASES.map(([key, alias]) => (columns[key] !== "" ? `SUM(${columns[key]}) AS "${alias}" ,` : "")).join("");

/** CHARINDEX('16',@var_select_key5) or CHARINDEX('11', ...): anywhere in the keys, as the desktop reads it (no comma). */
export const readsReturnAccounts = (keys: readonly string[]): boolean => { const joined = `,${keys.join(",")},`; return joined.includes("16") || joined.includes("11"); };

export type FormatParts = { select: string; groupBy: string; orderBy: string };

/**
 * SM_SUMMARY (Details, summarized taxes): a row for each voucher and tax line, with its date, voucher
 * and account. SUMMARY (Summary For Period Selected): a row for each tax line for the whole period.
 * `place` is the TAX_PLACE a slab line without a tax takes (the last place + 1, or 101).
 */
export function formatParts(format: string, slabKey: string, place: string, amounts: string): FormatParts | null {
  const inSlab = `LEDEXT.SLAB_ID in (${slabKey})`;
  const taxPlace = `CASE WHEN ${inSlab} THEN TAX.TAX_PLACE ELSE ${place} END AS "TAX_PLACE"`;
  const taxPlaceDesc = `CASE WHEN ${inSlab} THEN IDOPT.OPT_DESC ELSE 'SLABS' END AS "TAX_PLACE_DESC"`;
  const taxShort = `CASE WHEN ${inSlab} THEN TAX.TAX_SHORT ELSE 'USER' END AS "TAX_SHORT"`;
  const taxDesc = `CASE WHEN ${inSlab} THEN TAX.TAX_DESC ELSE SLAB.SLAB_REPOHD END AS "TAX_DESC"`;
  if (format === "SM_SUMMARY") {
    return {
      select: `to_char(LED.DOC_DATE,'YYYYMMDD') AS "SORTING_DATE",to_char(LED.DOC_DATE,'DD/MM/YYYY') AS "SELECTED_DATE",LED.FULL_DOCNO,AC.NAME,${amounts}${taxShort},${taxDesc},${taxPlaceDesc},${taxPlace},SLAB.SLAB_ORDER,SLAB.SLAB_KEY`,
      groupBy: "IDOPT.OPT_DESC,TAX.TAX_PLACE,SLAB.SLAB_ORDER,LEDEXT.SLAB_ID,TAX.TAX_SHORT,TAX.TAX_DESC,SLAB.SLAB_REPOHD,LED.DOC_DATE,LED.DOC_NO,LED.FULL_DOCNO,AC.NAME,SLAB.SLAB_KEY",
      orderBy: "SLAB.SLAB_ORDER,TAX_PLACE,LED.DOC_DATE,LED.DOC_NO,IDOPT.OPT_DESC,TAX_SHORT,TAX.TAX_DESC,AC.NAME",
    };
  }
  if (format === "SUMMARY") {
    return {
      select: `${taxPlace},${taxPlaceDesc},${taxShort},${taxDesc},${amounts.replace(/ ,$/, "")}`,
      groupBy: "SLAB.SLAB_ORDER,LEDEXT.SLAB_ID,TAX.TAX_PLACE,IDOPT.OPT_DESC,TAX.TAX_SHORT,SLAB.SLAB_REPOHD,TAX.TAX_DESC",
      orderBy: "SLAB.SLAB_ORDER,TAX.TAX_PLACE,IDOPT.OPT_DESC,TAX_SHORT,TAX.TAX_DESC",
    };
  }
  return null;
}

/**
 * The SGST / UTGST lines carry their tax only: TOT_NET 0 and TOT_FIN = TOT_TAX, and (unless cash and
 * credit memos are combined) the book, cash and return nets 0 too, for the columns the table has.
 * Book 9 (cash sale) has no cash-memo column, so only B_NET and R_NET.
 */
export function taxOnlyColumns(book: number, combined: boolean, has: (column: string) => boolean): string[] {
  if (combined) return [];
  if (book !== 9) return has("CN_NET") || has("R_NET") ? ["B_NET", "CN_NET", "R_NET"].filter(has) : [];
  return has("R_NET") ? ["B_NET", "R_NET"].filter(has) : [];
}
