import { toText } from "../master-program/legacy";
import { Loader } from "../master-program/load";

/**
 * Small_Entry.cs, the account_addon fill (Cmb_FirstCombo_Leave): which addon fields become
 * editable grid columns, chosen by the book of the account picked in the first combo, as
 * the desktop filters dt_Addon_Fld. The columns themselves are built like the product
 * master's (addonColumns), but editable, and Save writes them back (saveAddonColumns).
 */

type Row = Record<string, unknown>;

/** The addon_fld rows for the grid, in fiel_key order; [] when the account has no book. */
export async function accountAddonFields(loader: Loader, entryId: number, accountCode: number): Promise<Row[]> {
  const schema = loader.session.companySchema;
  const licence = loader.session.licence;
  const book = toText(Loader.field((await loader.readTable(`SELECT book FROM ${schema}.account WHERE code = $1`, [accountCode]))?.[0], "book")).trim();
  if (book === "") return [];
  const where = (relate: string, entryPos: string, inBook: string, extra = "") =>
    `fiel_relate = '${relate}' AND fiel_entrypos = '${entryPos}' AND fiel_pos <> 'D' AND fiel_inbook LIKE '${inBook}'${extra}`;
  let filter: string;
  if (["8", "16", "21", "22"].includes(book)) {
    if (licence === 51 && book === "21") filter = where("A", "L", "% 21,%", entryId === 67 ? " AND (fiel_short = 'BILL' OR fiel_short = 'Transport' OR fiel_short = 'CHLN RECD')" : "");
    else if (licence === 21 && book === "22") filter = where("P", "P", "% 22,%", entryId === 108 ? " AND (fiel_short = 'REVISEDDT' OR fiel_short = 'REVREMARK')" : "");
    else filter = where("A", "L", "% 8,%");
  } else if (["4", "5", "6", "27"].includes(book)) {
    filter = where("A", "L", `% ${book},%`);
  } else if (book === "23") {
    filter = where("A", "L", "% 23,%", " AND (fiel_err LIKE 'DEL_TIME,' OR fiel_err LIKE 'ROUTE,')");
  } else {
    filter = where("A", "L", "%13,%");
  }
  return (await loader.readTable(`SELECT * FROM ${schema}.addon_fld WHERE ${filter} ORDER BY fiel_key`)) ?? [];
}
