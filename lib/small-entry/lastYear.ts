import { formatDesktopDate, toInt } from "../master-program/legacy";
import type { Loader } from "../master-program/load";
import { cellOf } from "./entrySave";
import type { EditedRow, EntryState } from "./types";

/**
 * Small_Entry.cs's working values for the entries that post ledger rows from a grid typed in
 * (Last Year Bank Reco 7, Last Year Outstanding 9): the account, book, book code, series,
 * document number and debit / credit sides the save rules name as sys.ac_code, sys.book ...
 * The desktop keeps them in fields set as Cmb_FirstCombo_Leave and Save_MultipleLoop_forGrid
 * go (byte_book_entry, int_book_code, str_Series, byte_bk_dbcode ...); here each grid row gets
 * its own set, as SQL literals, before the save loop runs.
 */

/** Entries whose Add takes each table's statement type from its rule's query_add_type. */
export const ADD_TYPE_ENTRIES: ReadonlySet<number> = new Set([7, 9, 15, 16, 46]);

export type RowValues = Readonly<Record<string, string>>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const orNull = (value: number) => (value === 0 ? "Null" : String(value));

export async function rowSystemValues(loader: Loader, entryId: number, rows: readonly EditedRow[], state: EntryState): Promise<(RowValues | null)[]> {
  if (entryId !== 7 && entryId !== 9) return rows.map(() => null);
  const schema = loader.session.companySchema;
  const option = (state.controls.cmb_smallentry1 ?? "").trim().slice(0, 1).toUpperCase();
  const first = toInt(state.firstCombo?.value);
  const account = async (where: string, value: unknown) => (await loader.readTable(`select book, code from ${schema}.account where ${where}`, [value]))?.[0];

  if (entryId === 7) {
    // The bank chosen in the first combo; Deposit is a credit to the account, Withdrawal a debit.
    const acDbCode = option === "D" ? 2 : 1;
    const bkDbCode = option === "D" ? 1 : 2;
    const bank = await account("name = $1", (state.firstCombo?.text ?? "").trim());
    const bankCode = toInt((await account("code = $1 and a_pos = 'A'", first))?.code);
    const series = String((await loader.readTable(
      `select bn_series from ${schema}.book_setup a, ${schema}.book_number b where a.book=6 and a.book_code=$1 and a.bs_rec=b.bn_id and b.bn_from=$2 and b.bn_upto=$3 and b.bn_dbcode=$4`,
      [first, formatDesktopDate(loader.session.tarikh1), formatDesktopDate(loader.session.tarikh2), bkDbCode],
    ))?.[0]?.bn_series ?? "");
    return rows.map(({ values }) => ({
      "sys.ac_code": orNull(toInt(cellOf(values, "name__key"))),
      "sys.book": String(toInt(bank?.book)),
      "sys.book_code": orNull(bankCode),
      "sys.series": quote(series),
      "sys.full_docnoseries": quote(`${series.trim()}/${(cellOf(values, "doc_no") ?? "").trim()}`),
      "sys.bk_dbcode": String(bkDbCode),
      "sys.ac_dbcode": String(acDbCode),
    }));
  }

  // 9: the account chosen in the first combo; each row names the book its bill was in.
  const result: RowValues[] = [];
  for (const { values } of rows) {
    const bookName = (cellOf(values, "book") ?? "").trim();
    const book = bookName === "" ? undefined : await account("name = $1", bookName);
    const properties = bookName === "" ? undefined : (await loader.readTable(`select ac_dbcode from ${schema}.book_properties where book_desc = $1`, [bookName]))?.[0];
    let acDbCode = option === "S" ? 1 : 2;
    let bkDbCode: number;
    if (properties) {
      if (String(properties.ac_dbcode ?? "") === "0") { acDbCode = option === "S" ? 1 : 2; bkDbCode = 0; }
      else bkDbCode = String(properties.ac_dbcode ?? "") === "1" ? 2 : 1;
    } else bkDbCode = option === "S" ? 2 : 1;
    if (bkDbCode > 0) acDbCode = bkDbCode === 2 ? 1 : 2;
    const fullDocNo = `${(cellOf(values, "doc_series") ?? "").trim()}/${(cellOf(values, "doc_no") ?? "").trim()}`;
    result.push({
      "sys.ac_code": orNull(first),
      "sys.book": String(toInt(book?.book)),
      "sys.book_code": orNull(toInt(book?.code)),
      "sys.full_docno": quote(fullDocNo),
      "sys.full_docnoseries": quote(fullDocNo),
      "sys.bk_dbcode": String(bkDbCode),
      "sys.ac_dbcode": String(acDbCode),
    });
  }
  return result;
}
